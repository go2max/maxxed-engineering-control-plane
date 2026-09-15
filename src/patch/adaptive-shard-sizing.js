function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value))); }

function key(executorId, taskClass) { return `${executorId ?? 'unknown-executor'}::${taskClass ?? 'unknown-task-class'}`; }

// Reliability-weighted evidence score in [0,1]. Higher means the executor/task-class pairing
// has earned the right to run a larger shard with less verification overhead.
function evidenceScore({
  historicalAcceptanceRate = 0.5,
  novelty = 0.5,
  dependencyDepth = 0,
  mutationSurface = 0.5,
  contextEntropy = 0.5,
  verifierCost = 0.5,
  sampleSize = 0
} = {}) {
  const confidence = clamp(sampleSize / (sampleSize + 8), 0, 1); // Bayesian-ish shrinkage toward neutral prior for thin evidence
  const acceptance = clamp(historicalAcceptanceRate, 0, 1);
  const risk = clamp(
    0.32 * clamp(novelty, 0, 1) +
    0.2 * clamp(dependencyDepth / 8, 0, 1) +
    0.22 * clamp(mutationSurface, 0, 1) +
    0.16 * clamp(contextEntropy, 0, 1) +
    0.1 * clamp(verifierCost, 0, 1),
    0, 1
  );
  // Shrink the *acceptance-rate* term toward a neutral 0.5 prior when evidence is thin, so a
  // single lucky run can't unlock a huge shard — but always apply the risk term at full weight,
  // since novelty/dependency-depth/mutation-surface/etc. are direct inputs, not learned ones,
  // and a novel/risky task should be pushed toward decomposition even with zero history.
  const shrunkAcceptance = acceptance * confidence + 0.5 * (1 - confidence);
  return clamp(shrunkAcceptance * (1 - risk), 0, 1);
}

/**
 * Learns, per (executor, task-class) pair, the largest shard size that history supports,
 * instead of a single hard-coded micro-shard size. Feeds back observed shard-size outcomes
 * (accepted / repaired / failed, verification cost) so the estimate improves over time.
 */
export class AdaptiveShardSizer {
  constructor({
    minLines = 40,
    baselineTargetLines = 250,
    maxLines = 1200,
    decayHalfLifeRuns = 40
  } = {}) {
    this.minLines = Math.max(1, Number(minLines));
    this.baselineTargetLines = Math.max(this.minLines, Number(baselineTargetLines));
    this.maxLines = Math.max(this.baselineTargetLines, Number(maxLines));
    this.decayHalfLifeRuns = Math.max(1, Number(decayHalfLifeRuns));
    this.stats = new Map();
  }

  #row(executorId, taskClass) {
    const k = key(executorId, taskClass);
    if (!this.stats.has(k)) this.stats.set(k, { executorId, taskClass, runs: [], acceptedSizes: [] });
    return this.stats.get(k);
  }

  /**
   * Compute the recommended shard-size envelope for this executor/task-class given current
   * risk/novelty inputs. Does not mutate state; call `recordOutcome` after execution completes.
   */
  recommend({ executorId, taskClass, ...features } = {}) {
    const row = this.stats.get(key(executorId, taskClass));
    const sampleSize = row?.runs.length ?? 0;
    const observedAcceptanceRate = sampleSize
      ? row.runs.filter((run) => run.outcome === 'accepted').length / sampleSize
      : 0.5;
    const score = evidenceScore({
      historicalAcceptanceRate: features.historicalAcceptanceRate ?? observedAcceptanceRate,
      novelty: features.novelty,
      dependencyDepth: features.dependencyDepth,
      mutationSurface: features.mutationSurface,
      contextEntropy: features.contextEntropy,
      verifierCost: features.verifierCost,
      sampleSize
    });
    // score in [0,1] maps linearly onto [minLines, maxLines]; a proven, low-risk pairing earns
    // shards well above the historical fixed micro-shard baseline, a novel/risky one is pushed
    // toward (and below) the baseline so it gets decomposed further upstream.
    const targetLines = Math.round(this.minLines + score * (this.maxLines - this.minLines));
    const recentAccepted = row?.acceptedSizes.slice(-this.decayHalfLifeRuns) ?? [];
    const provenCeiling = recentAccepted.length ? Math.max(...recentAccepted) : null;
    return {
      executorId, taskClass,
      evidenceScore: score,
      sampleSize,
      targetLines: clamp(targetLines, this.minLines, this.maxLines),
      maxLines: provenCeiling != null ? clamp(Math.round(provenCeiling * 1.25), targetLines, this.maxLines) : clamp(Math.round(targetLines * 1.4), targetLines, this.maxLines),
      minLines: this.minLines,
      decomposeFurther: score < 0.35,
      reason: sampleSize === 0 ? 'no-history-neutral-prior' : score < 0.35 ? 'low-evidence-or-high-risk' : score > 0.75 ? 'strong-history-supports-larger-shard' : 'moderate-evidence'
    };
  }

  /**
   * Feed a completed shard's outcome back into the learning store so future recommendations
   * for this (executor, task-class) pair reflect what actually happened.
   */
  recordOutcome({ executorId, taskClass, shardLines, outcome, verifierCostMs = null, now = Date.now() } = {}) {
    if (!['accepted', 'repaired', 'failed'].includes(outcome)) throw new Error(`unknown shard outcome: ${outcome}`);
    const row = this.#row(executorId, taskClass);
    row.runs.push({ shardLines: Math.max(0, Number(shardLines ?? 0)), outcome, verifierCostMs, at: Number(now) });
    row.runs = row.runs.slice(-500);
    if (outcome === 'accepted') {
      row.acceptedSizes.push(Math.max(0, Number(shardLines ?? 0)));
      row.acceptedSizes = row.acceptedSizes.slice(-200);
    }
    return this.statsFor(executorId, taskClass);
  }

  statsFor(executorId, taskClass) {
    const row = this.stats.get(key(executorId, taskClass));
    if (!row) return { executorId, taskClass, runs: 0, acceptedRuns: 0, failedRuns: 0, repairedRuns: 0 };
    return {
      executorId, taskClass,
      runs: row.runs.length,
      acceptedRuns: row.runs.filter((run) => run.outcome === 'accepted').length,
      failedRuns: row.runs.filter((run) => run.outcome === 'failed').length,
      repairedRuns: row.runs.filter((run) => run.outcome === 'repaired').length
    };
  }

  snapshot() {
    return { version: 1, stats: [...this.stats.values()].map((row) => structuredClone(row)) };
  }

  restore(snapshot) {
    if (snapshot && snapshot.version !== 1) throw new Error('unsupported adaptive-shard-sizing snapshot');
    this.stats = new Map((snapshot?.stats ?? []).map((row) => [key(row.executorId, row.taskClass), structuredClone(row)]));
  }
}
