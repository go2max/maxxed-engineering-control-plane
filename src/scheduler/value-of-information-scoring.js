// Value-of-information (VoI) scheduler scoring -- shadow-mode candidate (issue #105).
//
// This module is a SHADOW-ONLY alternative to `scoreTask` in `portfolio-scheduler.js`. It does
// not replace, call, or get called by the live scheduler; `PortfolioScheduler.planWithReport`
// is unmodified by this PR. Follows the same "pluggable alternative + counterfactual comparison
// without live authority" pattern this repo already uses for learned policies in
// `src/training/policy-promotion.js` (a SHADOW/CANARY-stage policy never becomes
// `getActivePolicy()`'s answer until it clears an explicit promotion gate). Here, that gate is
// wave 2 of this issue: nothing in this file is wired into `PortfolioScheduler` or the live
// dispatch loop.
//
// Scoring philosophy vs. the incumbent (`scoreTask`): the incumbent scores priority + age +
// unlock-count + critical-path position, i.e. "how important/urgent is this task". VoI scores
// "how much accepted value do we expect per unit of the resource this task consumes", i.e. an
// economic allocation of scarce model/verifier/worker/owner attention -- including information
// value for cheap probes that reduce uncertainty before expensive implementation work. These
// are genuinely different scoring philosophies (see docs/REUSE_FIRST_CHECKLIST.md step 1): this
// is additive new logic, not a second competing scheduler class, and it reuses the incumbent's
// eligibility/worker-fit/backpressure machinery in `portfolio-scheduler.js` unchanged (this
// module scores tasks only; it does not re-implement `requirementMatch`, lane limits, or
// backpressure).
//
// reuse: none
// reason: expected-value-per-resource scoring with an explicit information-value term for
// probes is specific to this repo's task/worker model (task.metadata fields, graph shape) and
// isn't a generic off-the-shelf algorithm; the reusable parts of scheduling (eligibility, worker
// fit, lane/backpressure limits, checkpointing) are reused unchanged from portfolio-scheduler.js
// and execution-checkpoint.js rather than reimplemented here.
//
// Deferred to wave 2 (explicitly NOT in this PR):
//   - Wiring `scoreTaskByValueOfInformation` (or a policy that chooses between it and `scoreTask`)
//     into `PortfolioScheduler.planWithReport` as the live scorer.
//   - Service-class-aware lane/capacity allocation (this PR only scores; it does not partition
//     worker capacity by service class).
//   - Automatic promotion of a VoI candidate to live authority based on shadow-log results --
//     that decision belongs to a human-adjacent review of accumulated shadow data, same as this
//     repo's policy-promotion PROMOTION_GATE stage.

/**
 * Service classes bias the aging/fairness curve and the information-value term. This is a
 * classification input to scoring, not a capacity partition (capacity partitioning is deferred
 * to wave 2).
 */
export const ServiceClass = Object.freeze({
  PROBE: 'PROBE', // cheap diagnostic/experiment work whose main value is uncertainty reduction
  STANDARD: 'STANDARD',
  CRITICAL: 'CRITICAL',
});

const SERVICE_CLASS_WEIGHT = Object.freeze({
  [ServiceClass.PROBE]: 1, // weight applied to informationValue, not to productValue
  [ServiceClass.STANDARD]: 1,
  [ServiceClass.CRITICAL]: 1.5,
});

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function resolveServiceClass(task) {
  const declared = task.metadata?.serviceClass ?? task.serviceClass;
  if (declared && Object.prototype.hasOwnProperty.call(SERVICE_CLASS_WEIGHT, declared)) return declared;
  if (task.metadata?.isProbe || task.taskClass === 'probe') return ServiceClass.PROBE;
  if (task.riskClass === 'critical') return ServiceClass.CRITICAL;
  return ServiceClass.STANDARD;
}

/**
 * Expected accepted value per unit of constrained resource, plus an explicit fairness/aging
 * term so this scorer -- like the incumbent -- never lets a low-priority task starve forever.
 *
 * Inputs read from `task.metadata` (all optional, all default to a neutral/conservative value
 * so a task with no VoI-specific metadata still scores sanely rather than throwing):
 *   - productValue: number, estimated business/product value if accepted (any consistent unit)
 *   - urgency: 0..1, how time-sensitive acceptance is
 *   - riskReductionValue: number, value of the uncertainty this task's outcome resolves for
 *     OTHER planned work (e.g. a probe that determines whether a large task is even viable)
 *   - blockingImpact: number, value unlocked in dependents if this completes (falls back to
 *     `graph.unlockCount(task.key)` when graph is provided, mirroring the incumbent's `unlock`)
 *   - reuseMultiplier: >=1, how many other consumers benefit from this task's output
 *   - executionCostUnits: number > 0, estimated resource cost to execute (worker/model time)
 *   - verificationCostUnits: number >= 0, estimated verifier/reviewer resource cost
 *   - acceptanceProbability: 0..1, estimated probability the result is accepted as-is
 *   - reversibility: 0..1, 1 = trivially revertible, 0 = irreversible (irreversible work is
 *     discounted, mirroring the incumbent's riskPenalty for high/critical riskClass)
 *   - informationGain: 0..1, for PROBE-class tasks, how much this reduces uncertainty about
 *     other planned/candidate work
 *   - createdAt: epoch ms, task creation time (same field the incumbent scorer reads)
 *
 * @param {{unlockCount?: (key: string) => number}} graph - optional; only `unlockCount` is used.
 * @param {Object} task
 * @param {{ now?: number, starvationMs?: number, agingBoostPerStep?: number, minResourceUnits?: number }} [options]
 */
export function scoreTaskByValueOfInformation(graph, task, {
  now = Date.now(),
  starvationMs = 30 * 60_000,
  agingBoostPerStep = 0.08, // fraction of the task's own resource-normalized value added per starvation step
  minResourceUnits = 0.1, // floor so a near-zero execution cost can't divide-by-near-zero and dominate ranking
} = {}) {
  const m = task.metadata ?? {};
  const serviceClass = resolveServiceClass(task);

  const productValue = Number(m.productValue ?? 0);
  const urgency = clamp01(m.urgency ?? 0);
  const riskReductionValue = Number(m.riskReductionValue ?? 0);
  const reuseMultiplier = Math.max(1, Number(m.reuseMultiplier ?? 1));
  const unlockCount = graph?.unlockCount ? Number(graph.unlockCount(task.key) ?? 0) : 0;
  const blockingImpact = Number(m.blockingImpact ?? unlockCount);
  const acceptanceProbability = clamp01(m.acceptanceProbability ?? 0.7);
  const reversibility = clamp01(m.reversibility ?? (task.riskClass === 'critical' ? 0.1 : task.riskClass === 'high' ? 0.4 : 0.9));
  const executionCostUnits = Math.max(minResourceUnits, Number(m.executionCostUnits ?? 1));
  const verificationCostUnits = Math.max(0, Number(m.verificationCostUnits ?? 0));
  const informationGain = clamp01(m.informationGain ?? 0);

  // Expected value of accepting the work: product value scaled by acceptance probability and
  // reversibility (an irreversible action that might have to be undone is worth less expected
  // value than a trivially-revertible one of the same nominal size), plus blocking-impact value
  // realized through dependents, plus reuse leverage.
  const expectedProductValue = productValue * acceptanceProbability * (0.5 + 0.5 * reversibility);
  const expectedBlockingValue = blockingImpact * acceptanceProbability;
  const expectedRiskReductionValue = riskReductionValue * (0.3 + 0.7 * clamp01(informationGain || 1));

  // Information value: for PROBE-class tasks this is the primary term (a cheap experiment whose
  // point IS reducing uncertainty before committing expensive implementation resources), for
  // other classes it is additive but secondary.
  const informationValue = informationGain * SERVICE_CLASS_WEIGHT[ServiceClass.PROBE] * (serviceClass === ServiceClass.PROBE ? riskReductionValue || productValue || 1 : 0.25 * (riskReductionValue || 0));

  const classWeight = SERVICE_CLASS_WEIGHT[serviceClass] ?? 1;
  const totalExpectedValue = classWeight * (
    expectedProductValue * reuseMultiplier +
    expectedBlockingValue +
    expectedRiskReductionValue +
    informationValue +
    urgency * (productValue || 1)
  );

  const resourceCostUnits = executionCostUnits + verificationCostUnits;
  const rawValuePerResource = totalExpectedValue / resourceCostUnits;

  // Fairness/aging: every starvationMs-sized step a task waits, compound its own
  // value-per-resource by a fixed growth factor, so a persistently low-value task's score grows
  // exponentially in wait time and is therefore guaranteed to eventually exceed ANY fixed
  // competing score, however large -- a strictly stronger no-starvation guarantee than a linear
  // aging term (which only ever closes a bounded gap per unit time and can be outrun forever by
  // a sufficiently large -- or itself aging -- competing value). This generalizes the
  // incumbent scorer's `starvationSteps * 3` linear aging term to VoI's much larger and
  // task-dependent dynamic range.
  const createdAt = Number(m.createdAt ?? now);
  const ageMs = Math.max(0, now - createdAt);
  const starvationSteps = Math.floor(ageMs / starvationMs);
  const agingBonus = rawValuePerResource * (Math.pow(1 + agingBoostPerStep, starvationSteps) - 1);

  const score = rawValuePerResource + agingBonus;

  return {
    score,
    serviceClass,
    expectedProductValue,
    expectedBlockingValue,
    expectedRiskReductionValue,
    informationValue,
    resourceCostUnits,
    rawValuePerResource,
    starvationSteps,
    agingBonus,
    acceptanceProbability,
    reversibility,
  };
}

/**
 * Rank a set of frontier tasks by VoI score, descending, with a stable tiebreak on task.key
 * (same tiebreak convention as `portfolio-scheduler.js`'s candidate sort). Pure function; does
 * not touch workers, lanes, or backpressure -- this is a scoring/ranking primitive only, to be
 * combined with the incumbent's eligibility/worker-fit/backpressure machinery in wave 2.
 */
export function rankTasksByValueOfInformation(graph, tasks, options = {}) {
  return tasks
    .map((task) => ({ task, scoring: scoreTaskByValueOfInformation(graph, task, options) }))
    .sort((a, b) => b.scoring.score - a.scoring.score || a.task.key.localeCompare(b.task.key));
}

/**
 * Counterfactual-decision persistence for shadow evaluation (issue #105 acceptance criteria:
 * "Persist counterfactual scheduler decisions for shadow evaluation" and "Demonstrate better
 * accepted-value/resource economics versus incumbent priority scheduling in shadow/replay
 * tests"). Same in-memory-plus-toJSON/fromJSON persistence shape as
 * `src/training/policy-promotion.js`'s `PolicyRegistry` -- callers own durable storage of the
 * serialized log if it must survive process restarts, this class is deterministic pure state.
 *
 * This log has NO live authority: recording a decision here never affects what
 * `PortfolioScheduler` actually dispatches. It exists purely to accumulate paired
 * (incumbent-rank, VoI-rank) snapshots per planning cycle so a later replay/analysis pass can
 * compute accepted-value/resource economics for each ranking without having run two live
 * schedulers.
 */
export class ShadowDecisionLog {
  constructor({ maxEntries = 10_000 } = {}) {
    this.maxEntries = Math.max(1, Number(maxEntries));
    this.entries = [];
  }

  /**
   * Record one planning cycle's counterfactual comparison. `incumbentRanking` and `voiRanking`
   * are arrays of `{ taskKey, score }` in dispatch-preference order (index 0 = would-dispatch
   * first), typically produced by mapping `scoreTask`/`rankTasksByValueOfInformation` output.
   * `outcome` is optional and may be attached later via `recordOutcome` once real acceptance
   * results are known (accepted/rejected, actual value realized, resource actually consumed).
   */
  record({ now = Date.now(), incumbentRanking, voiRanking, context = {} }) {
    if (!Array.isArray(incumbentRanking) || !Array.isArray(voiRanking)) {
      throw new Error('ShadowDecisionLog.record requires incumbentRanking and voiRanking arrays');
    }
    const entry = {
      id: this.entries.length + 1,
      recordedAt: now,
      incumbentRanking: incumbentRanking.map((r) => ({ taskKey: r.taskKey, score: r.score })),
      voiRanking: voiRanking.map((r) => ({ taskKey: r.taskKey, score: r.score })),
      context,
      outcomes: {},
    };
    this.entries.push(entry);
    while (this.entries.length > this.maxEntries) this.entries.shift();
    return entry.id;
  }

  /**
   * Attach a realized outcome for one taskKey within a previously recorded cycle, so replay
   * analysis can compute each ranking's accepted-value/resource economics after the fact
   * without needing either ranking to have actually driven dispatch.
   */
  recordOutcome(entryId, taskKey, outcome) {
    const entry = this.entries.find((e) => e.id === entryId);
    if (!entry) throw new Error(`unknown ShadowDecisionLog entry ${entryId}`);
    entry.outcomes[taskKey] = { ...outcome, recordedAt: Date.now() };
    return entry;
  }

  /**
   * Compute a first-K accepted-value/resource comparison between the two rankings across all
   * entries that have outcomes recorded, using each entry's top-`topK` picks under each ranking.
   * Returns per-ranking totals so a caller can compare `voi.valuePerResource` against
   * `incumbent.valuePerResource` -- this is the shadow/replay evidence the acceptance criteria
   * ask for; it does not decide anything or feed back into either scorer.
   */
  compareEconomics({ topK = 5 } = {}) {
    const totals = {
      incumbent: { acceptedValue: 0, resourceUnits: 0, count: 0 },
      voi: { acceptedValue: 0, resourceUnits: 0, count: 0 },
    };
    for (const entry of this.entries) {
      for (const [key, ranking] of [['incumbent', entry.incumbentRanking], ['voi', entry.voiRanking]]) {
        for (const picked of ranking.slice(0, topK)) {
          const outcome = entry.outcomes[picked.taskKey];
          if (!outcome) continue;
          totals[key].acceptedValue += outcome.accepted ? Number(outcome.realizedValue ?? 0) : 0;
          totals[key].resourceUnits += Number(outcome.resourceUnitsConsumed ?? 0);
          totals[key].count += 1;
        }
      }
    }
    for (const key of ['incumbent', 'voi']) {
      totals[key].valuePerResource = totals[key].resourceUnits > 0 ? totals[key].acceptedValue / totals[key].resourceUnits : 0;
    }
    return totals;
  }

  snapshot() {
    return { version: 1, maxEntries: this.maxEntries, entries: structuredClone(this.entries) };
  }

  restore(snapshot) {
    this.maxEntries = Math.max(1, Number(snapshot?.maxEntries ?? this.maxEntries));
    this.entries = structuredClone(snapshot?.entries ?? []);
  }
}

/**
 * Preemption/resume semantics built on the existing `ExecutionCheckpointStore`
 * (`src/leverage/execution-checkpoint.js`, live since PR #79) rather than a new checkpoint
 * system. A VoI-driven preemption decision (e.g. a higher-value-per-resource probe arrives and
 * should take a worker slot from a lower-ranked in-flight task) is expressed as: save the
 * preempted task's progress as a checkpoint tagged `preempted: true`, then later resume it from
 * that same checkpoint via the store's existing generation-fenced `resume()`. This function adds
 * no new persistence mechanism or authority boundary -- it is a thin, named wrapper so
 * preemption call sites read clearly and stay consistent with each other.
 *
 * @param {import('../leverage/execution-checkpoint.js').ExecutionCheckpointStore} checkpointStore
 */
export function preemptTaskToCheckpoint(checkpointStore, taskKey, checkpoint = {}, { generation = 1, now = Date.now(), reason = 'voi-shadow-preemption' } = {}) {
  // ExecutionCheckpointStore.save only persists its known checkpoint fields (see
  // execution-checkpoint.js), so preemption is recorded through `pendingGate` -- an existing
  // field meant for exactly this kind of "why is this task not currently running" marker --
  // rather than adding a new field to that store.
  return checkpointStore.save(taskKey, { ...checkpoint, pendingGate: { type: 'preempted', reason, ...(checkpoint.pendingGate ?? {}) } }, { generation, now });
}

/**
 * Resume a previously preempted task. Thin wrapper over `ExecutionCheckpointStore.resume` that
 * additionally reports whether the checkpoint being resumed was actually marked preempted (as
 * opposed to a normal in-progress checkpoint), so callers can distinguish "resuming after
 * preemption" from "resuming after a worker restart" in logs/metrics without a second lookup.
 */
export function resumePreemptedTask(checkpointStore, taskKey, { minGeneration = 0 } = {}) {
  const row = checkpointStore.resume(taskKey, { minGeneration });
  if (!row) return null;
  return { ...row, wasPreempted: row.pendingGate?.type === 'preempted' };
}
