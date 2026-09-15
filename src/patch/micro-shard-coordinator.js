import { TaskState } from '../core/task-graph.js';
import { digest } from '../leverage/solution-cas.js';
import { ShardObservabilityRegistry, ShardLifecycleEvent, shardIdentity } from '../telemetry/shard-observability.js';
import { CertificateCache, EvidenceGraph, EvidenceNodeKind, EvidenceComposability, issueProofCertificate } from '../verification/proof-certificate.js';

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
  // Live by default: real shard lifecycle events (issue #67) and proof certificates (issue #69)
  // are recorded/issued on every materialize()/reconcile() call. Callers may inject their own
  // ShardObservabilityRegistry / CertificateCache / EvidenceGraph (e.g. to share one instance
  // across coordinators or to persist/restore it), but there is no flag to disable the wiring —
  // this is the live scheduling/acceptance path, not shadow mode.
  constructor({
    runtime, patchFabric, shardPlanner,
    shardObservability = new ShardObservabilityRegistry(),
    certificateCache = new CertificateCache(),
    evidenceGraph = new EvidenceGraph(),
    policyVersion = 'micro-shard-coordinator-v1',
    environmentFingerprint = 'micro-shard-coordinator-default-env'
  } = {}) {
    if (!runtime || !patchFabric || !shardPlanner) throw new Error('runtime, patchFabric and shardPlanner are required');
    this.runtime = runtime;
    this.patchFabric = patchFabric;
    this.shardPlanner = shardPlanner;
    this.shardObservability = shardObservability;
    this.certificateCache = certificateCache;
    this.evidenceGraph = evidenceGraph;
    this.policyVersion = policyVersion;
    this.environmentFingerprint = environmentFingerprint;
  }

  #shardIdentity(parentTaskKey, shardKey, baseSha) {
    return shardIdentity({
      parentTaskKey, shardKey, sourceSha: baseSha, policyVersion: this.policyVersion,
      environmentFingerprint: this.environmentFingerprint, leaseGeneration: 1
    });
  }

  #ensureEvidenceLineage(parent, sessionId) {
    const intentId = `intent:${parent.key}`;
    if (!this.evidenceGraph.nodes.has(intentId)) {
      this.evidenceGraph.addNode({ id: intentId, kind: EvidenceNodeKind.INTENT, data: { taskKey: parent.key, objective: parent.objective } });
    }
    const workPacketId = `work-packet:${sessionId}`;
    if (!this.evidenceGraph.nodes.has(workPacketId)) {
      this.evidenceGraph.addNode({ id: workPacketId, kind: EvidenceNodeKind.WORK_PACKET, data: { sessionId }, parents: [intentId] });
    }
    return workPacketId;
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

      const workPacketId = this.#ensureEvidenceLineage(parent, session.sessionId);

      for (const shard of plan.shards) {
        // Real shard lifecycle telemetry (issue #67): the shard is admitted into the coordinator
        // and immediately enters the ready queue as its child task is ingested below.
        const identity = this.#shardIdentity(parent.key, shard.shardKey, baseSha);
        const tracker = this.shardObservability.tracker(identity, {
          repository: parent.repository, parentTaskKey: parent.key, taskClass: 'micro-shard', productFamily: parent.product
        });
        tracker.record({ event: ShardLifecycleEvent.ADMITTED, wallClockMs: now });
        tracker.record({ event: ShardLifecycleEvent.QUEUED, wallClockMs: now });

        const shardNodeId = `shard:${shard.shardKey}`;
        if (!this.evidenceGraph.nodes.has(shardNodeId)) {
          this.evidenceGraph.addNode({ id: shardNodeId, kind: EvidenceNodeKind.SHARD, data: { shardKey: shard.shardKey, files: shard.scope.files }, parents: [workPacketId] });
        }

        const precomputedWrites = flattenShardWrites(shard);
        const testCommands = shardChecks(parent, shard);
        const shardTransformId = precomputedWrites.length ? (shard.payloads.find((payload) => payload?.transformId)?.transformId ?? execution.transformId ?? null) : undefined;
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
            patchFabric: { kind: 'shard', sessionId: session.sessionId, parentTaskKey: parent.key, shardKey: shard.shardKey, baseSha, identityDigest: identity.identityDigest },
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
      const failedTracker = shard.metadata?.patchFabric?.identityDigest
        ? this.shardObservability.trackers.get(shard.metadata.patchFabric.identityDigest)
        : null;
      if (failedTracker) failedTracker.record({ event: ShardLifecycleEvent.REJECTED, wallClockMs: now });
      this.patchFabric.fail(patch.sessionId, {
        phase: 'shard',
        error: `terminal micro-shard failure: ${shard.key}`,
        evidence: { failedTaskKey: failedTask.key, shardTaskKey: shard.key, action: row.action },
        now
      });
      if (shard.state !== TaskState.FAILED) this.runtime.graph.setState(shard.key, TaskState.FAILED, { reason: 'patch-shard-terminal-failure', failedTaskKey: failedTask.key });
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

      // Real shard lifecycle telemetry (issue #67): the shard's mutation has been emitted and
      // independently accepted by the runtime's own verification, so record the remaining
      // observable stages up to the shard's terminal state before submitting it into composition.
      const tracker = patch.identityDigest ? this.shardObservability.trackers.get(patch.identityDigest) : null;
      if (tracker) {
        tracker.record({ event: ShardLifecycleEvent.MUTATION_EMITTED, wallClockMs: now });
        tracker.record({ event: ShardLifecycleEvent.VERIFY_COMPLETE, wallClockMs: now });
        tracker.record({ event: ShardLifecycleEvent.ACCEPTED, wallClockMs: now });
      }

      // Real proof certificate (issue #69): issued from the same accepted evidence bundle that
      // just drove the shard task's own acceptance — never a synthetic/placeholder certificate.
      try {
        const producerId = evidenceBundle.payload?.producerId ?? evidenceBundle.producerId ?? bundle.workerId ?? patch.shardKey;
        const verifierId = evidenceBundle.payload?.verifierId ?? evidenceBundle.verifierId ?? null;
        const independentlyVerified = Boolean(verifierId) && verifierId !== producerId;
        const certificate = issueProofCertificate({
          evidenceBundle,
          sourceSha: patch.baseSha,
          mutationDigest: bundle.bundleDigest,
          environmentFingerprint: this.environmentFingerprint,
          policyVersion: this.policyVersion,
          executorId: producerId,
          verifierId: independentlyVerified ? verifierId : `${producerId}:self-verified`,
          acceptanceContractDigest: digest(task.metadata?.acceptance ?? {}),
          checks: {
            tests: [{
              name: 'shard-acceptance-evidence-bundle',
              passed: true,
              verifiedBy: independentlyVerified ? verifierId : null,
              selfReported: !independentlyVerified,
              detail: { evidenceBundleDigest: evidenceBundle.digest }
            }]
          },
          composability: EvidenceComposability.COMPOSABLE,
          now
        });
        this.certificateCache.put(certificate);
        const shardNodeId = `shard:${patch.shardKey}`;
        const evidenceNodeId = `evidence:${task.key}`;
        if (this.evidenceGraph.nodes.has(shardNodeId) && !this.evidenceGraph.nodes.has(evidenceNodeId)) {
          this.evidenceGraph.addNode({
            id: evidenceNodeId, kind: EvidenceNodeKind.VALIDATION_EVIDENCE,
            data: { certificateFingerprint: certificate.fingerprint }, parents: [shardNodeId]
          });
        }
      } catch (error) {
        // Certificate issuance must never block the real accept/submit flow it is observing;
        // surface the failure on the journal instead of silently swallowing it.
        this.runtime.journal.append('patch.shard.certificate.failed', { taskKey: task.key, shardKey: patch.shardKey, error: error.message }, now);
      }

      const next = this.patchFabric.submit(patch.sessionId, bundle, { expectedGeneration: bundle.generation, now });
      submitted.push({ taskKey, sessionId: patch.sessionId, shardKey: patch.shardKey, state: next.state });
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
        try {
          const candidateShaId = `candidate-sha:${acceptedSha}`;
          const evidenceParents = (session?.expectedShardKeys ?? []).map((key) => `evidence:${key}`).filter((id) => this.evidenceGraph.nodes.has(id));
          if (!this.evidenceGraph.nodes.has(candidateShaId) && evidenceParents.length) {
            this.evidenceGraph.addNode({ id: candidateShaId, kind: EvidenceNodeKind.CANDIDATE_SHA, data: { acceptedSha, compositionDigest: patch.compositionDigest }, parents: evidenceParents });
          }
          const mergeId = `merge:${task.key}`;
          if (!this.evidenceGraph.nodes.has(mergeId) && this.evidenceGraph.nodes.has(candidateShaId)) {
            this.evidenceGraph.addNode({ id: mergeId, kind: EvidenceNodeKind.MERGE, data: { integrationTaskKey: task.key, parentTaskKey: parent.key }, parents: [candidateShaId] });
          }
        } catch (error) {
          this.runtime.journal.append('patch.evidence.graph.failed', { parentTaskKey: parent.key, integrationTaskKey: task.key, error: error.message }, now);
        }
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
