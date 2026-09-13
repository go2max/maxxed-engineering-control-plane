import { TaskState } from '../core/task-graph.js';
import { LeverageStrategy } from './leverage-engine.js';

export class LeverageRuntimeAdapter {
  constructor({ runtime, engine, cas, harvester } = {}) {
    if (!runtime || !engine || !cas || !harvester) throw new Error('runtime, engine, cas and harvester are required');
    this.runtime = runtime; this.engine = engine; this.cas = cas; this.harvester = harvester;
  }

  prepareCodingTask(task, { normalizedSpec = null, dependencySeeds = [], context = {}, environment = null, policyVersion = '1' } = {}) {
    const spec = normalizedSpec ?? { repository: task.repository, objective: task.objective, acceptance: task.metadata?.acceptance ?? {}, execution: { baseBranch: task.metadata?.execution?.baseBranch ?? 'main', ref: task.metadata?.execution?.ref ?? 'HEAD' } };
    const plan = this.engine.plan({ taskClass: task.taskClass ?? 'coding', normalizedSpec: spec, dependencySeeds, context, environment, policyVersion });
    task.metadata = { ...(task.metadata ?? {}), leverage: { strategy: plan.strategy, solutionKey: plan.solutionKey, transformId: plan.transformId ?? null, estimatedReasoningUnits: plan.estimatedReasoningUnits, dependencySlice: plan.dependencySlice ?? null, semanticExampleKeys: (plan.semanticExamples ?? []).map((x) => x.key) } };

    if (plan.strategy === LeverageStrategy.EXACT_REUSE) {
      const accepted = this.runtime.ingest(task, { idempotencyKey: task.dedupeKey });
      this.runtime.graph.setState(task.key, TaskState.ACCEPTED, { reason: 'exact-solution-cache-hit', cachedSolution: plan.exact.result, leverage: task.metadata.leverage });
      this.runtime.journal.append('leverage.exact-reuse', { taskKey: task.key, solutionKey: plan.solutionKey });
      return { task: this.runtime.graph.get(task.key), plan, reused: true };
    }
    return { task, plan, reused: false };
  }

  recordAccepted(task, evidenceBundle, { model = null, timing = {}, now = Date.now() } = {}) {
    const leverage = task.metadata?.leverage;
    if (!leverage?.solutionKey) return null;
    const result = { evidenceBundle: structuredClone(evidenceBundle), artifacts: evidenceBundle?.payload?.evidence?.artifacts ?? {}, acceptedAt: now };
    this.cas.put(leverage.solutionKey, result, { confidence: 1, reusable: true, tags: [task.taskClass ?? 'coding', task.repository ?? 'unknown'], now });
    return this.harvester.record({ task, outcome: 'ACCEPT', evidence: { digest: evidenceBundle?.digest ?? null, artifacts: result.artifacts }, model, timing, source: 'control-plane-runtime' });
  }

  recordOutcome(task, outcome, evidence = {}, extra = {}) { return this.harvester.record({ task, outcome, evidence, ...extra, source: 'control-plane-runtime' }); }

  status() { return { cachedSolutions: this.cas.entries.size, trajectories: this.harvester.records.length }; }
}
