import { criticalPathScore, portfolioFairnessPenalty } from './critical-path.js';
import { rebalanceRecommendations } from './scheduler-policy.js';
import { buildDispatchAudit, workerSuitability } from './dispatch-audit.js';
import { TaskStage, stageAllowed, taskStage } from './task-stage.js';
import { packetBlockedByActiveClaim, workPacketView } from './work-packet-adapter.js';

function requirementMatch(worker, task) {
  const req = task.requirements ?? {};
  const metadata = worker.metadata ?? {};
  const capacity = worker.capacity ?? {};
  const capabilities = new Set(worker.capabilities ?? []);
  if (worker.state && !['AVAILABLE', 'BUSY'].includes(worker.state)) return false;
  if ((worker.pressure?.cpuPct ?? 0) >= 95) return false;
  if ((worker.pressure?.memoryPct ?? 0) >= 95) return false;
  if (req.os && req.os !== 'any' && metadata.os !== req.os) return false;
  if (req.arch && metadata.arch !== req.arch) return false;
  if ((req.capabilities ?? []).some((cap) => !capabilities.has(cap))) return false;
  if ((capacity.freeSlots ?? 0) < 1) return false;
  if ((capacity.freeMemoryMb ?? Infinity) < (req.minMemoryMb ?? 0)) return false;
  return true;
}

export function scoreTask(graph, task, { now = Date.now(), starvationMs = 30 * 60_000, activeClaims = [], priorityAdjustment = 0 } = {}) {
  const priority = Number(task.metadata?.priority ?? 0);
  const createdAt = Number(task.metadata?.createdAt ?? now);
  const ageMs = Math.max(0, now - createdAt);
  const starvationSteps = Math.floor(ageMs / starvationMs);
  const unlock = graph.unlockCount(task.key);
  const critical = criticalPathScore(graph, task.key);
  const fairness = portfolioFairnessPenalty(task, activeClaims);
  const riskPenalty = task.riskClass === 'high' ? 25 : task.riskClass === 'critical' ? 50 : 0;
  const failurePenalty = Number(task.metadata?.failureCount ?? 0) * 5;
  const score = priority * 10 + priorityAdjustment + unlock * 20 + critical.score + starvationSteps * 3 - riskPenalty - failurePenalty - fairness.total;
  return { score, priority, priorityAdjustment, unlock, criticalDepth: critical.depth, criticalPathScore: critical.score, starvationSteps, riskPenalty, failurePenalty, fairness };
}

export function adaptiveLaneCapacity(workers, hardLimit = 16) {
  let capacity = 0;
  for (const worker of workers) {
    if (worker.state && !['AVAILABLE', 'BUSY'].includes(worker.state)) continue;
    const cpu = worker.pressure?.cpuPct ?? 0;
    const memory = worker.pressure?.memoryPct ?? 0;
    if (cpu >= 95 || memory >= 95) continue;
    const slots = Math.max(0, worker.capacity?.freeSlots ?? 0);
    const pressure = Math.max(cpu, memory);
    const pressureFactor = pressure >= 85 ? 0.25 : pressure >= 70 ? 0.5 : 1;
    capacity += Math.floor(slots * pressureFactor);
  }
  return Math.max(0, Math.min(hardLimit, capacity));
}

export class PortfolioScheduler {
  constructor({ graph, repoLaneLimit = 2, totalLaneLimit = 16, repoLaneLimits = {}, policy = null, performanceLedger = null } = {}) {
    if (!graph) throw new Error('graph is required');
    this.graph = graph;
    this.repoLaneLimit = repoLaneLimit;
    this.totalLaneLimit = totalLaneLimit;
    this.repoLaneLimits = { ...repoLaneLimits };
    this.policy = policy;
    this.performanceLedger = performanceLedger;
  }

  plan(workers, options = {}) { return this.planWithReport(workers, options).dispatches; }

  planWithReport(workers, { now = Date.now(), activeClaims = [], taskPredicate = () => true, admissionDecision = {} } = {}) {
    const originalClaims = structuredClone(activeClaims);
    const repoUsage = new Map();
    for (const claim of activeClaims) if (claim.repository) repoUsage.set(claim.repository, (repoUsage.get(claim.repository) ?? 0) + 1);
    const activeClaimStage = (claim) => claim.stage ?? taskStage(this.graph.get(claim.taskKey) ?? {});

    const workerSlots = new Map(workers.map((worker) => [worker.workerId, Math.max(0, worker.capacity?.freeSlots ?? 0)]));
    const adaptiveLimit = adaptiveLaneCapacity(workers, this.totalLaneLimit);
    // adaptiveLimit is derived only from the currently-available `workers` passed in this cycle;
    // workers already busy on activeClaims elsewhere in the fleet are correctly absent from that
    // list, so their claims must not be subtracted from it a second time (that under-counts real
    // headroom). Instead, cap this cycle's new dispatches by both the available-worker capacity
    // and the global totalLaneLimit ceiling net of lanes already in use.
    const remainingLaneBudget = Math.max(0, Math.min(adaptiveLimit, this.totalLaneLimit - activeClaims.length));
    const policyBackpressure = [];
    const candidates = this.graph.frontier(taskPredicate).flatMap((task) => {
      const stage = taskStage(task);
      const packet = workPacketView(task);
      if (!packet.valid) {
        policyBackpressure.push({ taskKey: task.key, repository: task.repository, reason: packet.reason, stage });
        return [];
      }
      if (packetBlockedByActiveClaim(task, activeClaims)) {
        policyBackpressure.push({ taskKey: task.key, repository: task.repository, reason: 'work-packet-active', stage, packetKey: packet.packetKey });
        return [];
      }
      if (stage === TaskStage.DEPLOYMENT && activeClaims.some((claim) => activeClaimStage(claim) === TaskStage.DEPLOYMENT)) {
        policyBackpressure.push({ taskKey: task.key, repository: task.repository, reason: 'deployment-serialized', stage });
        return [];
      }
      if (!stageAllowed(task, admissionDecision)) {
        policyBackpressure.push({ taskKey: task.key, repository: task.repository, reason: 'stage-admission-closed', stage, blockedStages: [...(admissionDecision.blockedStages ?? [])] });
        return [];
      }
      const policy = this.policy?.evaluate(task, now) ?? { allowed: true, priorityAdjustment: 0, deadlineUrgency: 0, override: null };
      if (!policy.allowed) {
        policyBackpressure.push({ taskKey: task.key, repository: task.repository, reason: policy.reason, stage });
        return [];
      }
      return [{ task, stage, packet, policy, scoring: scoreTask(this.graph, task, { now, activeClaims, priorityAdjustment: policy.priorityAdjustment }) }];
    }).sort((a, b) => b.scoring.score - a.scoring.score || a.task.key.localeCompare(b.task.key));

    const dispatches = [];
    const backpressure = [...policyBackpressure];
    for (const candidate of candidates) {
      const { task, stage, packet, scoring, policy } = candidate;
      const repo = task.repository ?? '__unscoped__';
      if (dispatches.length >= remainingLaneBudget) {
        backpressure.push({ taskKey: task.key, reason: 'global-lane-capacity', stage, adaptiveLimit, activeClaims: activeClaims.length });
        continue;
      }
      if (stage === TaskStage.DEPLOYMENT && activeClaims.some((claim) => activeClaimStage(claim) === TaskStage.DEPLOYMENT && claim.taskKey !== task.key)) {
        backpressure.push({ taskKey: task.key, reason: 'deployment-serialized', stage });
        continue;
      }
      if (packet.packetKey && activeClaims.some((claim) => claim.packetKey === packet.packetKey && claim.taskKey !== task.key)) {
        backpressure.push({ taskKey: task.key, reason: 'work-packet-active', stage, packetKey: packet.packetKey });
        continue;
      }
      const repoLimit = this.repoLaneLimits[repo] ?? this.repoLaneLimit;
      if ((repoUsage.get(repo) ?? 0) >= repoLimit) {
        backpressure.push({ taskKey: task.key, reason: 'repository-wip-limit', stage, repository: task.repository, limit: repoLimit });
        continue;
      }
      const taskClass = task.taskClass ?? 'standard';
      const language = task.requirements?.language ?? task.metadata?.language ?? 'any';
      const eligible = workers
        .filter((worker) => (workerSlots.get(worker.workerId) ?? 0) > 0 && requirementMatch(worker, task))
        .map((worker) => {
          const suitability = workerSuitability({ ...worker, capacity: { ...worker.capacity, freeSlots: workerSlots.get(worker.workerId) } }, task);
          const learned = this.performanceLedger?.stats(worker.workerId, taskClass, language) ?? null;
          return { worker, suitability: { ...suitability, baseScore: suitability.score, learnedSpecializationScore: learned?.specializationScore ?? 0, predictedDurationMs: learned?.predictedDurationMs ?? null, learnedRuns: learned?.runs ?? 0, score: suitability.score + (learned?.specializationScore ?? 0) } };
        })
        .sort((a, b) => b.suitability.score - a.suitability.score || a.worker.workerId.localeCompare(b.worker.workerId));
      const selected = eligible[0];
      if (!selected) {
        backpressure.push({ taskKey: task.key, reason: 'no-eligible-worker', stage, requirements: task.requirements ?? {} });
        continue;
      }
      const worker = selected.worker;
      workerSlots.set(worker.workerId, workerSlots.get(worker.workerId) - 1);
      repoUsage.set(repo, (repoUsage.get(repo) ?? 0) + 1);
      activeClaims = [...activeClaims, { taskKey: task.key, repository: task.repository, product: task.product, workerId: worker.workerId, packetKey: packet.packetKey, stage }];
      dispatches.push({
        taskKey: task.key,
        repository: task.repository,
        product: task.product,
        workerId: worker.workerId,
        score: scoring.score,
        workPacket: packet.contract,
        explanation: {
          stage,
          workPacketKey: packet.packetKey,
          workPacketBranch: packet.contract?.branch ?? null,
          workPacketBaseCommit: packet.contract?.baseCommit ?? null,
          priority: scoring.priority,
          policyPriorityAdjustment: scoring.priorityAdjustment,
          deadlineUrgency: policy.deadlineUrgency ?? 0,
          priorityOverride: policy.override ?? null,
          dependencyUnlocks: scoring.unlock,
          criticalDepth: scoring.criticalDepth,
          criticalPathScore: scoring.criticalPathScore,
          starvationSteps: scoring.starvationSteps,
          riskPenalty: scoring.riskPenalty,
          failurePenalty: scoring.failurePenalty,
          fairnessPenalty: scoring.fairness.total,
          workerSuitability: selected.suitability,
          workerFreeSlotsBefore: workerSlots.get(worker.workerId) + 1,
          workerCpuPct: worker.pressure?.cpuPct ?? 0,
          workerMemoryPct: worker.pressure?.memoryPct ?? 0,
          adaptiveLaneLimit: adaptiveLimit,
          repositoryLaneLimit: repoLimit,
          blockedStages: [...(admissionDecision.blockedStages ?? [])]
        }
      });
    }
    const rebalancing = rebalanceRecommendations({ workers, activeClaims, backpressure });
    const audit = buildDispatchAudit({ now, workers, activeClaims: originalClaims, dispatches, backpressure, adaptiveLimit, remainingLaneBudget, rebalancing });
    return { dispatches, backpressure, adaptiveLimit, remainingLaneBudget, rebalancing, audit };
  }
}
