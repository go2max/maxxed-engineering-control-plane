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

function newRecord(modelId, taskClass, now, dimensions = {}) {
  return { modelId, taskClass, repository: dimensions.repository ?? null, language: dimensions.language ?? null, runs: 0, accepted: 0, failed: 0, totalLatencyMs: 0, measuredLatencyRuns: 0, totalCostUnits: 0, measuredCostRuns: 0, totalTokens: 0, lastFailureClass: null, updatedAt: now };
}
function updateRecord(current, { accepted, latencyMs, tokens, costUnits, failureClass }, now) {
  current.runs += 1; accepted ? current.accepted += 1 : current.failed += 1;
  if (Number.isFinite(latencyMs)) { current.totalLatencyMs += Number(latencyMs); current.measuredLatencyRuns += 1; }
  if (Number.isFinite(costUnits)) { current.totalCostUnits += Number(costUnits); current.measuredCostRuns += 1; }
  if (Number.isFinite(tokens)) current.totalTokens += Number(tokens);
  if (!accepted && failureClass) current.lastFailureClass = failureClass;
  current.updatedAt = now; return current;
}
function computed(record, fallback) {
  if (!record) return fallback;
  return { ...structuredClone(record), acceptanceRate: record.runs ? record.accepted / record.runs : null, averageLatencyMs: record.measuredLatencyRuns ? record.totalLatencyMs / record.measuredLatencyRuns : null, averageCostUnits: record.measuredCostRuns ? record.totalCostUnits / record.measuredCostRuns : null, averageTokens: record.runs ? record.totalTokens / record.runs : null };
}
function dimensionKey(modelId, taskClass, repository, language) { return `${modelId}:${taskClass}:${repository ?? '*'}:${language ?? '*'}`; }

export class ModelEvalLedger {
  #records = new Map();
  #dimensions = new Map();

  record({ modelId, taskClass = 'standard', accepted, latencyMs = null, tokens = null, costUnits = null, failureClass = null, repository = null, language = null }, now = Date.now()) {
    if (!modelId) throw new Error('modelId is required');
    const key = `${modelId}:${taskClass}`;
    const current = this.#records.get(key) ?? newRecord(modelId, taskClass, now);
    this.#records.set(key, updateRecord(current, { accepted, latencyMs, tokens, costUnits, failureClass }, now));
    if (repository || language) {
      const dkey = dimensionKey(modelId, taskClass, repository, language);
      const detail = this.#dimensions.get(dkey) ?? newRecord(modelId, taskClass, now, { repository, language });
      this.#dimensions.set(dkey, updateRecord(detail, { accepted, latencyMs, tokens, costUnits, failureClass }, now));
    }
    return this.stats(modelId, taskClass, { repository, language });
  }

  stats(modelId, taskClass = 'standard', { repository = null, language = null, minDimensionRuns = 3 } = {}) {
    const fallback = { modelId, taskClass, runs: 0, accepted: 0, failed: 0, acceptanceRate: null, averageLatencyMs: null, averageCostUnits: null, averageTokens: null, lastFailureClass: null };
    if (repository || language) {
      const detail = this.#dimensions.get(dimensionKey(modelId, taskClass, repository, language));
      if (detail && detail.runs >= minDimensionRuns) return { ...computed(detail, fallback), dimensionSource: 'specific' };
    }
    return { ...computed(this.#records.get(`${modelId}:${taskClass}`), fallback), dimensionSource: 'aggregate' };
  }

  healthRecommendation(modelId, taskClass = 'standard', { minRuns = 5, minAcceptanceRate = 0.6, repository = null, language = null } = {}) {
    const stats = this.stats(modelId, taskClass, { repository, language });
    if (stats.runs < minRuns) return { healthy: true, reason: 'insufficient-evidence', stats };
    if (stats.acceptanceRate < minAcceptanceRate) return { healthy: false, reason: 'acceptance-rate-below-threshold', stats };
    return { healthy: true, reason: 'acceptance-rate-ok', stats };
  }

  rank(modelIds, taskClass = 'standard', { repository = null, language = null, costWeight = 0.05, latencyWeight = 0.00001 } = {}) {
    return modelIds.map((modelId) => {
      const stats = this.stats(modelId, taskClass, { repository, language });
      const score = (stats.acceptanceRate ?? 0.5) * 100 - (stats.averageCostUnits ?? 0) * costWeight - (stats.averageLatencyMs ?? 0) * latencyWeight;
      return { ...stats, routingScore: score };
    }).sort((a, b) => b.routingScore - a.routingScore || a.modelId.localeCompare(b.modelId));
  }

  shadowComparison({ candidateId, incumbentId, taskClass = 'standard', repository = null, language = null, minRuns = 10, maxAcceptanceRegression = 0.02, maxLatencyRatio = 1.5, maxCostRatio = 1.25 } = {}) {
    const candidate = this.stats(candidateId, taskClass, { repository, language }); const incumbent = this.stats(incumbentId, taskClass, { repository, language });
    if (candidate.runs < minRuns || incumbent.runs < minRuns) return { promotable: false, reason: 'insufficient-shadow-evidence', candidate, incumbent };
    const acceptanceOk = (candidate.acceptanceRate ?? 0) >= (incumbent.acceptanceRate ?? 0) - Number(maxAcceptanceRegression);
    const latencyOk = incumbent.averageLatencyMs == null || candidate.averageLatencyMs == null || candidate.averageLatencyMs <= incumbent.averageLatencyMs * Number(maxLatencyRatio);
    const costOk = incumbent.averageCostUnits == null || candidate.averageCostUnits == null || candidate.averageCostUnits <= incumbent.averageCostUnits * Number(maxCostRatio);
    return { promotable: acceptanceOk && latencyOk && costOk, reason: acceptanceOk && latencyOk && costOk ? 'candidate-meets-shadow-policy' : 'candidate-regressed', checks: { acceptanceOk, latencyOk, costOk }, candidate, incumbent };
  }

  snapshot() { return { version: 2, records: [...this.#records.entries()], dimensions: [...this.#dimensions.entries()] }; }

  restore(snapshot) {
    if (!snapshot || ![1, 2].includes(snapshot.version)) throw new Error('unsupported model eval snapshot');
    this.#records = new Map((snapshot.records ?? []).map(([key, value]) => [key, structuredClone(value)]));
    this.#dimensions = new Map((snapshot.dimensions ?? []).map(([key, value]) => [key, structuredClone(value)]));
  }

  list() { return [...this.#records.values()].map((record) => structuredClone(record)); }
  detailedList() { return [...this.#dimensions.values()].map((record) => structuredClone(record)); }
}
