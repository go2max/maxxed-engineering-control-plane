// Issue #107 (primitive wave): runtime saturation profiling + predictive-autoscaling
// *detection* layer. This module reads real, already-available signals -- it does not invent
// new instrumentation and does not duplicate `BottleneckOptimizer` (a single-snapshot "what's
// the bottleneck right now" scorer in this same directory). Instead it:
//
//   1. Keeps a short rolling history per saturation stage (SaturationProfiler.sample /
//      .history) built from real signals: event-loop lag (measured via `process.hrtime`),
//      verifier backlog depth (already computed in ControlPlaneRuntime#dispatch from the task
//      graph), repair/circuit-breaker pressure (RepairController's per-task breaker state,
//      aggregated here), and worker free-slot counts (already on every worker record the
//      scheduler consumes).
//   2. Attributes current saturation to a stage the same way BottleneckOptimizer ranks
//      candidates, so callers get one archetype name back, not five raw numbers to interpret.
//   3. Forecasts each stage's near-term trajectory with a lightweight EWMA + linear-regression
//      trend over that real recorded history (no ML dependency) and flags a stage whose trend
//      is projected to cross its saturation threshold within a configurable horizon.
//   4. Exposes `recommendScalingAction()` -- a pure, testable function that turns a forecast
//      into a scaling *recommendation* (e.g. "add workers", "shed load"). It deliberately does
//      NOT call any provisioning API: this repo has no safe "provision more compute" action to
//      invoke without broader infra context, so wiring an actual autoscaling action is out of
//      scope for this PR (see PR body / issue #107 discussion). The recommendation is data a
//      wave-2 PR can act on once a real scaling backend is chosen.
//
// A `ScopedCircuitBreaker` (failure-domain-keyed, not global) is included alongside the
// profiler: sustained saturation in one domain (e.g. "verifier") should not trip breakers in
// an unrelated domain (e.g. "model-inference"), mirroring how `repoLaneLimits` and per-task
// repair breakers already scope blast radius elsewhere in this codebase rather than pausing
// the whole runtime.

export const SaturationStage = Object.freeze({
  EVENT_LOOP: 'event-loop',
  VERIFICATION: 'verification',
  REPAIR: 'repair',
  WORKER_CAPACITY: 'worker-capacity'
});

/** Real event-loop-lag measurement via process.hrtime: schedules a macrotask and measures how
 * late it actually fired relative to the requested delay. This is a genuine signal (queueing
 * behind other macrotasks/microtasks/GC pauses shows up as lag), not a synthetic stand-in. */
export function measureEventLoopLagMs(targetDelayMs = 0) {
  const start = process.hrtime.bigint();
  return new Promise((resolve) => {
    setTimeout(() => {
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      resolve(Math.max(0, elapsedMs - targetDelayMs));
    }, targetDelayMs);
  });
}

function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }

/** EWMA + linear-regression trend over a real recorded (time, value) history. No external ML
 * dependency -- this is the same class of technique `ThroughputGovernor`/`SchedulerPolicy`
 * already use for adaptive decisions in this codebase, just applied over a window instead of a
 * single sample. */
export function forecastTrend(samples, { horizonMs = 5 * 60_000, alpha = 0.35 } = {}) {
  const points = samples.filter((s) => Number.isFinite(s?.at) && Number.isFinite(s?.value));
  if (points.length === 0) return { ewma: 0, slopePerMs: 0, projected: 0, confidence: 0 };
  if (points.length === 1) return { ewma: points[0].value, slopePerMs: 0, projected: points[0].value, confidence: 0 };

  let ewma = points[0].value;
  for (let i = 1; i < points.length; i++) ewma = alpha * points[i].value + (1 - alpha) * ewma;

  // Ordinary least squares slope of value over time (ms), anchored at the window start so the
  // fit is numerically stable regardless of absolute Date.now() magnitude.
  const t0 = points[0].at;
  const xs = points.map((p) => p.at - t0);
  const ys = points.map((p) => p.value);
  const n = points.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - meanX) * (ys[i] - meanY); den += (xs[i] - meanX) ** 2; }
  const slopePerMs = den > 0 ? num / den : 0;

  const projected = Math.max(0, ewma + slopePerMs * horizonMs);
  const confidence = clamp01((n - 1) / 9); // ramps to 1.0 confidence at 10+ real samples
  return { ewma, slopePerMs, projected, confidence, windowSamples: n, windowSpanMs: points[n - 1].at - points[0].at };
}

const DEFAULT_THRESHOLDS = {
  [SaturationStage.EVENT_LOOP]: { warn: 50, critical: 150 }, // ms of measured lag
  [SaturationStage.VERIFICATION]: { warn: 4, critical: 8 }, // backlog depth
  [SaturationStage.REPAIR]: { warn: 0.25, critical: 0.5 }, // fraction of tracked tasks with an open breaker
  [SaturationStage.WORKER_CAPACITY]: { warn: 0.2, critical: 0.05 } // free-slot ratio (lower = worse)
};

export class SaturationProfiler {
  constructor({ windowSize = 30, thresholds = DEFAULT_THRESHOLDS, horizonMs = 5 * 60_000 } = {}) {
    this.windowSize = Math.max(2, Number(windowSize));
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
    this.horizonMs = Math.max(1000, Number(horizonMs));
    this.history = new Map(Object.values(SaturationStage).map((stage) => [stage, []]));
  }

  #push(stage, value, now) {
    const rows = this.history.get(stage) ?? [];
    rows.push({ at: Number(now), value: Number(value) });
    if (rows.length > this.windowSize) rows.splice(0, rows.length - this.windowSize);
    this.history.set(stage, rows);
    return rows;
  }

  /**
   * Record one real sample per stage from already-available runtime signals. Callers pass
   * whatever subset they have; missing stages simply aren't sampled this tick.
   *
   * - eventLoopLagMs: from `measureEventLoopLagMs()` (or injected in tests).
   * - verifierBacklog: same signal `ControlPlaneRuntime#dispatch` already computes from the
   *   task graph (BLOCKED tasks awaiting repair-task resolution).
   * - repairBreakerOpenRatio: openBreakers / trackedTasks from `RepairController.history`.
   * - workers: the same worker list the scheduler consumes, used to derive a free-slot ratio.
   */
  sample({ now = Date.now(), eventLoopLagMs = null, verifierBacklog = null, repairBreakerOpenRatio = null, workers = null } = {}) {
    const recorded = {};
    if (eventLoopLagMs != null) recorded[SaturationStage.EVENT_LOOP] = this.#push(SaturationStage.EVENT_LOOP, eventLoopLagMs, now).at(-1).value;
    if (verifierBacklog != null) recorded[SaturationStage.VERIFICATION] = this.#push(SaturationStage.VERIFICATION, verifierBacklog, now).at(-1).value;
    if (repairBreakerOpenRatio != null) recorded[SaturationStage.REPAIR] = this.#push(SaturationStage.REPAIR, repairBreakerOpenRatio, now).at(-1).value;
    if (workers != null) {
      const totalSlots = workers.reduce((sum, w) => sum + Math.max(0, Number(w.capacity?.totalSlots ?? w.capacity?.freeSlots ?? 0)), 0);
      const freeSlots = workers.reduce((sum, w) => sum + Math.max(0, Number(w.capacity?.freeSlots ?? 0)), 0);
      const freeRatio = totalSlots > 0 ? freeSlots / totalSlots : (workers.length ? 0 : 1);
      recorded[SaturationStage.WORKER_CAPACITY] = this.#push(SaturationStage.WORKER_CAPACITY, freeRatio, now).at(-1).value;
    }
    return recorded;
  }

  historyFor(stage) { return structuredClone(this.history.get(stage) ?? []); }

  #severity(stage, value) {
    const t = this.thresholds[stage];
    if (!t) return 'normal';
    const lowerIsWorse = stage === SaturationStage.WORKER_CAPACITY;
    if (lowerIsWorse) {
      if (value <= t.critical) return 'critical';
      if (value <= t.warn) return 'warn';
      return 'normal';
    }
    if (value >= t.critical) return 'critical';
    if (value >= t.warn) return 'warn';
    return 'normal';
  }

  /** Attribute current saturation to the single most-saturated stage, using the latest sample
   * plus its forecast trend for tie-breaking (a stage trending toward critical outranks one
   * that's flat, even at equal current severity). */
  attribute(now = Date.now()) {
    const severityRank = { normal: 0, warn: 1, critical: 2 };
    const rows = Object.values(SaturationStage).map((stage) => {
      const history = this.history.get(stage) ?? [];
      const latest = history.at(-1)?.value ?? null;
      const forecast = forecastTrend(history, { horizonMs: this.horizonMs });
      const currentSeverity = latest == null ? 'normal' : this.#severity(stage, latest);
      const projectedSeverity = latest == null ? 'normal' : this.#severity(stage, forecast.projected);
      return { stage, latest, currentSeverity, projectedSeverity, forecast };
    });
    rows.sort((a, b) => {
      const rankDiff = (severityRank[b.projectedSeverity] + severityRank[b.currentSeverity]) - (severityRank[a.projectedSeverity] + severityRank[a.currentSeverity]);
      if (rankDiff !== 0) return rankDiff;
      return (b.forecast.slopePerMs * (b.stage === SaturationStage.WORKER_CAPACITY ? -1 : 1)) - (a.forecast.slopePerMs * (a.stage === SaturationStage.WORKER_CAPACITY ? -1 : 1));
    });
    const bottleneck = rows[0];
    return { at: Number(now), bottleneck: bottleneck?.stage ?? null, severity: bottleneck ? (severityRank[bottleneck.projectedSeverity] > severityRank[bottleneck.currentSeverity] ? bottleneck.projectedSeverity : bottleneck.currentSeverity) : 'normal', stages: rows };
  }

  /** Predictable near-term bottleneck flag: true when a stage's forecast trend crosses into
   * "critical" within the configured horizon even though it isn't critical *yet*, and there's
   * enough real history to trust the trend (confidence > 0). This is the "predictive" half of
   * the profiler -- distinct from `attribute()`'s "what's saturated right now". */
  predictBottleneck(now = Date.now()) {
    const attribution = this.attribute(now);
    const predictable = attribution.stages
      .filter((row) => row.currentSeverity !== 'critical' && row.projectedSeverity === 'critical' && row.forecast.confidence > 0)
      .sort((a, b) => b.forecast.confidence - a.forecast.confidence);
    return { at: Number(now), predicted: predictable.length > 0, stage: predictable[0]?.stage ?? null, forecast: predictable[0]?.forecast ?? null, candidates: predictable };
  }

  snapshot() { return { version: 1, windowSize: this.windowSize, history: [...this.history.entries()].map(([stage, rows]) => [stage, structuredClone(rows)]) }; }
  restore(snapshot) {
    if (!snapshot || snapshot.version !== 1) throw new Error('unsupported saturation-profiler snapshot');
    this.windowSize = Number(snapshot.windowSize ?? this.windowSize);
    this.history = new Map((snapshot.history ?? []).map(([stage, rows]) => [stage, structuredClone(rows)]));
    for (const stage of Object.values(SaturationStage)) if (!this.history.has(stage)) this.history.set(stage, []);
  }
}

/**
 * Scaling-decision *recommendation*, not an action. This is deliberately a pure function: given
 * a saturation attribution/forecast, it returns what capacity change would relieve the
 * bottleneck and how urgently, but never calls out to provision anything. Wiring an actual
 * "spin up N more workers" or "warm N more model replicas" call is explicitly deferred to a
 * follow-up wiring-wave PR once a concrete, safe provisioning action exists for this stage --
 * see the PR body for why that's out of scope here.
 */
export function recommendScalingAction({ bottleneckReport, currentWorkerCount = 0, maxWorkerCount = 16 } = {}) {
  if (!bottleneckReport || bottleneckReport.severity === 'normal') {
    return { action: 'hold', stage: bottleneckReport?.bottleneck ?? null, reason: 'no-saturation-detected', proposedDelta: 0 };
  }
  const stage = bottleneckReport.bottleneck;
  const urgent = bottleneckReport.severity === 'critical';
  const headroom = Math.max(0, Number(maxWorkerCount) - Number(currentWorkerCount));
  switch (stage) {
    case SaturationStage.WORKER_CAPACITY: {
      const proposedDelta = headroom === 0 ? 0 : Math.min(headroom, urgent ? Math.max(2, Math.ceil(currentWorkerCount * 0.25)) : 1);
      return { action: proposedDelta > 0 ? 'scale-out-workers' : 'at-max-capacity', stage, reason: `worker free-slot ratio ${urgent ? 'critical' : 'warn'}`, proposedDelta, urgent };
    }
    case SaturationStage.VERIFICATION:
      return { action: 'scale-out-verifiers', stage, reason: `verifier backlog ${urgent ? 'critical' : 'warn'}`, proposedDelta: urgent ? 2 : 1, urgent };
    case SaturationStage.REPAIR:
      return { action: 'throttle-implementation-admission', stage, reason: `repair breaker open-ratio ${urgent ? 'critical' : 'warn'}`, proposedDelta: 0, urgent };
    case SaturationStage.EVENT_LOOP:
      return { action: 'shed-synchronous-work', stage, reason: `event-loop lag ${urgent ? 'critical' : 'warn'}`, proposedDelta: 0, urgent };
    default:
      return { action: 'hold', stage, reason: 'unrecognized-stage', proposedDelta: 0 };
  }
}

/**
 * A circuit breaker scoped to a failure domain (a string key the caller chooses -- e.g. a
 * worker pool id, a model id, or a stage name), not a single global switch. Independent
 * domains trip and recover independently, so a regression in one part of the fleet doesn't
 * force a fail-closed shutdown of everything (matching the "scoped circuit breakers ... instead
 * of global shutdown" acceptance bar in issue #107).
 */
export class ScopedCircuitBreaker {
  constructor({ failureThreshold = 5, windowMs = 60_000, cooldownMs = 30_000 } = {}) {
    this.failureThreshold = Math.max(1, Number(failureThreshold));
    this.windowMs = Math.max(1, Number(windowMs));
    this.cooldownMs = Math.max(0, Number(cooldownMs));
    this.domains = new Map();
  }

  #row(domain) {
    if (!this.domains.has(domain)) this.domains.set(domain, { failures: [], state: 'CLOSED', openedAt: null });
    return this.domains.get(domain);
  }

  recordSuccess(domain, now = Date.now()) {
    const row = this.#row(domain);
    row.failures = row.failures.filter((at) => now - at < this.windowMs);
    if (row.state === 'HALF_OPEN') { row.state = 'CLOSED'; row.openedAt = null; row.failures = []; }
    return this.status(domain, now);
  }

  recordFailure(domain, now = Date.now()) {
    const row = this.#row(domain);
    row.failures = row.failures.filter((at) => now - at < this.windowMs);
    row.failures.push(now);
    if (row.failures.length >= this.failureThreshold && row.state !== 'OPEN') { row.state = 'OPEN'; row.openedAt = now; }
    return this.status(domain, now);
  }

  /** Whether new work should be admitted for this domain right now. Transitions OPEN ->
   * HALF_OPEN automatically once the cooldown elapses (does not itself count as success/failure
   * -- the caller's next recordSuccess/recordFailure decides whether it re-closes or re-opens). */
  allow(domain, now = Date.now()) {
    const row = this.#row(domain);
    if (row.state === 'OPEN' && row.openedAt != null && now - row.openedAt >= this.cooldownMs) row.state = 'HALF_OPEN';
    return row.state !== 'OPEN';
  }

  status(domain, now = Date.now()) {
    const row = this.#row(domain);
    if (row.state === 'OPEN' && row.openedAt != null && now - row.openedAt >= this.cooldownMs) row.state = 'HALF_OPEN';
    return { domain, state: row.state, failuresInWindow: row.failures.filter((at) => now - at < this.windowMs).length, openedAt: row.openedAt };
  }

  reset(domain) { this.domains.delete(domain); }

  snapshot() { return { version: 1, failureThreshold: this.failureThreshold, windowMs: this.windowMs, cooldownMs: this.cooldownMs, domains: [...this.domains.entries()].map(([domain, row]) => [domain, structuredClone(row)]) }; }
  restore(snapshot) {
    if (!snapshot || snapshot.version !== 1) throw new Error('unsupported circuit-breaker snapshot');
    this.failureThreshold = Number(snapshot.failureThreshold ?? this.failureThreshold);
    this.windowMs = Number(snapshot.windowMs ?? this.windowMs);
    this.cooldownMs = Number(snapshot.cooldownMs ?? this.cooldownMs);
    this.domains = new Map((snapshot.domains ?? []).map(([domain, row]) => [domain, structuredClone(row)]));
  }
}
