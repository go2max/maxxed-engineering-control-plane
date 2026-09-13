export class SpeculativePlanner {
  constructor({ maxCandidates = 4, noveltyThreshold = 0.6, highRiskCandidates = 3, minValueToCostRatio = 3 } = {}) {
    this.maxCandidates = Math.max(1, Number(maxCandidates));
    this.noveltyThreshold = Math.max(0, Math.min(1, Number(noveltyThreshold)));
    this.highRiskCandidates = Math.max(1, Number(highRiskCandidates));
    this.minValueToCostRatio = Math.max(0, Number(minValueToCostRatio));
  }

  plan({ novelty = 0, riskClass = 'normal', expectedValue = 1, availableSlots = 1, verifierCapacity = 1, estimatedCandidateCost = 1, remainingBudget = Infinity, currentSpeculativeSpend = 0 } = {}) {
    const noveltyScore = Math.max(0, Math.min(1, Number(novelty)));
    const cost = Math.max(0.000001, Number(estimatedCandidateCost));
    const value = Math.max(0, Number(expectedValue));
    const budgetRemaining = Number.isFinite(Number(remainingBudget)) ? Math.max(0, Number(remainingBudget) - Number(currentSpeculativeSpend || 0)) : Infinity;
    const valueToCost = value / cost;
    let desired = 1;
    if (noveltyScore >= this.noveltyThreshold) desired = 2;
    if (['high','critical'].includes(String(riskClass).toLowerCase())) desired = Math.max(desired, this.highRiskCandidates);
    if (value >= 10) desired += 1;
    if (valueToCost < this.minValueToCostRatio) desired = 1;
    const affordable = Number.isFinite(budgetRemaining) ? Math.max(1, Math.floor(budgetRemaining / cost)) : this.maxCandidates;
    const candidates = Math.max(1, Math.min(this.maxCandidates, desired, Math.max(1, Number(availableSlots)), Math.max(1, Number(verifierCapacity)), affordable));
    const reasons = [
      noveltyScore >= this.noveltyThreshold ? 'novel-task' : null,
      ['high','critical'].includes(String(riskClass).toLowerCase()) ? 'risk-class' : null,
      value >= 10 ? 'high-value' : null,
      valueToCost < this.minValueToCostRatio ? 'value-cost-gate' : null,
      affordable < desired ? 'budget-cap' : null
    ].filter(Boolean);
    return { candidates, desired, speculative: candidates > 1, reasons, budget: { estimatedCandidateCost: cost, budgetRemaining, affordableCandidates: affordable, valueToCost, minValueToCostRatio: this.minValueToCostRatio } };
  }
}
