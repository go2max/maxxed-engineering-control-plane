import { TaskStage } from './task-stage.js';

export class ThroughputGovernor {
  constructor({ baselineConcurrency = 2, targetMultiplier = 2, maxConcurrency = 16, maxVerifierBacklog = 8, maxFailureRate = 0.2 } = {}) {
    this.baselineConcurrency = Math.max(1, Number(baselineConcurrency));
    this.targetMultiplier = Math.max(1, Number(targetMultiplier));
    this.maxConcurrency = Math.max(1, Number(maxConcurrency));
    this.maxVerifierBacklog = Math.max(0, Number(maxVerifierBacklog));
    this.maxFailureRate = Math.max(0, Math.min(1, Number(maxFailureRate)));
  }

  target({ availableCapacity = 0, verifierBacklog = 0, recentAccepted = 0, recentFailed = 0, degraded = false } = {}) {
    const totalRecent = Math.max(0, Number(recentAccepted)) + Math.max(0, Number(recentFailed));
    const failureRate = totalRecent ? Number(recentFailed) / totalRecent : 0;
    const desired = Math.min(this.maxConcurrency, Math.ceil(this.baselineConcurrency * this.targetMultiplier));
    const reasons = [];
    const blockedStages = [];
    let allowed = desired;
    if (degraded) { allowed = Math.min(allowed, this.baselineConcurrency); reasons.push('runtime-degraded'); }
    if (Number(verifierBacklog) > this.maxVerifierBacklog) {
      blockedStages.push(TaskStage.IMPLEMENTATION);
      reasons.push('verifier-backlog');
    }
    if (failureRate > this.maxFailureRate) { allowed = Math.min(allowed, this.baselineConcurrency); reasons.push('failure-rate'); }
    allowed = Math.max(0, Math.min(allowed, Number(availableCapacity)));
    return {
      baselineConcurrency: this.baselineConcurrency,
      targetMultiplier: this.targetMultiplier,
      desiredConcurrency: desired,
      allowedConcurrency: allowed,
      availableCapacity: Number(availableCapacity),
      verifierBacklog: Number(verifierBacklog),
      failureRate,
      blockedStages,
      implementationAdmissionOpen: !blockedStages.includes(TaskStage.IMPLEMENTATION),
      throttled: allowed < Math.min(desired, Number(availableCapacity)) || blockedStages.length > 0,
      reasons
    };
  }
}
