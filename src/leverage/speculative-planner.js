export class SpeculativePlanner {
  constructor({ maxCandidates = 4, noveltyThreshold = 0.6, highRiskCandidates = 3 } = {}) {
    this.maxCandidates = Math.max(1, Number(maxCandidates));
    this.noveltyThreshold = Math.max(0, Math.min(1, Number(noveltyThreshold)));
    this.highRiskCandidates = Math.max(1, Number(highRiskCandidates));
  }

  plan({ novelty = 0, riskClass = 'normal', expectedValue = 1, availableSlots = 1, verifierCapacity = 1 } = {}) {
    const noveltyScore = Math.max(0, Math.min(1, Number(novelty)));
    let desired = 1;
    if (noveltyScore >= this.noveltyThreshold) desired = 2;
    if (['high','critical'].includes(riskClass)) desired = Math.max(desired, this.highRiskCandidates);
    if (Number(expectedValue) >= 10) desired += 1;
    const candidates = Math.max(1, Math.min(this.maxCandidates, desired, Math.max(1, Number(availableSlots)), Math.max(1, Number(verifierCapacity))));
    return { candidates, desired, speculative: candidates > 1, reasons: [noveltyScore >= this.noveltyThreshold ? 'novel-task' : null, ['high','critical'].includes(riskClass) ? 'risk-class' : null, Number(expectedValue) >= 10 ? 'high-value' : null].filter(Boolean) };
  }
}
