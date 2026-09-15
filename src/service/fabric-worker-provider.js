import { toolCacheKey } from '../leverage/tool-result-cache.js';

// Fleet membership/capacity is read repeatedly within the same scheduling window: dispatch(),
// schedulePreview() and reconcileFabric() (via FabricExecutionClient#fleet, which hits the same
// underlying GET /fleet endpoint) can all fire within a single control-plane tick. When a
// `toolResultCache` is supplied, reads are cached under a short TTL and coalesced via
// singleflight, so concurrent/duplicate reads of the same fleet snapshot within a tick don't
// each round-trip to the compute fabric (issue #65, section 4).
export function fleetCacheKey(baseUrl) {
  return toolCacheKey({ tool: 'fabric.fleet', scope: { baseUrl } });
}

export function createFabricWorkerProvider({ baseUrl = 'http://127.0.0.1:7788', adminToken = '', fetchImpl = fetch, toolResultCache = null, cacheTtlMs = 2_000 } = {}) {
  const root = baseUrl.replace(/\/$/, '');
  const loadFleet = async () => {
    const response = await fetchImpl(`${root}/fleet`, { headers: { authorization: `Bearer ${adminToken}`, accept: 'application/json' } });
    if (!response.ok) throw new Error(`compute fabric fleet request failed: ${response.status}`);
    return response.json();
  };
  return async function workerProvider() {
    if (!adminToken) return [];
    const body = toolResultCache
      ? (await toolResultCache.getOrLoad(fleetCacheKey(root), loadFleet, { ttlMs: cacheTtlMs, tags: ['fabric-fleet'] })).value
      : await loadFleet();
    return (body.workers ?? []).map((worker) => ({
      workerId: worker.workerId,
      state: worker.state,
      capabilities: worker.capabilities ?? [],
      capacity: worker.capacity ?? {},
      pressure: worker.pressure ?? {},
      metadata: worker.metadata ?? {}
    }));
  };
}
