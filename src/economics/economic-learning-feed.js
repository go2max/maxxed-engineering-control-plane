/**
 * Feeds predicted-vs-observed economic deltas back into the learning store, so future
 * certificates for similar risk classes/surfaces carry evidence-backed confidence instead of
 * a flat prior.
 */
export class EconomicLearningFeed {
  constructor({ maxSamples = 5000 } = {}) {
    this.maxSamples = Math.max(1, Number(maxSamples));
    this.samples = [];
  }

  record({ certificateId, riskClass, sourceSha, candidateSha, estimatedMonthlyDeltaUsd, observedMonthlyDeltaUsd, now = Date.now() } = {}) {
    if (!certificateId) throw new Error('certificateId is required');
    const forecastErrorUsd = Number(observedMonthlyDeltaUsd) - Number(estimatedMonthlyDeltaUsd);
    const forecastErrorRatio = estimatedMonthlyDeltaUsd !== 0 ? forecastErrorUsd / Math.abs(estimatedMonthlyDeltaUsd) : null;
    const row = { certificateId, riskClass, sourceSha, candidateSha, estimatedMonthlyDeltaUsd: Number(estimatedMonthlyDeltaUsd), observedMonthlyDeltaUsd: Number(observedMonthlyDeltaUsd), forecastErrorUsd, forecastErrorRatio, at: Number(now) };
    this.samples.push(row);
    if (this.samples.length > this.maxSamples) this.samples.splice(0, this.samples.length - this.maxSamples);
    return structuredClone(row);
  }

  /** Mean absolute forecast-error ratio by risk class — used to calibrate future certificate confidence. */
  calibrationByRiskClass() {
    const byClass = new Map();
    for (const sample of this.samples) {
      if (sample.forecastErrorRatio == null) continue;
      if (!byClass.has(sample.riskClass)) byClass.set(sample.riskClass, []);
      byClass.get(sample.riskClass).push(Math.abs(sample.forecastErrorRatio));
    }
    return Object.fromEntries([...byClass.entries()].map(([riskClass, ratios]) => [
      riskClass,
      { samples: ratios.length, meanAbsoluteForecastErrorRatio: ratios.reduce((sum, value) => sum + value, 0) / ratios.length }
    ]));
  }

  snapshot() { return { version: 1, samples: this.samples.map((row) => structuredClone(row)) }; }
  restore(snapshot) {
    if (snapshot && snapshot.version !== 1) throw new Error('unsupported economic-learning-feed snapshot');
    this.samples = (snapshot?.samples ?? []).map((row) => structuredClone(row));
  }
}
