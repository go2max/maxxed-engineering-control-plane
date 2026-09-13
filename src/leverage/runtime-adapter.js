import { TaskState } from '../core/task-graph.js';
import { LeverageStrategy } from './leverage-engine.js';

function immutableSourceFingerprint(task, environment) {
  const explicit = environment?.repoSha ?? environment?.sourceFingerprint ?? null;
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  const ref = task.metadata?.execution?.ref ?? '';
  return /^[0-9a-f]{40}$/i.test(ref) ? ref : null;
}

function precomputedWrites(before = [], after = []) {
  const original = new Map(before.map((file) => [String(file.path), String(file.content ?? '')]));
  return after
    .filter((file) => original.get(String(file.path)) !== String(file.content ?? ''))
    .map((file) => ({ path: String(file.path), content: String(file.content ?? '') }));
}

export class LeverageRuntimeAdapter {
  constructor({ runtime, engine, cas, harvester, repairs = null } = {}) {
    if (!runtime || !engine || !cas || !harvester) throw new Error('runtime, engine, cas and harvester are required');
    this.runtime = runtime; this.engine = engine; this.cas = cas; this.harvester = harvester; this.repairs = repairs;
  }

  async prepareCodingTask(task, { normalizedSpec = null, dependencySeeds = [], context = {}, environment = null, policyVersion = '1' } = {}) {
    const sourceFingerprint = immutableSourceFingerprint(task, environment);
    const normalizedEnvironment = { ...(environment ?? {}), sourceFingerprint };
    const spec = normalizedSpec ?? { repository: task.repository, objective: task.objective, acceptance: task.metadata?.acceptance ?? {}, execution: { baseBranch: task.metadata?.execution?.baseBranch ?? 'main', ref: sourceFingerprint ?? task.metadata?.execution?.ref ?? 'HEAD' } };
    const plan = this.engine.plan({ taskClass: task.taskClass ?? 'coding', normalizedSpec: spec, dependencySeeds, context, environment: normalizedEnvironment, policyVersion, exactReuseAllowed: Boolean(sourceFingerprint) });
    task.metadata = { ...(task.metadata ?? {}), leverage: { strategy: plan.strategy, solutionKey: plan.solutionKey, transformId: plan.transformId ?? null, estimatedReasoningUnits: plan.estimatedReasoningUnits, dependencySlice: plan.dependencySlice ?? null, semanticExampleKeys: (plan.semanticExamples ?? []).map((x) => x.key), sourceFingerprint } };

    if (plan.strategy === LeverageStrategy.EXACT_REUSE) {
      this.runtime.ingest(task, { idempotencyKey: task.dedupeKey });
      this.runtime.graph.setState(task.key, TaskState.ACCEPTED, { reason: 'exact-solution-cache-hit', cachedSolution: plan.exact.result, leverage: task.metadata.leverage });
      this.runtime.journal.append('leverage.exact-reuse', { taskKey: task.key, solutionKey: plan.solutionKey, sourceFingerprint });
      return { task: this.runtime.graph.get(task.key), plan, reused: true };
    }

    if (plan.strategy === LeverageStrategy.DETERMINISTIC_TRANSFORM && sourceFingerprint && Array.isArray(context.files)) {
      const transformed = await this.engine.executeTransform(plan, context);
      const writes = precomputedWrites(context.files, transformed.result?.files ?? []);
      task.metadata.execution = {
        ...(task.metadata.execution ?? {}),
        ref: sourceFingerprint,
        transformId: plan.transformId,
        precomputedWrites: writes
      };
      delete task.metadata.modelRequest;
      task.metadata.leverage = {
        ...task.metadata.leverage,
        deterministicKey: transformed.deterministicKey,
        transformOutputDigest: transformed.outputDigest,
        precomputedWriteCount: writes.length,
        modelFreeExecution: true
      };
      this.runtime.journal.append('leverage.transform-materialized', { taskKey: task.key, transformId: plan.transformId, deterministicKey: transformed.deterministicKey, writeCount: writes.length, sourceFingerprint });
    }

    return { task, plan, reused: false };
  }

  recordAccepted(task, evidenceBundle, { model = null, timing = {}, now = Date.now() } = {}) {
    const leverage = task.metadata?.leverage;
    const result = { evidenceBundle: structuredClone(evidenceBundle), artifacts: evidenceBundle?.payload?.evidence?.artifacts ?? {}, acceptedAt: now };
    if (leverage?.solutionKey) this.cas.put(leverage.solutionKey, result, { confidence: 1, reusable: true, tags: [task.taskClass ?? 'coding', task.repository ?? 'unknown'], now });
    if (task.metadata?.repairOf && task.metadata?.failureFingerprint && this.repairs) {
      this.repairs.remember({ fingerprint: task.metadata.failureFingerprint, taskClass: task.taskClass ?? 'repair', repairPlan: task.metadata.repairPlan ?? null, patchSummary: result.artifacts?.summary ?? task.objective ?? null, commitSha: result.artifacts?.commitSha ?? null, accepted: true, metadata: { repairOf: task.metadata.repairOf, repository: task.repository }, now });
    }
    return this.harvester.record({ task, outcome: 'ACCEPT', evidence: { digest: evidenceBundle?.digest ?? null, artifacts: result.artifacts }, model, timing, source: 'control-plane-runtime' });
  }

  recordOutcome(task, outcome, evidence = {}, extra = {}) { return this.harvester.record({ task, outcome, evidence, ...extra, source: 'control-plane-runtime' }); }
  status() { return { cachedSolutions: this.cas.entries.size, trajectories: this.harvester.records.length, repairFingerprints: this.repairs?.byFingerprint?.size ?? 0 }; }
}
