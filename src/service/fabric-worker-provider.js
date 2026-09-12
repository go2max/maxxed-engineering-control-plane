export function createFabricWorkerProvider({ baseUrl = 'http://127.0.0.1:7788', adminToken = '', fetchImpl = fetch } = {}) {
  const root = baseUrl.replace(/\/$/, '');
  return async function workerProvider() {
    if (!adminToken) return [];
    const response = await fetchImpl(`${root}/fleet`, { headers: { authorization: `Bearer ${adminToken}`, accept: 'application/json' } });
    if (!response.ok) throw new Error(`compute fabric fleet request failed: ${response.status}`);
    const body = await response.json();
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
