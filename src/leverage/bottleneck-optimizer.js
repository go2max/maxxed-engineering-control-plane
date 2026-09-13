export class BottleneckOptimizer {
  constructor({ minSamples = 5 } = {}) { this.minSamples = Math.max(1, Number(minSamples)); }

  analyze({ workers = [], verifierBacklog = 0, queueDepth = 0, modelQueue = 0, cacheHitRate = 0, transformHitRate = 0, failureRate = 0 } = {}) {
    const freeSlots = workers.reduce((sum, worker) => sum + Math.max(0, Number(worker.capacity?.freeSlots ?? 0)), 0);
    const pressure = workers.length ? workers.reduce((sum, worker) => sum + Math.max(Number(worker.pressure?.cpuPct ?? 0), Number(worker.pressure?.memoryPct ?? 0)), 0) / workers.length : 0;
    const candidates = [
      { kind: 'verification', score: Number(verifierBacklog) * 3 },
      { kind: 'execution-capacity', score: Math.max(0, Number(queueDepth) - freeSlots) * 2 + pressure / 50 },
      { kind: 'model-capacity', score: Number(modelQueue) * 2 },
      { kind: 'novel-reasoning', score: Math.max(0, 1 - Number(cacheHitRate) - Number(transformHitRate)) * Number(queueDepth) },
      { kind: 'quality', score: Number(failureRate) * 10 }
    ].sort((a,b) => b.score - a.score);
    const top = candidates[0];
    const recommendation = top.score <= 0 ? 'hold' : ({ verification: 'shift-capacity-to-verification', 'execution-capacity': 'add-or-rebalance-local-workers', 'model-capacity': 'warm-or-replicate-local-models', 'novel-reasoning': 'expand-solution-cache-and-transforms', quality: 'contract-concurrency-and-improve-repair-memory' }[top.kind]);
    return { bottleneck: top.kind, score: top.score, recommendation, metrics: { freeSlots, pressure, verifierBacklog: Number(verifierBacklog), queueDepth: Number(queueDepth), modelQueue: Number(modelQueue), cacheHitRate: Number(cacheHitRate), transformHitRate: Number(transformHitRate), failureRate: Number(failureRate) }, ranked: candidates };
  }
}
