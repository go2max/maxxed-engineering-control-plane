import { TaskState } from '../core/task-graph.js';
import { digest } from '../leverage/solution-cas.js';
import { CompositionBisector } from './composition-bisector.js';
import { HotSymbolLock } from './hot-symbol-lock.js';

const SHA40 = /^[0-9a-f]{40}$/i;

function acceptedEvidenceBundle(task) {
  return [...(task?.lineage ?? [])].reverse().find((entry) => entry.state === TaskState.ACCEPTED && entry.evidence?.evidenceBundle)?.evidence?.evidenceBundle ?? null;
}

function taskPriority(task) { return Number(task?.metadata?.priority ?? 0); }

function lineEstimate(content) {
  return Math.max(1, String(content ?? '').split(/\r?\n/).length);
}

function automaticUnits(execution = {}) {
  if (!Array.isArray(execution.precomputedWrites) || execution.precomputedWrites.length < 2) return [];
  return execution.precomputedWrites.map((write, index) => ({
    id: `write-${index + 1}:${write.path}`,
    files: [String(write.path)],
    estimatedLines: lineEstimate(write.content),
    estimatedMs: Math.max(250, lineEstimate(write.content) * 8),
    payload: { precomputedWrites: [structuredClone(write)], transformId: execution.transformId ?? null }
  }));
}

function explicitUnits(execution = {}) {
  const rows = execution.microSharding?.units;
  return Array.isArray(rows) ? rows.map((row) => structuredClone(row)) : [];
}

function flattenShardWrites(shard) {
  return shard.payloads.flatMap((payload) => Array.isArray(payload?.precomputedWrites) ? payload.precomputedWrites : []).map((row) => structuredClone(row));
}

function shardGoal(parent, shard) {
  const goals = shard.payloads.map((payload) => payload?.objective).filter(Boolean);
  if (goals.length) return goals.join('\n\n');
  return `Execute micro-shard ${shard.shardKey} for parent ${parent.key}. Restrict mutations to the declared shard scope. Parent objective: ${parent.objective}`;
}

function shardChecks(parent, shard) {
  const configured = parent.metadata?.execution?.microSharding?.shardTestCommands;
  const payloadChecks = shard.payloads.flatMap((payload) => Array.isArray(payload?.testCommands) ? payload.testCommands : []);
  if (payloadChecks.length) return payloadChecks;
  return Array.isArray(configured) ? structuredClone(configured) : [];
}

function acceptanceFor(testCommands) {
  return {
    requiredChecks: testCommands.map((entry, index) => entry.name ?? `test-${index + 1}`),
    requireIndependentVerifier: false
  };
}

// The (executor, task-class) pairing AdaptiveShardSizer learns against. modelRequest.model is
// the most stable identifier for "who is going to execute this shard"; fall back to the
// transform or a generic bucket so sizing still adapts (against a coarser pairing) even when
// no explicit model is pinned.
function executorIdFor(execution) {
  return execution?.modelRequest?.model ?? execution?.transformId ?? 'default-executor';
}

function taskClassFor(parent) {
  return parent.taskClass ?? parent.metadata?.execution?.kind ?? 'coding-agent';
}

function sizingFeaturesFor(parent, units) {
  const totalFiles = units.reduce((sum, unit) => sum + (unit.files?.length ?? 0), 0);
  return {
    novelty: parent.metadata?.execution?.microSharding?.novelty ?? 0.5,
    dependencyDepth: (parent.dependencies ?? []).length,
    mutationSurface: clamp01(totalFiles / Math.max(1, units.length * 3)),
    contextEntropy: 0.5,
    verifierCost: 0.5
  };
}

function clamp01(value) { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }

function shardOutcomeFrom(action) {
  if (action === 'ACCEPT') return 'accepted';
  if (action === 'REPAIR' || action === 'RETRY') return 'repaired';
  return 'failed';
}

export class MicroShardCoordinator {
  constructor({ runtime, patchFabric, shardPlanner, hotSymbolLock = new HotSymbolLock(), compositionBisector = new CompositionBisector() } = {}) {
    if (!runtime || !patchFabric || !shardPlanner) throw new Error('runtime, patchFabric and shardPlanner are required');
    this.runtime = runtime;
    this.patchFabric = patchFabric;
    this.shardPlanner = shardPlanner;
    this.hotSymbolLock = hotSymbolLock;
    this.compositionBisector = compositionBisector;
    this.pendingBisectionVerifications = new Map();
    this.activeBisections = new Set();
  }

  materialize({ workers = [], verifierSlots = null, composerSlots = 1, now = Date.now() } = {}) {
    const availableSlots = workers.reduce((sum, worker) => sum + Math.max(0, Number(worker.capacity?.freeSlots ?? 0)), 0);
    if (availableSlots < 2) return [];
    const created = [];
    for (const parent of this.runtime.graph.frontier((task) => task?.metadata?.execution?.kind === 'coding-agent' && !task.metadata?.patchFabric)) {
      const execution = parent.metadata.execution;
      const baseSha = String(execution.ref ?? '').toLowerCase();
      if (!SHA40.test(baseSha)) continue;
      if (execution.microSharding?.disabled === true) continue;
      const explicit = explicitUnits(execution);
      const units = explicit.length ? explicit : automaticUnits(execution);
      if (units.length < 2) continue;
      const executorId = executorIdFor(execution);
      const taskClass = taskClassFor(parent);
      const plan = this.shardPlanner.plan({
        parentTaskKey: parent.key,
        baseSha,
        units,
        availableSlots,
        verifierSlots: verifierSlots ?? Math.max(1, Math.floor(availableSlots / 2)),
        composerSlots,
        estimatedMonolithicMs: execution.microSharding?.estimatedMonolithicMs ?? null,
        maxShards: execution.microSharding?.maxShards ?? Math.min(64, availableSlots),
        riskClass: parent.riskClass,
        executorId,
        taskClass,
        sizingFeatures: sizingFeaturesFor(parent, units)
      });
      if (plan.mode !== 'micro-sharded') continue;

      // Hot-symbol serialization: shards that would contend for an identifier the lock
      // considers "hot" (frequently touched across recent shards) are given a real task
      // dependency on whichever earlier shard in this batch already claims it, so the
      // scheduler serializes just that contended pair instead of every shard racing on it
      // (and instead of a whole-repository lock). Shards touching nothing hot stay fully
      // parallel, exactly as before.
      const holderOfIdentifier = new Map();
      const hotDependencies = new Map();
      for (const shard of plan.shards) {
        const contended = this.hotSymbolLock.contendedIdentifiers(shard);
        const deps = new Set();
        for (const identifier of contended) {
          const holder = holderOfIdentifier.get(identifier);
          if (holder && holder !== shard.shardKey) deps.add(holder);
        }
        if (deps.size) hotDependencies.set(shard.shardKey, [...deps]);
        const acquisition = this.hotSymbolLock.acquire(shard.shardKey, shard);
        if (acquisition.acquired) for (const identifier of acquisition.hotIdentifiers) holderOfIdentifier.set(identifier, shard.shardKey);
      }

      const session = this.patchFabric.start({
        parentTaskKey: parent.key,
        repository: parent.repository,
        baseSha,
        shardKeys: plan.shards.map((shard) => shard.shardKey),
        verificationTier: 'parent-full',
        now
      });
      this.runtime.graph.upsert({
        ...parent,
        metadata: {
          ...parent.metadata,
          patchFabric: {
            kind: 'parent', sessionId: session.sessionId, state: 'SHARDS_IN_FLIGHT', plan: structuredClone(plan), baseSha
          }
        }
      });
      this.runtime.graph.setState(parent.key, TaskState.BLOCKED, { reason: 'patch-shards-in-flight', patchSessionId: session.sessionId, shardCount: plan.shards.length });

      for (const shard of plan.shards) {
        const precomputedWrites = flattenShardWrites(shard);
        const testCommands = shardChecks(parent, shard);
        const shardTransformId = precomputedWrites.length ? (shard.payloads.find((payload) => payload?.transformId)?.transformId ?? execution.transformId ?? null) : undefined;
        const child = {
          key: shard.shardKey,
          repository: parent.repository,
          product: parent.product,
          objective: shardGoal(parent, shard),
          dependencies: hotDependencies.get(shard.shardKey) ?? [],
          blockers: [],
          humanGates: [],
          riskClass: parent.riskClass,
          taskClass: 'micro-shard',
          requirements: structuredClone(parent.requirements),
          dedupeKey: `patch-shard:${session.sessionId}:${shard.shardKey}`,
          state: TaskState.READY,
          metadata: {
            priority: taskPriority(parent),
            restartable: true,
            suppressPromotion: true,
            mutationScopes: shard.scope.files.map((file) => `file:${parent.repository}:${file}`),
            acceptance: acceptanceFor(testCommands),
            ...(precomputedWrites.length ? {} : { modelRequest: structuredClone(parent.metadata.modelRequest ?? null) }),
            patchFabric: {
              kind: 'shard', sessionId: session.sessionId, parentTaskKey: parent.key, shardKey: shard.shardKey, baseSha,
              executorId, taskClass, estimatedLines: shard.estimatedLines, hotIdentifiers: this.hotSymbolLock.contendedIdentifiers(shard)
            },
            execution: {
              ...structuredClone(execution),
              ref: baseSha,
              branchBase: `${execution.branchBase}-shard-${digest(shard.shardKey).slice(0, 8)}`,
              goal: shardGoal(parent, shard),
              acceptance: acceptanceFor(testCommands),
              testCommands,
              autoCommit: true,
              autoPush: false,
              taskKey: shard.shardKey,
              microSharding: { disabled: true },
              precomputedWrites: precomputedWrites.length ? precomputedWrites : undefined,
              transformId: shardTransformId,
              patchBundle: {
                enabled: true,
                parentTaskKey: parent.key,
                shardKey: shard.shardKey,
                baseSha,
                scope: structuredClone(shard.scope),
                dependsOn: []
              }
            }
          }
        };
        this.runtime.ingest(child, { idempotencyKey: child.dedupeKey, now });
      }
      this.runtime.journal.append('patch.session.materialized', { parentTaskKey: parent.key, sessionId: session.sessionId, shardKeys: plan.shards.map((shard) => shard.shardKey), projectedSpeedup: plan.projectedSpeedup }, now);
      created.push({ parentTaskKey: parent.key, sessionId: session.sessionId, plan });
    }
    return created;
  }

  reconcile(reconciled = [], { now = Date.now() } = {}) {
    const submitted = [];
    const composed = [];
    const acceptedParents = [];
    const failedParents = [];

    // Resolve any in-flight composition-bisection probe tasks: each probe's `verify()` call is
    // suspended on a promise until the real acceptance pipeline resolves it here, letting the
    // bisector's ddmin search drive real (not simulated) verification across ticks.
    for (const row of reconciled) {
      const resolve = this.pendingBisectionVerifications.get(row.taskKey);
      if (!resolve) continue;
      this.pendingBisectionVerifications.delete(row.taskKey);
      resolve(row.action === 'ACCEPT');
    }

    for (const row of reconciled) {
      if (row.action !== 'TERMINATE') continue;
      const failedTask = this.runtime.graph.get(row.taskKey);
      const shard = failedTask?.metadata?.patchFabric?.kind === 'shard'
        ? failedTask
        : failedTask?.metadata?.repairOf ? this.runtime.graph.get(failedTask.metadata.repairOf) : null;
      const patch = shard?.metadata?.patchFabric;
      if (!shard || patch?.kind !== 'shard') continue;
      const session = this.patchFabric.get(patch.sessionId);
      if (!session || ['FAILED', 'ACCEPTED', 'CANCELLED'].includes(session.state)) continue;
      this.patchFabric.fail(patch.sessionId, {
        phase: 'shard',
        error: `terminal micro-shard failure: ${shard.key}`,
        evidence: { failedTaskKey: failedTask.key, shardTaskKey: shard.key, action: row.action },
        now
      });
      if (shard.state !== TaskState.FAILED) this.runtime.graph.setState(shard.key, TaskState.FAILED, { reason: 'patch-shard-terminal-failure', failedTaskKey: failedTask.key });
      this.hotSymbolLock.release(shard.key);
      this.shardPlanner.recordShardOutcome({ executorId: patch.executorId, taskClass: patch.taskClass, shardLines: patch.estimatedLines, outcome: 'failed', now });
      const parent = this.runtime.graph.get(patch.parentTaskKey);
      if (parent && parent.state !== TaskState.ACCEPTED) {
        this.runtime.graph.setState(parent.key, TaskState.FAILED, {
          reason: 'patch-shard-terminal-failure', patchSessionId: patch.sessionId, shardTaskKey: shard.key, failedTaskKey: failedTask.key
        });
        this.runtime.journal.append('patch.parent.failed', { parentTaskKey: parent.key, sessionId: patch.sessionId, shardTaskKey: shard.key, failedTaskKey: failedTask.key }, now);
        failedParents.push({ parentTaskKey: parent.key, sessionId: patch.sessionId, shardTaskKey: shard.key, failedTaskKey: failedTask.key, action: row.action });
      }
    }

    const candidateKeys = new Set();
    for (const row of reconciled) {
      if (row.action === 'ACCEPT') candidateKeys.add(row.taskKey);
      if (row.parentTaskKey && row.parentState === TaskState.ACCEPTED) candidateKeys.add(row.parentTaskKey);
    }

    for (const taskKey of candidateKeys) {
      const task = this.runtime.graph.get(taskKey);
      const patch = task?.metadata?.patchFabric;
      if (!task || task.state !== TaskState.ACCEPTED || patch?.kind !== 'shard') continue;
      const evidenceBundle = acceptedEvidenceBundle(task);
      const bundle = evidenceBundle?.payload?.evidence?.artifacts?.patchBundle;
      if (!bundle) throw new Error(`accepted micro-shard is missing patch bundle: ${task.key}`);
      const session = this.patchFabric.get(patch.sessionId);
      if (!session) throw new Error(`missing patch session for shard: ${task.key}`);
      if (session.state === 'FAILED') continue;
      if (session.bundleDigests?.[patch.shardKey]) continue;
      const next = this.patchFabric.submit(patch.sessionId, bundle, { expectedGeneration: bundle.generation, now });
      submitted.push({ taskKey, sessionId: patch.sessionId, shardKey: patch.shardKey, state: next.state });
      this.hotSymbolLock.release(task.key);
      this.shardPlanner.recordShardOutcome({ executorId: patch.executorId, taskClass: patch.taskClass, shardLines: patch.estimatedLines ?? bundle.writes?.length, outcome: 'accepted', now });
    }

    for (const session of this.patchFabric.list().filter((row) => row.state === 'READY_TO_COMPOSE')) {
      const parent = this.runtime.graph.get(session.parentTaskKey);
      if (!parent || parent.state === TaskState.FAILED) continue;
      const existing = this.runtime.graph.list().find((task) => task.metadata?.patchFabric?.kind === 'composition' && task.metadata.patchFabric.sessionId === session.sessionId);
      if (existing) continue;
      const composition = this.patchFabric.compose(session.sessionId, { now });
      const execution = parent.metadata.execution;
      const testCommands = structuredClone(execution.testCommands ?? []);
      const integrationKey = `${parent.key}:composition:${composition.compositionDigest.slice(0, 16)}`;
      const child = {
        key: integrationKey,
        repository: parent.repository,
        product: parent.product,
        objective: `Compose and fully verify ${composition.shardOrder.length} accepted micro-shards for ${parent.objective}`,
        dependencies: [], blockers: [], humanGates: [], riskClass: parent.riskClass,
        taskClass: 'patch-composition',
        requirements: structuredClone(parent.requirements),
        dedupeKey: `patch-composition:${session.sessionId}:${composition.compositionDigest}`,
        state: TaskState.READY,
        metadata: {
          priority: taskPriority(parent),
          restartable: true,
          suppressPromotion: true,
          mutationScopes: structuredClone(parent.metadata.mutationScopes ?? [`repo:${parent.repository}`]),
          acceptance: structuredClone(parent.metadata.acceptance ?? acceptanceFor(testCommands)),
          patchFabric: { kind: 'composition', sessionId: session.sessionId, parentTaskKey: parent.key, compositionDigest: composition.compositionDigest, baseSha: session.baseSha },
          execution: {
            ...structuredClone(execution),
            ref: session.baseSha,
            goal: `Apply the composed Patch Fabric output for ${parent.key} and execute the complete parent acceptance contract.`,
            precomputedWrites: composition.writes.map((write) => ({ path: write.path, content: write.content, delete: write.delete })),
            transformId: `patch-composition:${composition.compositionDigest}`,
            acceptance: structuredClone(parent.metadata.acceptance ?? acceptanceFor(testCommands)),
            testCommands,
            autoCommit: true,
            autoPush: true,
            taskKey: integrationKey,
            microSharding: { disabled: true }
          }
        }
      };
      delete child.metadata.modelRequest;
      this.runtime.ingest(child, { idempotencyKey: child.dedupeKey, now });
      this.runtime.journal.append('patch.session.composed', { parentTaskKey: parent.key, sessionId: session.sessionId, integrationTaskKey: integrationKey, compositionDigest: composition.compositionDigest }, now);
      composed.push({ parentTaskKey: parent.key, sessionId: session.sessionId, integrationTaskKey: integrationKey, compositionDigest: composition.compositionDigest });
    }

    for (const row of reconciled) {
      const task = this.runtime.graph.get(row.taskKey);
      const patch = task?.metadata?.patchFabric;
      if (!task || patch?.kind !== 'composition') continue;
      const parent = this.runtime.graph.get(patch.parentTaskKey);
      if (!parent) continue;
      if (row.action === 'ACCEPT' && task.state === TaskState.ACCEPTED) {
        const evidenceBundle = acceptedEvidenceBundle(task);
        const acceptedSha = evidenceBundle?.payload?.evidence?.artifacts?.commitSha;
        if (!acceptedSha) throw new Error(`accepted patch composition is missing commit SHA: ${task.key}`);
        const session = this.patchFabric.get(patch.sessionId);
        if (session?.state === 'COMPOSED') this.patchFabric.recordParentVerification(patch.sessionId, { accepted: true, acceptedSha, evidence: { evidenceBundleDigest: evidenceBundle.digest, integrationTaskKey: task.key }, now });
        const acceptedParent = this.runtime.graph.setState(parent.key, TaskState.ACCEPTED, {
          reason: 'patch-fabric-parent-accepted',
          patchSessionId: patch.sessionId,
          compositionDigest: patch.compositionDigest,
          integrationTaskKey: task.key,
          evidenceBundle
        });
        this.runtime.journal.append('patch.parent.accepted', { parentTaskKey: parent.key, sessionId: patch.sessionId, integrationTaskKey: task.key, acceptedSha }, now);
        acceptedParents.push({ task: acceptedParent, evidenceBundle });
      } else if (['TERMINATE', 'ESCALATE'].includes(row.action)) {
        const session = this.patchFabric.get(patch.sessionId);
        const wasComposed = session?.state === 'COMPOSED';
        if (wasComposed) this.patchFabric.recordParentVerification(patch.sessionId, { accepted: false, evidence: { integrationTaskKey: task.key, action: row.action }, now });
        this.runtime.graph.setState(parent.key, TaskState.BLOCKED, { reason: 'patch-parent-verification-failed', patchSessionId: patch.sessionId, integrationTaskKey: task.key, action: row.action });
        failedParents.push({ parentTaskKey: parent.key, sessionId: patch.sessionId, integrationTaskKey: task.key, action: row.action });
        // A composed batch failed real integration verification. Instead of leaving the parent
        // blocked with no more information than "it failed", bisect the accepted shards to find
        // the minimal subset that's actually responsible, driving real re-verification (through
        // the normal task/acceptance pipeline, not a simulation) rather than guessing.
        if (wasComposed && this.compositionBisector && !this.activeBisections.has(patch.sessionId)) {
          this.activeBisections.add(patch.sessionId);
          void this.#runCompositionBisection(patch.sessionId, task.key, row.action, now)
            .catch((error) => this.runtime.journal.append('patch.composition.bisection-error', { sessionId: patch.sessionId, integrationTaskKey: task.key, error: error.message }, now))
            .finally(() => this.activeBisections.delete(patch.sessionId));
        }
      }
    }

    return { submitted, composed, acceptedParents, failedParents };
  }

  /**
   * Bisect a failed composed batch to isolate the minimal failing subset of accepted shards.
   * Each candidate subset is *really* recomposed and re-verified through the normal patch
   * micro-shard task/acceptance pipeline (a "bisection probe" task), so the result reflects
   * actual verification outcomes rather than a structural guess.
   */
  async #runCompositionBisection(sessionId, integrationTaskKey, failureAction, now) {
    const session = this.patchFabric.get(sessionId);
    if (!session) return null;
    const bundles = session.expectedShardKeys
      .map((shardKey) => this.patchFabric.bundleStore.get(session.bundleDigests[shardKey]))
      .filter(Boolean);
    if (bundles.length < 2) return null; // nothing to bisect with a single shard

    let probeSequence = 0;
    const verify = async (subsetBundles) => {
      probeSequence += 1;
      const parent = this.runtime.graph.get(session.parentTaskKey);
      if (!parent) return false;
      const composition = this.patchFabric.composer.compose({ baseSha: session.baseSha, bundles: subsetBundles, parentTaskKey: session.parentTaskKey, now: Date.now() });
      const execution = parent.metadata.execution;
      const testCommands = structuredClone(execution.testCommands ?? []);
      const probeKey = `${session.parentTaskKey}:bisect:${sessionId.slice(0, 8)}:${probeSequence}:${composition.compositionDigest.slice(0, 10)}`;
      const child = {
        key: probeKey,
        repository: parent.repository,
        product: parent.product,
        objective: `Composition-bisection re-verify of ${subsetBundles.length}/${bundles.length} shards for ${parent.objective}`,
        dependencies: [], blockers: [], humanGates: [], riskClass: parent.riskClass,
        taskClass: 'patch-composition-bisect-probe',
        requirements: structuredClone(parent.requirements),
        dedupeKey: `patch-bisect-probe:${sessionId}:${composition.compositionDigest}`,
        state: TaskState.READY,
        metadata: {
          priority: taskPriority(parent),
          restartable: true,
          suppressPromotion: true,
          mutationScopes: structuredClone(parent.metadata.mutationScopes ?? [`repo:${parent.repository}`]),
          acceptance: structuredClone(parent.metadata.acceptance ?? acceptanceFor(testCommands)),
          patchFabric: { kind: 'bisection-probe', sessionId, parentTaskKey: session.parentTaskKey, subsetKeys: subsetBundles.map((bundle) => bundle.shardKey).sort() },
          execution: {
            ...structuredClone(execution),
            ref: session.baseSha,
            goal: `Verify a bisection candidate subset of composed shards for ${parent.key}.`,
            precomputedWrites: composition.writes.map((write) => ({ path: write.path, content: write.content, delete: write.delete })),
            transformId: `patch-bisect-probe:${composition.compositionDigest}`,
            acceptance: structuredClone(parent.metadata.acceptance ?? acceptanceFor(testCommands)),
            testCommands,
            autoCommit: false,
            autoPush: false,
            taskKey: probeKey,
            microSharding: { disabled: true }
          }
        }
      };
      delete child.metadata.modelRequest;
      this.runtime.ingest(child, { idempotencyKey: child.dedupeKey, now: Date.now() });
      return new Promise((resolve) => this.pendingBisectionVerifications.set(probeKey, resolve));
    };

    const result = await this.compositionBisector.bisect({ bundles, verify, now });
    this.runtime.journal.append('patch.composition.bisected', {
      sessionId, integrationTaskKey, failureAction, allKeys: result.allKeys, minimalFailingSubset: result.minimalFailingSubset,
      verifications: result.verifications, note: result.note
    }, now);
    try {
      const parent = this.runtime.graph.get(session.parentTaskKey);
      if (parent && parent.state === TaskState.BLOCKED) {
        this.runtime.graph.upsert({ ...parent, metadata: { ...parent.metadata, patchFabric: { ...parent.metadata.patchFabric, bisection: { minimalFailingSubset: result.minimalFailingSubset, note: result.note, verifications: result.verifications } } } });
      }
    } catch { /* best-effort diagnostic attach; never let this affect the failure path itself */ }
    return result;
  }
}
