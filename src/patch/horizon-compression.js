import { AdaptiveShardSizer } from './adaptive-shard-sizing.js';

function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value))); }

function taskKey(modelId, taskClass) { return `${modelId ?? 'unknown-model'}::${taskClass ?? 'unknown-task-class'}`; }

/**
 * Horizon compression engine (issue #96).
 *
 * PRIMITIVE WAVE ONLY — see PR body for what is deliberately not yet wired.
 *
 * This is deliberately a thin layer *on top of* `AdaptiveShardSizer`, not a second sizing
 * system: `AdaptiveShardSizer` already learns, per (executor, task-class), the shard-size
 * envelope a novelty/dependency-depth/mutation-surface/verifier-cost/historical-acceptance
 * feature vector supports, plus outcome feedback and snapshot/restore. Per
 * docs/REUSE_FIRST_CHECKLIST.md this module reuses that engine unchanged as its core envelope
 * predictor and adds only the delta issue #96 asks for that `AdaptiveShardSizer` does not
 * provide:
 *
 *   1. A "reliable task horizon" framed in effort/admission terms (not just shard lines),
 *      folding in two features `AdaptiveShardSizer` does not model: tool-call count and a
 *      named model identity/tier (it only keys on an opaque `executorId`).
 *   2. A decompose-vs-escalate-model admission decision (the sizer only ever says "give it a
 *      smaller/larger shard", it has no notion of "or hand it to a stronger model instead").
 *   3. Hard, bounded loop prevention across repeated decomposition (the sizer has none).
 *   4. Predicted-vs-actual persistence for calibration, separate from the sizer's
 *      accept/repair/fail counters (this tracks the *horizon* prediction itself, e.g.
 *      predicted tool-call/effort budget vs what was actually spent).
 */

// Weights are intentionally simple and documented so decomposeFurther-driving math stays
// auditable; tune via calibration data, not by hand-fitting to a single scenario.
function horizonRiskScore({
  novelty = 0.5,
  dependencyDepth = 0,
  mutationSurface = 0.5,
  repoEntropy = 0.5,
  toolCallCount = 0,
  expectedVerificationCost = 0.5
} = {}) {
  return clamp(
    0.24 * clamp(novelty, 0, 1) +
    0.16 * clamp(dependencyDepth / 8, 0, 1) +
    0.18 * clamp(mutationSurface, 0, 1) +
    0.14 * clamp(repoEntropy, 0, 1) +
    0.14 * clamp(toolCallCount / 40, 0, 1) +
    0.14 * clamp(expectedVerificationCost, 0, 1),
    0, 1
  );
}

export class HorizonCompressionEngine {
  constructor({
    sizer = null,
    maxDecompositionDepth = 4,
    minLines,
    baselineTargetLines,
    maxLines,
    decayHalfLifeRuns
  } = {}) {
    // Reuse AdaptiveShardSizer as the envelope predictor rather than reimplementing it; an
    // instance can be injected (e.g. to share the live sizer's learned state) or one is built
    // fresh with the same defaults it already uses.
    this.sizer = sizer ?? new AdaptiveShardSizer({ minLines, baselineTargetLines, maxLines, decayHalfLifeRuns });
    this.maxDecompositionDepth = Math.max(1, Number(maxDecompositionDepth));
    this.predictions = new Map(); // predictionId -> { predicted, actual }
    this.modelStats = new Map(); // `${modelId}::${taskClass}` -> { runs: [{toolCallCount, outcome, at}] }
  }

  #modelRow(modelId, taskClass) {
    const k = taskKey(modelId, taskClass);
    if (!this.modelStats.has(k)) this.modelStats.set(k, { modelId, taskClass, runs: [] });
    return this.modelStats.get(k);
  }

  /**
   * Predict the reliable task horizon for a work packet on a given model/task-class, folding
   * in the AdaptiveShardSizer envelope (executorId is the modelId here — same identity space)
   * plus the two additional inputs issue #96 asks for that the sizer does not model:
   * tool-call count and repo entropy (aliased onto the sizer's contextEntropy feature so both
   * layers reason about the same signal, not two diverging ones).
   */
  predictHorizon({
    modelId,
    taskClass,
    novelty = 0.5,
    dependencyDepth = 0,
    mutationSurface = 0.5,
    repoEntropy = 0.5,
    toolCallCount = 0,
    expectedVerificationCost = 0.5,
    historicalAcceptanceRate,
    decompositionDepth = 0
  } = {}) {
    const envelope = this.sizer.recommend({
      executorId: modelId,
      taskClass,
      novelty,
      dependencyDepth,
      mutationSurface,
      contextEntropy: repoEntropy,
      verifierCost: expectedVerificationCost,
      historicalAcceptanceRate
    });
    const risk = horizonRiskScore({ novelty, dependencyDepth, mutationSurface, repoEntropy, toolCallCount, expectedVerificationCost });
    const modelRow = this.modelStats.get(taskKey(modelId, taskClass));
    const observedToolCalls = modelRow?.runs.length
      ? modelRow.runs.reduce((sum, run) => sum + run.toolCallCount, 0) / modelRow.runs.length
      : null;
    // Reliable tool-call budget: scale the sizer's line envelope down by risk, blended with any
    // observed average from prior runs of this (model, task-class) pair.
    const linesFactor = envelope.targetLines / Math.max(1, this.sizer.baselineTargetLines);
    const predictedToolCallBudget = Math.round(clamp(linesFactor * (1 - 0.5 * risk), 0.1, 3) * 12);
    const reliableHorizon = observedToolCalls != null
      ? Math.round((predictedToolCallBudget + observedToolCalls) / 2)
      : predictedToolCallBudget;

    const exceedsHorizon = toolCallCount > reliableHorizon || envelope.decomposeFurther;
    const loopBound = decompositionDepth >= this.maxDecompositionDepth;

    return {
      modelId, taskClass,
      envelope,
      riskScore: risk,
      reliableHorizon,
      toolCallCount,
      exceedsHorizon,
      decompositionDepth,
      loopBoundHit: loopBound,
      // See `decideAction` for the actual admission decision; this is exposed for callers that
      // only need the raw prediction.
      recommendation: !exceedsHorizon ? 'within-horizon' : loopBound ? 'escalate-model' : 'decompose'
    };
  }

  /**
   * Decompose-before-model-upgrade policy: given a horizon prediction, decide whether to split
   * the work packet further or escalate to a stronger model. Decomposition is always preferred
   * while the packet exceeds its horizon *and* the hard loop-prevention bound has not been hit;
   * once the bound is hit, further decomposition is refused and escalation is the only allowed
   * path, so a pathological task cannot recurse forever.
   */
  decideAction(prediction) {
    if (!prediction.exceedsHorizon) {
      return { action: 'admit', reason: 'within-reliable-horizon' };
    }
    if (prediction.loopBoundHit) {
      return { action: 'escalate-model', reason: 'max-decomposition-depth-reached', maxDecompositionDepth: this.maxDecompositionDepth };
    }
    return { action: 'decompose', reason: prediction.envelope.decomposeFurther ? 'envelope-below-baseline' : 'tool-call-budget-exceeded', nextDecompositionDepth: prediction.decompositionDepth + 1 };
  }

  /** Convenience: predict + decide in one call. */
  evaluate(input) {
    const prediction = this.predictHorizon(input);
    const decision = this.decideAction(prediction);
    return { prediction, decision };
  }

  /**
   * Record a prediction for later calibration. Returns a predictionId to pass to
   * `recordActual`. Distinct from AdaptiveShardSizer.recordOutcome: this tracks the *horizon*
   * prediction (predicted tool-call/effort budget) against what actually happened, not the
   * sizer's accept/repair/fail shard-size feedback loop (callers should still call
   * `sizer.recordOutcome` separately for that, e.g. via the shared `this.sizer` instance).
   */
  recordPrediction({ predictionId, modelId, taskClass, prediction, now = Date.now() } = {}) {
    if (!predictionId) throw new Error('recordPrediction requires a predictionId');
    this.predictions.set(predictionId, {
      predictionId, modelId, taskClass,
      predicted: { reliableHorizon: prediction.reliableHorizon, riskScore: prediction.riskScore, envelopeTargetLines: prediction.envelope.targetLines },
      actual: null,
      predictedAt: Number(now)
    });
    return predictionId;
  }

  /**
   * Record what actually happened for a previously-recorded prediction, and feed the
   * tool-call count back into this engine's own (model, task-class) observation history so
   * future `predictHorizon` calls reflect it. Also updates the underlying `AdaptiveShardSizer`
   * store via `recordOutcome` so both layers stay in sync from one call.
   */
  recordActual({ predictionId, actualToolCallCount, actualLines = null, outcome, verifierCostMs = null, now = Date.now() } = {}) {
    if (!['accepted', 'repaired', 'failed'].includes(outcome)) throw new Error(`unknown horizon outcome: ${outcome}`);
    const row = this.predictions.get(predictionId);
    if (!row) throw new Error(`unknown predictionId: ${predictionId}`);
    row.actual = { toolCallCount: Math.max(0, Number(actualToolCallCount ?? 0)), lines: actualLines, outcome, verifierCostMs, at: Number(now) };

    const modelRow = this.#modelRow(row.modelId, row.taskClass);
    modelRow.runs.push({ toolCallCount: row.actual.toolCallCount, outcome, at: Number(now) });
    modelRow.runs = modelRow.runs.slice(-500);

    if (actualLines != null) {
      this.sizer.recordOutcome({ executorId: row.modelId, taskClass: row.taskClass, shardLines: actualLines, outcome, verifierCostMs, now });
    }
    return this.calibrationFor(predictionId);
  }

  /** Prediction error for a single recorded prediction, once its actual is known. */
  calibrationFor(predictionId) {
    const row = this.predictions.get(predictionId);
    if (!row) return null;
    if (!row.actual) return { predictionId, resolved: false };
    return {
      predictionId,
      resolved: true,
      predictedHorizon: row.predicted.reliableHorizon,
      actualToolCallCount: row.actual.toolCallCount,
      absoluteError: Math.abs(row.predicted.reliableHorizon - row.actual.toolCallCount),
      overPredicted: row.predicted.reliableHorizon > row.actual.toolCallCount,
      outcome: row.actual.outcome
    };
  }

  /** Aggregate calibration report across all resolved predictions, for the shadow-comparison
   * report the issue asks for (first-pass acceptance / retries / verifier-time deltas are
   * computed by the caller from `outcome`/`verifierCostMs`; this gives the horizon-accuracy
   * half). */
  calibrationReport() {
    const resolved = [...this.predictions.values()].filter((row) => row.actual);
    if (resolved.length === 0) return { resolvedCount: 0, meanAbsoluteError: null, acceptanceRate: null };
    const errors = resolved.map((row) => Math.abs(row.predicted.reliableHorizon - row.actual.toolCallCount));
    const accepted = resolved.filter((row) => row.actual.outcome === 'accepted').length;
    return {
      resolvedCount: resolved.length,
      meanAbsoluteError: errors.reduce((a, b) => a + b, 0) / errors.length,
      acceptanceRate: accepted / resolved.length
    };
  }

  snapshot() {
    return {
      version: 1,
      sizer: this.sizer.snapshot(),
      predictions: [...this.predictions.values()].map((row) => structuredClone(row)),
      modelStats: [...this.modelStats.values()].map((row) => structuredClone(row))
    };
  }

  restore(snapshot) {
    if (snapshot && snapshot.version !== 1) throw new Error('unsupported horizon-compression snapshot');
    this.sizer.restore(snapshot?.sizer ?? null);
    this.predictions = new Map((snapshot?.predictions ?? []).map((row) => [row.predictionId, structuredClone(row)]));
    this.modelStats = new Map((snapshot?.modelStats ?? []).map((row) => [taskKey(row.modelId, row.taskClass), structuredClone(row)]));
  }
}
