export class SchedulerPolicy {
  constructor({ maxPriorityAdjustment = 50 } = {}) {
    this.maxPriorityAdjustment = maxPriorityAdjustment;
    this.frozenRepositories = new Map();
    this.drainingRepositories = new Map();
    this.priorityOverrides = new Map();
  }

  freezeRepository(repository, reason = 'operator-freeze') {
    if (!repository) throw new Error('repository is required');
    this.frozenRepositories.set(repository, { reason });
  }

  thawRepository(repository) { return this.frozenRepositories.delete(repository); }

  drainRepository(repository, reason = 'operator-drain') {
    if (!repository) throw new Error('repository is required');
    this.drainingRepositories.set(repository, { reason });
  }

  resumeRepository(repository) { return this.drainingRepositories.delete(repository); }

  setPriorityOverride({ taskKey, adjustment, reason, expiresAt = null } = {}) {
    if (!taskKey) throw new Error('taskKey is required');
    if (!Number.isFinite(adjustment) || Math.abs(adjustment) > this.maxPriorityAdjustment) {
      throw new Error(`priority adjustment must be within +/-${this.maxPriorityAdjustment}`);
    }
    if (!reason) throw new Error('priority override reason is required');
    this.priorityOverrides.set(taskKey, { adjustment, reason, expiresAt });
  }

  clearPriorityOverride(taskKey) { return this.priorityOverrides.delete(taskKey); }

  evaluate(task, now = Date.now()) {
    const repo = task.repository ?? null;
    if (repo && this.frozenRepositories.has(repo)) return { allowed: false, reason: 'repository-frozen', priorityAdjustment: 0 };
    if (repo && this.drainingRepositories.has(repo)) return { allowed: false, reason: 'repository-draining', priorityAdjustment: 0 };

    let priorityAdjustment = 0;
    let deadlineUrgency = 0;
    const deadline = Number(task.metadata?.deadlineAt ?? 0);
    if (deadline > 0) {
      const remainingMs = deadline - now;
      if (remainingMs <= 0) deadlineUrgency = 50;
      else if (remainingMs <= 60 * 60_000) deadlineUrgency = 35;
      else if (remainingMs <= 4 * 60 * 60_000) deadlineUrgency = 20;
      else if (remainingMs <= 24 * 60 * 60_000) deadlineUrgency = 10;
      priorityAdjustment += deadlineUrgency;
    }

    const override = this.priorityOverrides.get(task.key);
    if (override) {
      if (override.expiresAt && Number(override.expiresAt) <= now) this.priorityOverrides.delete(task.key);
      else priorityAdjustment += override.adjustment;
    }

    return { allowed: true, reason: null, priorityAdjustment, deadlineUrgency, override: this.priorityOverrides.get(task.key) ?? null };
  }

  snapshot() {
    return {
      version: 1,
      maxPriorityAdjustment: this.maxPriorityAdjustment,
      frozenRepositories: [...this.frozenRepositories.entries()],
      drainingRepositories: [...this.drainingRepositories.entries()],
      priorityOverrides: [...this.priorityOverrides.entries()]
    };
  }

  restore(snapshot) {
    if (!snapshot || snapshot.version !== 1) throw new Error('unsupported scheduler policy snapshot');
    this.maxPriorityAdjustment = Number(snapshot.maxPriorityAdjustment ?? this.maxPriorityAdjustment);
    this.frozenRepositories = new Map(snapshot.frozenRepositories ?? []);
    this.drainingRepositories = new Map(snapshot.drainingRepositories ?? []);
    this.priorityOverrides = new Map(snapshot.priorityOverrides ?? []);
  }

  status() {
    return {
      frozenRepositories: [...this.frozenRepositories.entries()].map(([repository, value]) => ({ repository, ...value })),
      drainingRepositories: [...this.drainingRepositories.entries()].map(([repository, value]) => ({ repository, ...value })),
      priorityOverrides: [...this.priorityOverrides.entries()].map(([taskKey, value]) => ({ taskKey, ...value }))
    };
  }
}

export function rebalanceRecommendations({ workers = [], activeClaims = [], backpressure = [] } = {}) {
  const productive = workers.filter((worker) => ['AVAILABLE', 'BUSY'].includes(worker.state));
  const freeSlots = productive.reduce((sum, worker) => sum + Number(worker.capacity?.freeSlots ?? 0), 0);
  const repoCounts = new Map();
  for (const claim of activeClaims) {
    if (!claim.repository) continue;
    repoCounts.set(claim.repository, (repoCounts.get(claim.repository) ?? 0) + 1);
  }
  const maxRepo = [...repoCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const recommendations = [];
  if (freeSlots > 0 && backpressure.some((item) => item.reason === 'repository-wip-limit')) recommendations.push({ action: 'redistribute-free-capacity', freeSlots });
  if (maxRepo && activeClaims.length >= 4 && maxRepo[1] / activeClaims.length > 0.6) recommendations.push({ action: 'reduce-repository-concentration', repository: maxRepo[0], share: maxRepo[1] / activeClaims.length });
  if (freeSlots === 0 && backpressure.some((item) => item.reason === 'global-lane-capacity')) recommendations.push({ action: 'capacity-saturated' });
  return recommendations;
}
