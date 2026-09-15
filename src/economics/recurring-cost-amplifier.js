function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value))); }

/**
 * Models recurring-cost amplification: a tiny, individually-cheap diff can become materially
 * expensive when multiplied by invocation frequency, worker fan-out and retry multiplication.
 * estimatedMonthlyDelta = perInvocationCost * frequencyPerMonth * fanOut * retryMultiplier.
 */
export function recurringCostAmplification({
  perInvocationCostUsd = 0,
  frequencyPerMonth = 1,
  fanOut = 1,
  retryMultiplier = 1
} = {}) {
  const per = Math.max(0, Number(perInvocationCostUsd));
  const freq = Math.max(0, Number(frequencyPerMonth));
  const fan = Math.max(1, Number(fanOut));
  const retry = Math.max(1, Number(retryMultiplier));
  const estimatedMonthlyDelta = per * freq * fan * retry;
  return {
    perInvocationCostUsd: per,
    frequencyPerMonth: freq,
    fanOut: fan,
    retryMultiplier: retry,
    estimatedMonthlyDelta,
    amplificationFactor: fan * retry
  };
}

/**
 * Aggregates recurring-cost amplification across every changed recurring-cost surface in a
 * candidate, and flags "tiny diff, high-frequency recurring cost" cases where a small
 * per-invocation delta becomes a large monthly delta purely from frequency × fan-out × retry.
 */
export function projectRecurringCosts(surfaces = [], { escalationThresholdUsd = 25 } = {}) {
  const rows = surfaces.map((surface) => ({ id: surface.id ?? null, ...recurringCostAmplification(surface) }));
  const totalMonthlyDelta = rows.reduce((sum, row) => sum + row.estimatedMonthlyDelta, 0);
  const escalate = rows.some((row) => row.estimatedMonthlyDelta >= escalationThresholdUsd)
    || totalMonthlyDelta >= escalationThresholdUsd;
  const tinyDiffHighFrequency = rows.some((row) => row.perInvocationCostUsd < 0.01 && row.estimatedMonthlyDelta >= escalationThresholdUsd);
  return { rows, totalMonthlyDelta, escalate, tinyDiffHighFrequency };
}

/**
 * Composition-level economics: shards that are individually cheap can become expensive once
 * composed (shared hot path invoked by multiple new callers, or independent frequency
 * increases that multiply together). This sums per-shard recurring projections and additionally
 * applies a co-invocation multiplier for shards that share an invocation surface.
 */
export function projectCompositionEconomics(shardProjections = [], { sharedSurfaceMultiplier = 1, escalationThresholdUsd = 25 } = {}) {
  const perShardTotal = shardProjections.reduce((sum, projection) => sum + Number(projection.totalMonthlyDelta ?? 0), 0);
  const multiplier = Math.max(1, Number(sharedSurfaceMultiplier));
  const compositionMonthlyDelta = perShardTotal * multiplier;
  const allShardsIndividuallyCheap = shardProjections.every((projection) => !projection.escalate);
  const individuallyCheapButCompositionExpensive = allShardsIndividuallyCheap && compositionMonthlyDelta >= Number(escalationThresholdUsd);
  return {
    perShardTotal,
    sharedSurfaceMultiplier: multiplier,
    compositionMonthlyDelta,
    individuallyCheapButCompositionExpensive
  };
}
