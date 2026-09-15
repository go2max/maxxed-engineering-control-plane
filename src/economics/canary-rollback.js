/**
 * Runs a high-risk economic canary: observes actual cost signal for a candidate over a
 * post-merge observation window and compares it against a rollback threshold relative to the
 * certificate's forecast (or an absolute cap). Crossing the threshold triggers rollback.
 */
export class CanaryRollbackController {
  constructor({ observationWindowMs = 60 * 60 * 1000, regressionMultiplierThreshold = 1.5, absoluteCapUsd = null } = {}) {
    this.observationWindowMs = Math.max(1, Number(observationWindowMs));
    this.regressionMultiplierThreshold = Math.max(1, Number(regressionMultiplierThreshold));
    this.absoluteCapUsd = absoluteCapUsd == null ? null : Number(absoluteCapUsd);
    this.canaries = new Map();
  }

  start({ candidateSha, certificateId, forecastMonthlyDeltaUsd, now = Date.now() } = {}) {
    if (!candidateSha) throw new Error('candidateSha is required');
    const row = {
      candidateSha, certificateId,
      forecastMonthlyDeltaUsd: Number(forecastMonthlyDeltaUsd ?? 0),
      startedAt: Number(now),
      windowEndsAt: Number(now) + this.observationWindowMs,
      samples: [],
      state: 'OBSERVING'
    };
    this.canaries.set(candidateSha, row);
    return structuredClone(row);
  }

  observe(candidateSha, { observedMonthlyDeltaUsd, now = Date.now() } = {}) {
    const row = this.canaries.get(candidateSha);
    if (!row) throw new Error(`no active canary for ${candidateSha}`);
    if (row.state !== 'OBSERVING') return structuredClone(row);
    row.samples.push({ observedMonthlyDeltaUsd: Number(observedMonthlyDeltaUsd), at: Number(now) });

    const regressed = this.#regressed(row, Number(observedMonthlyDeltaUsd));
    if (regressed) {
      row.state = 'ROLLBACK_TRIGGERED';
      row.rollbackReason = regressed;
      row.rolledBackAt = Number(now);
      return structuredClone(row);
    }
    if (Number(now) >= row.windowEndsAt) {
      row.state = 'OBSERVED_WITHIN_THRESHOLD';
      row.completedAt = Number(now);
    }
    return structuredClone(row);
  }

  #regressed(row, observedMonthlyDeltaUsd) {
    if (this.absoluteCapUsd != null && observedMonthlyDeltaUsd >= this.absoluteCapUsd) return 'absolute-cap-exceeded';
    const forecast = Math.max(0.01, Math.abs(row.forecastMonthlyDeltaUsd));
    if (observedMonthlyDeltaUsd >= forecast * this.regressionMultiplierThreshold) return 'forecast-multiplier-exceeded';
    return null;
  }

  get(candidateSha) {
    const row = this.canaries.get(candidateSha);
    return row ? structuredClone(row) : null;
  }

  snapshot() { return { version: 1, canaries: [...this.canaries.values()].map((row) => structuredClone(row)) }; }
  restore(snapshot) {
    if (snapshot && snapshot.version !== 1) throw new Error('unsupported canary snapshot');
    this.canaries = new Map((snapshot?.canaries ?? []).map((row) => [row.candidateSha, structuredClone(row)]));
  }
}
