import { TaskState } from '../core/task-graph.js';
import { LeverageStrategy } from './leverage-engine.js';

export class LeverageRuntimeAdapter {
  constructor({ runtime, engine, cas, harvester, repairs = null } = {}) {
    if (!runtime || !engine || !cas || !harvester) throw new Error('runtime, engine, cas and harvester are required');
    this.runtime = runtime; this.engine = engine; this.cas = cas; this.harvester = harvester; this.repairs = repairs;
  }

  prepareCodingTask(task, { normalizedSpec = null, dependencySeeds = [], context = {}, environment = null, policyVersion = '1' } = {}) {
    const spec = normalizedSpec ?? { repository: task.repository, objective: task.objective, acceptance: task.metadata?.acceptance ?? {}, execution: { baseBranch: task.metadata?.execution?.baseBranch ?? 'main', ref: task.metadata?.execution?.ref ?? 'HEAD' } };
    const plan = this.engine.plan({ taskClass: task.taskClass ?? 'coding', normalizedSpec: spec, dependencySeeds, context, environment, policyVersion });
    task.metadata = { ...(task.metadata ?? {}), leverage: { strategy: plan.strategy, solutionKey: plan.solutionKey, transformId: plan.transformId ?? null, estimatedReasoningUnits: plan.estimatedReasoningUnits, dependencySlice: plan.dependencySlice ?? null, semanticExampleKeys: (plan.semanticExamples ?? []).map((x) => x.key) } };

    if (plan.strategy === LeverageStrategy.EXACT_REUSE) {
      this.runtime.ingest(task, { idempotencyKey: task.dedupeKey });
      this.runtime.graph.setState(task.key, TaskState.ACCEPTED, { reason: 'exact-solution-cache-hit', cachedSolution: plan.exact.result, leverage: task.metadata.leverage });
      this.runtime.journal.append('leverage.exact-reuse', { taskKey: task.key, solutionKey: plan.solutionKey });
      return { task: this.runtime.graph.get(task.key), plan, reused: true };
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
