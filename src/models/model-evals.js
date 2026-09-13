import { createHash } from 'node:crypto';

export function modelManifestDigest(manifest) {
  const canonical = JSON.stringify({
    id: manifest.id,
    family: manifest.family ?? null,
    quantization: manifest.quantization ?? null,
    artifactSha256: manifest.artifactSha256 ?? null,
    contextWindow: manifest.contextWindow ?? 0,
    capabilities: [...(manifest.capabilities ?? [])].sort()
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export class ModelEvalLedger {
  #records = new Map();

  record({ modelId, taskClass = 'standard', accepted, latencyMs = null, tokens = null, failureClass = null }, now = Date.now()) {
    if (!modelId) throw new Error('modelId is required');
    const key = `${modelId}:${taskClass}`;
    const current = this.#records.get(key) ?? { modelId, taskClass, runs: 0, accepted: 0, failed: 0, totalLatencyMs: 0, measuredLatencyRuns: 0, lastFailureClass: null, updatedAt: now };
    current.runs += 1;
    if (accepted) current.accepted += 1; else current.failed += 1;
    if (Number.isFinite(latencyMs)) { current.totalLatencyMs += latencyMs; current.measuredLatencyRuns += 1; }
    if (!accepted && failureClass) current.lastFailureClass = failureClass;
    current.updatedAt = now;
    this.#records.set(key, current);
    return this.stats(modelId, taskClass);
  }

  stats(modelId, taskClass = 'standard') {
    const record = this.#records.get(`${modelId}:${taskClass}`);
    if (!record) return { modelId, taskClass, runs: 0, accepted: 0, failed: 0, acceptanceRate: null, averageLatencyMs: null, lastFailureClass: null };
    return {
      ...structuredClone(record),
      acceptanceRate: record.runs ? record.accepted / record.runs : null,
      averageLatencyMs: record.measuredLatencyRuns ? record.totalLatencyMs / record.measuredLatencyRuns : null
    };
  }

  healthRecommendation(modelId, taskClass = 'standard', { minRuns = 5, minAcceptanceRate = 0.6 } = {}) {
    const stats = this.stats(modelId, taskClass);
    if (stats.runs < minRuns) return { healthy: true, reason: 'insufficient-evidence', stats };
    if (stats.acceptanceRate < minAcceptanceRate) return { healthy: false, reason: 'acceptance-rate-below-threshold', stats };
    return { healthy: true, reason: 'acceptance-rate-ok', stats };
  }

  rank(modelIds, taskClass = 'standard') {
    return modelIds.map((modelId) => this.stats(modelId, taskClass)).sort((a, b) => {
      const ar = a.acceptanceRate ?? -1;
      const br = b.acceptanceRate ?? -1;
      if (br !== ar) return br - ar;
      const al = a.averageLatencyMs ?? Infinity;
      const bl = b.averageLatencyMs ?? Infinity;
      return al - bl;
    });
  }

  snapshot() { return { version: 1, records: [...this.#records.entries()] }; }

  restore(snapshot) {
    if (!snapshot || snapshot.version !== 1) throw new Error('unsupported model eval snapshot');
    this.#records = new Map((snapshot.records ?? []).map(([key, value]) => [key, structuredClone(value)]));
  }

  list() { return [...this.#records.values()].map((record) => structuredClone(record)); }
}
