import { TaskState } from '../core/task-graph.js';
import { digest } from '../leverage/solution-cas.js';

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

export class MicroShardCoordinator {
  constructor({ runtime, patchFabric, shardPlanner } = {}) {
    if (!runtime || !patchFabric || !shardPlanner) throw new Error('runtime, patchFabric and shardPlanner are required');
    this.runtime = runtime;
    this.patchFabric = patchFabric;
    this.shardPlanner = shardPlanner;
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
      const units = explicitUnits(execution).length ? explicitUnits(execution) : automaticUnits(execution);
      if (units.length < 2) continue;
      const plan = this.shardPlanner.plan({
        parentTaskKey: parent.key,
        baseSha,
        units,
        availableSlots,
        verifierSlots: verifierSlots ?? Math.max(1, Math.floor(availableSlots / 2)),
        composerSlots,
        estimatedMonolithicMs: execution.microSharding?.estimatedMonolithicMs ?? null,
        maxShards: execution.microSharding?.maxShards ?? Math.min(64, availableSlots),
        riskClass: parent.riskClass
      });
      if (plan.mode !== 'micro-sharded') continue;

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
        const child = {
          key: shard.shardKey,
          repository: parent.repository,
          product: parent.product,
          objective: shardGoal(parent, shard),
          dependencies: [],
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
            patchFabric: { kind: 'shard', sessionId: session.sessionId, parentTaskKey: parent.key, shardKey: shard.shardKey, baseSha },
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
              ...(precomputedWrites.length ? { precomputedWrites, transformId: shard.payloads.find((payload) => payload?.transformId)?.transformId ?? execution.transformId ?? null } : {}),
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
      if (session.bundleDigests?.[patch.shardKey]) continue;
      const next = this.patchFabric.submit(patch.sessionId, bundle, { expectedGeneration: bundle.generation, now });
      submitted.push({ taskKey, sessionId: patch.sessionId, shardKey: patch.shardKey, state: next.state });
    }

    for (const session of this.patchFabric.list().filter((row) => row.state === 'READY_TO_COMPOSE')) {
      const parent = this.runtime.graph.get(session.parentTaskKey);
      if (!parent) continue;
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
        if (session?.state === 'COMPOSED') this.patchFabric.recordParentVerification(patch.sessionId, { accepted: false, evidence: { integrationTaskKey: task.key, action: row.action }, now });
        this.runtime.graph.setState(parent.key, TaskState.BLOCKED, { reason: 'patch-parent-verification-failed', patchSessionId: patch.sessionId, integrationTaskKey: task.key, action: row.action });
        failedParents.push({ parentTaskKey: parent.key, sessionId: patch.sessionId, integrationTaskKey: task.key, action: row.action });
      }
    }

    return { submitted, composed, acceptedParents, failedParents };
  }
}
