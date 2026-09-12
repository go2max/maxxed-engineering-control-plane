import { criticalPathScore, portfolioFairnessPenalty } from './critical-path.js';

function requirementMatch(worker, task) {
  const req = task.requirements ?? {};
  const metadata = worker.metadata ?? {};
  const capacity = worker.capacity ?? {};
  const capabilities = new Set(worker.capabilities ?? []);
  if (worker.state && !['AVAILABLE', 'BUSY'].includes(worker.state)) return false;
  if ((worker.pressure?.cpuPct ?? 0) >= 95) return false;
  if (req.os && req.os !== 'any' && metadata.os !== req.os) return false;
  if (req.arch && metadata.arch !== req.arch) return false;
  if ((req.capabilities ?? []).some((cap) => !capabilities.has(cap))) return false;
  if ((capacity.freeSlots ?? 0) < 1) return false;
  if ((capacity.freeMemoryMb ?? Infinity) < (req.minMemoryMb ?? 0)) return false;
  return true;
}

export function scoreTask(graph, task, { now = Date.now(), starvationMs = 30 * 60_000, activeClaims = [] } = {}) {
  const priority = Number(task.metadata?.priority ?? 0);
  const createdAt = Number(task.metadata?.createdAt ?? now);
  const ageMs = Math.max(0, now - createdAt);
  const starvationSteps = Math.floor(ageMs / starvationMs);
  const unlock = graph.unlockCount(task.key);
  const critical = criticalPathScore(graph, task.key);
  const fairness = portfolioFairnessPenalty(task, activeClaims);
  const riskPenalty = task.riskClass === 'high' ? 25 : task.riskClass === 'critical' ? 50 : 0;
  const failurePenalty = Number(task.metadata?.failureCount ?? 0) * 5;
  const score = priority * 10 + unlock * 20 + critical.score + starvationSteps * 3 - riskPenalty - failurePenalty - fairness.total;
  return { score, priority, unlock, criticalDepth: critical.depth, criticalPathScore: critical.score, starvationSteps, riskPenalty, failurePenalty, fairness };
}

export function adaptiveLaneCapacity(workers, hardLimit = 16) {
  let capacity = 0;
  for (const worker of workers) {
    if (worker.state && !['AVAILABLE', 'BUSY'].includes(worker.state)) continue;
    const cpu = worker.pressure?.cpuPct ?? 0;
    if (cpu >= 95) continue;
    const slots = Math.max(0, worker.capacity?.freeSlots ?? 0);
    const pressureFactor = cpu >= 85 ? 0.25 : cpu >= 70 ? 0.5 : 1;
    capacity += Math.floor(slots * pressureFactor);
  }
  return Math.max(0, Math.min(hardLimit, capacity));
}

export class PortfolioScheduler {
  constructor({ graph, repoLaneLimit = 2, totalLaneLimit = 16, repoLaneLimits = {} } = {}) {
    if (!graph) throw new Error('graph is required');
    this.graph = graph;
    this.repoLaneLimit = repoLaneLimit;
    this.totalLaneLimit = totalLaneLimit;
    this.repoLaneLimits = { ...repoLaneLimits };
  }

  plan(workers, options = {}) { return this.planWithReport(workers, options).dispatches; }

  planWithReport(workers, { now = Date.now(), activeClaims = [] } = {}) {
    const repoUsage = new Map();
    for (const claim of activeClaims) if (claim.repository) repoUsage.set(claim.repository, (repoUsage.get(claim.repository) ?? 0) + 1);

    const workerSlots = new Map(workers.map((worker) => [worker.workerId, Math.max(0, worker.capacity?.freeSlots ?? 0)]));
    const adaptiveLimit = adaptiveLaneCapacity(workers, this.totalLaneLimit);
    const remainingLaneBudget = Math.max(0, adaptiveLimit - activeClaims.length);
    const candidates = this.graph.frontier().map((task) => ({ task, scoring: scoreTask(this.graph, task, { now, activeClaims }) }))
      .sort((a, b) => b.scoring.score - a.scoring.score || a.task.key.localeCompare(b.task.key));

    const dispatches = [];
    const backpressure = [];
    for (const candidate of candidates) {
      const { task, scoring } = candidate;
      const repo = task.repository ?? '__unscoped__';
      if (dispatches.length >= remainingLaneBudget) {
        backpressure.push({ taskKey: task.key, reason: 'global-lane-capacity', adaptiveLimit, activeClaims: activeClaims.length });
        continue;
      }
      const repoLimit = this.repoLaneLimits[repo] ?? this.repoLaneLimit;
      if ((repoUsage.get(repo) ?? 0) >= repoLimit) {
        backpressure.push({ taskKey: task.key, reason: 'repository-wip-limit', repository: task.repository, limit: repoLimit });
        continue;
      }
      const eligible = workers
        .filter((worker) => (workerSlots.get(worker.workerId) ?? 0) > 0 && requirementMatch(worker, task))
        .sort((a, b) => {
          const slots = (workerSlots.get(b.workerId) ?? 0) - (workerSlots.get(a.workerId) ?? 0);
          if (slots) return slots;
          return (a.pressure?.cpuPct ?? 0) - (b.pressure?.cpuPct ?? 0);
        });
      const worker = eligible[0];
      if (!worker) {
        backpressure.push({ taskKey: task.key, reason: 'no-eligible-worker', requirements: task.requirements ?? {} });
        continue;
      }
      workerSlots.set(worker.workerId, workerSlots.get(worker.workerId) - 1);
      repoUsage.set(repo, (repoUsage.get(repo) ?? 0) + 1);
      activeClaims = [...activeClaims, { taskKey: task.key, repository: task.repository, product: task.product, workerId: worker.workerId }];
      dispatches.push({
        taskKey: task.key,
        repository: task.repository,
        product: task.product,
        workerId: worker.workerId,
        score: scoring.score,
        explanation: {
          priority: scoring.priority,
          dependencyUnlocks: scoring.unlock,
          criticalDepth: scoring.criticalDepth,
          criticalPathScore: scoring.criticalPathScore,
          starvationSteps: scoring.starvationSteps,
          riskPenalty: scoring.riskPenalty,
          failurePenalty: scoring.failurePenalty,
          fairnessPenalty: scoring.fairness.total,
          workerFreeSlotsBefore: workerSlots.get(worker.workerId) + 1,
          workerCpuPct: worker.pressure?.cpuPct ?? 0,
          adaptiveLaneLimit: adaptiveLimit,
          repositoryLaneLimit: repoLimit
        }
      });
    }
    return { dispatches, backpressure, adaptiveLimit, remainingLaneBudget };
  }
}
