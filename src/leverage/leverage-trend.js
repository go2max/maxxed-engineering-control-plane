const RANGE_MS = Object.freeze({
  '1d': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000
});

function bucketMsFor(range) {
  if (range === '1d') return 60 * 60 * 1000;
  if (range === '3d') return 3 * 60 * 60 * 1000;
  if (range === '7d') return 6 * 60 * 60 * 1000;
  if (range === '30d') return 24 * 60 * 60 * 1000;
  return 3 * 24 * 60 * 60 * 1000;
}

function bucketStart(timestamp, size) {
  return Math.floor(Number(timestamp) / size) * size;
}

export class LeverageTrend {
  constructor({ maxSamples = 100_000 } = {}) {
    this.maxSamples = Math.max(1, Number(maxSamples));
    this.samples = [];
  }

  record(sample = {}) {
    const row = {
      at: Number(sample.at ?? Date.now()),
      acceptedEngineeringHours: Number(sample.acceptedEngineeringHours ?? 0),
      ownerHours: Number(sample.ownerHours ?? 0),
      elapsedHours: Number(sample.elapsedHours ?? 0),
      cacheHits: Number(sample.cacheHits ?? 0),
      transformHits: Number(sample.transformHits ?? 0),
      reasoningRuns: Number(sample.reasoningRuns ?? 0),
      accepted: Number(sample.accepted ?? 0),
      firstPassAccepted: Number(sample.firstPassAccepted ?? 0),
      repairedAccepted: Number(sample.repairedAccepted ?? 0),
      failed: Number(sample.failed ?? 0),
      activeConcurrency: Number(sample.activeConcurrency ?? 0)
    };
    this.samples.push(row);
    if (this.samples.length > this.maxSamples) this.samples.splice(0, this.samples.length - this.maxSamples);
    return structuredClone(row);
  }

  project({ range = '7d', now = Date.now() } = {}) {
    const windowMs = RANGE_MS[range] ?? RANGE_MS['7d'];
    const size = bucketMsFor(range);
    const cutoff = Number(now) - windowMs;
    const buckets = new Map();
    for (const sample of this.samples) {
      if (sample.at < cutoff || sample.at > Number(now)) continue;
      const key = bucketStart(sample.at, size);
      const bucket = buckets.get(key) ?? {
        at: key,
        acceptedEngineeringHours: 0, ownerHours: 0, elapsedHours: 0,
        cacheHits: 0, transformHits: 0, reasoningRuns: 0,
        accepted: 0, firstPassAccepted: 0, repairedAccepted: 0, failed: 0,
        activeConcurrencyTotal: 0, activeConcurrencySamples: 0
      };
      bucket.acceptedEngineeringHours += sample.acceptedEngineeringHours;
      bucket.ownerHours += sample.ownerHours;
      bucket.elapsedHours += sample.elapsedHours;
      bucket.cacheHits += sample.cacheHits;
      bucket.transformHits += sample.transformHits;
      bucket.reasoningRuns += sample.reasoningRuns;
      bucket.accepted += sample.accepted;
      bucket.firstPassAccepted += sample.firstPassAccepted;
      bucket.repairedAccepted += sample.repairedAccepted;
      bucket.failed += sample.failed;
      bucket.activeConcurrencyTotal += sample.activeConcurrency;
      bucket.activeConcurrencySamples += 1;
      buckets.set(key, bucket);
    }

    const points = [...buckets.values()].sort((a,b) => a.at - b.at).map((b) => {
      const workUnits = b.cacheHits + b.transformHits + b.reasoningRuns;
      const attempts = b.accepted + b.failed;
      return {
        at: b.at,
        leverageMultiplier: b.ownerHours > 0 ? b.acceptedEngineeringHours / b.ownerHours : null,
        engineeringHours: b.acceptedEngineeringHours,
        ownerHours: b.ownerHours,
        elapsedHours: b.elapsedHours,
        cacheHitRate: workUnits > 0 ? b.cacheHits / workUnits : null,
        transformHitRate: workUnits > 0 ? b.transformHits / workUnits : null,
        reasoningRate: workUnits > 0 ? b.reasoningRuns / workUnits : null,
        firstPassAcceptanceRate: b.accepted > 0 ? b.firstPassAccepted / b.accepted : null,
        repairShare: b.accepted > 0 ? b.repairedAccepted / b.accepted : null,
        failureRate: attempts > 0 ? b.failed / attempts : null,
        activeConcurrency: b.activeConcurrencySamples ? b.activeConcurrencyTotal / b.activeConcurrencySamples : 0
      };
    });

    return { range, bucketMs: size, from: cutoff, to: Number(now), points };
  }

  snapshot() { return { version: 1, maxSamples: this.maxSamples, samples: this.samples.map((row) => structuredClone(row)) }; }
  restore(snapshot) { this.maxSamples = Math.max(1, Number(snapshot?.maxSamples ?? this.maxSamples)); this.samples = (snapshot?.samples ?? []).map((row) => structuredClone(row)).slice(-this.maxSamples); }
}
