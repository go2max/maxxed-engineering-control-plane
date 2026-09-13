import { createHash } from 'node:crypto';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

export function dispatchDecisionId(input) {
  return createHash('sha256').update(JSON.stringify(stable(input))).digest('hex');
}

export function buildDispatchAudit({ now, workers = [], activeClaims = [], dispatches = [], backpressure = [], adaptiveLimit, remainingLaneBudget, rebalancing = [] } = {}) {
  const payload = {
    version: 1,
    evaluatedAt: now,
    workerSnapshot: workers.map((worker) => ({
      workerId: worker.workerId,
      state: worker.state ?? null,
      freeSlots: Number(worker.capacity?.freeSlots ?? 0),
      freeMemoryMb: Number(worker.capacity?.freeMemoryMb ?? 0),
      cpuPct: Number(worker.pressure?.cpuPct ?? 0),
      capabilities: [...(worker.capabilities ?? [])].sort()
    })).sort((a, b) => a.workerId.localeCompare(b.workerId)),
    activeClaims: activeClaims.map((claim) => ({ taskKey: claim.taskKey, repository: claim.repository ?? null, workerId: claim.workerId ?? null })).sort((a, b) => a.taskKey.localeCompare(b.taskKey)),
    dispatches,
    backpressure,
    adaptiveLimit,
    remainingLaneBudget,
    rebalancing
  };
  return { ...payload, decisionId: dispatchDecisionId(payload) };
}

export function workerSuitability(worker, task) {
  const req = task.requirements ?? {};
  const slots = Number(worker.capacity?.freeSlots ?? 0);
  const freeMemory = Number(worker.capacity?.freeMemoryMb ?? 0);
  const cpu = Number(worker.pressure?.cpuPct ?? 0);
  const preferred = new Set(req.preferredCapabilities ?? []);
  const capabilities = new Set(worker.capabilities ?? []);
  const preferredMatches = [...preferred].filter((capability) => capabilities.has(capability)).length;
  const affinity = req.preferredWorkerIds?.includes(worker.workerId) ? 1 : 0;
  return {
    score: affinity * 1_000 + preferredMatches * 100 + slots * 10 + Math.min(50, Math.floor(freeMemory / 1024)) - Math.floor(cpu / 5),
    affinity,
    preferredMatches,
    slots,
    freeMemory,
    cpu
  };
}
