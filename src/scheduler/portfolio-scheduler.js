function requirementMatch(worker, task) {
  const req = task.requirements ?? {};
  const metadata = worker.metadata ?? {};
  const capacity = worker.capacity ?? {};
  const capabilities = new Set(worker.capabilities ?? []);
  if (req.os && req.os !== 'any' && metadata.os !== req.os) return false;
  if (req.arch && metadata.arch !== req.arch) return false;
  if ((req.capabilities ?? []).some((cap) => !capabilities.has(cap))) return false;
  if ((capacity.freeSlots ?? 0) < 1) return false;
  if ((capacity.freeMemoryMb ?? Infinity) < (req.minMemoryMb ?? 0)) return false;
  return true;
}

export function scoreTask(graph, task, { now = Date.now(), starvationMs = 30 * 60_000 } = {}) {
  const priority = Number(task.metadata?.priority ?? 0);
  const createdAt = Number(task.metadata?.createdAt ?? now);
  const ageMs = Math.max(0, now - createdAt);
  const starvationSteps = Math.floor(ageMs / starvationMs);
  const unlock = graph.unlockCount(task.key);
  const riskPenalty = task.riskClass === 'high' ? 25 : task.riskClass === 'critical' ? 50 : 0;
  const failurePenalty = Number(task.metadata?.failureCount ?? 0) * 5;
  const score = priority * 10 + unlock * 20 + starvationSteps * 3 - riskPenalty - failurePenalty;
  return { score, priority, unlock, starvationSteps, riskPenalty, failurePenalty };
}

export class PortfolioScheduler {
  constructor({ graph, repoLaneLimit = 2, totalLaneLimit = 16 } = {}) {
    if (!graph) throw new Error('graph is required');
    this.graph = graph;
    this.repoLaneLimit = repoLaneLimit;
    this.totalLaneLimit = totalLaneLimit;
  }

  plan(workers, { now = Date.now(), activeClaims = [] } = {}) {
    const repoUsage = new Map();
    for (const claim of activeClaims) {
      if (claim.repository) repoUsage.set(claim.repository, (repoUsage.get(claim.repository) ?? 0) + 1);
    }

    const workerSlots = new Map(workers.map((worker) => [worker.workerId, Math.max(0, worker.capacity?.freeSlots ?? 0)]));
    const candidates = this.graph.frontier().map((task) => ({ task, scoring: scoreTask(this.graph, task, { now }) }))
      .sort((a, b) => b.scoring.score - a.scoring.score || a.task.key.localeCompare(b.task.key));

    const dispatches = [];
    for (const candidate of candidates) {
      if (dispatches.length + activeClaims.length >= this.totalLaneLimit) break;
      const { task, scoring } = candidate;
      const repo = task.repository ?? '__unscoped__';
      if ((repoUsage.get(repo) ?? 0) >= this.repoLaneLimit) continue;
      const eligible = workers
        .filter((worker) => (workerSlots.get(worker.workerId) ?? 0) > 0 && requirementMatch(worker, task))
        .sort((a, b) => {
          const slots = (workerSlots.get(b.workerId) ?? 0) - (workerSlots.get(a.workerId) ?? 0);
          if (slots) return slots;
          return (a.pressure?.cpuPct ?? 0) - (b.pressure?.cpuPct ?? 0);
        });
      const worker = eligible[0];
      if (!worker) continue;
      workerSlots.set(worker.workerId, workerSlots.get(worker.workerId) - 1);
      repoUsage.set(repo, (repoUsage.get(repo) ?? 0) + 1);
      dispatches.push({
        taskKey: task.key,
        repository: task.repository,
        workerId: worker.workerId,
        score: scoring.score,
        explanation: {
          priority: scoring.priority,
          dependencyUnlocks: scoring.unlock,
          starvationSteps: scoring.starvationSteps,
          riskPenalty: scoring.riskPenalty,
          failurePenalty: scoring.failurePenalty,
          workerFreeSlotsBefore: workerSlots.get(worker.workerId) + 1,
          workerCpuPct: worker.pressure?.cpuPct ?? 0
        }
      });
    }
    return dispatches;
  }
}
