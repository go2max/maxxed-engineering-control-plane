import { EscalationTier, defaultTierForCognitionClass, isValidTier, tierRank } from './cognition-classes.js';

// Tiers at or above this rank are treated as scarce/expensive: a candidate at this tier is
// only eligible when the caller has supplied (or the request implies) an explicit cost
// justification, so frontier reasoning is never selected merely because it is available.
const COST_JUSTIFICATION_REQUIRED_FROM = tierRank(EscalationTier.FRONTIER);

function costJustified(request) {
  // A frontier-tier candidate is justified when the caller states an expected accepted-value
  // gain (e.g. lower-tier attempts already failed verification, or the task is flagged as
  // high-novelty/architectural), or explicitly forces the tier. Silence is not justification.
  if (request.forceMinTier && tierRank(request.forceMinTier) >= COST_JUSTIFICATION_REQUIRED_FROM) return true;
  if (Number(request.lowerTierAttempts ?? 0) > 0) return true;
  if (request.costJustification) return true;
  return false;
}

export class ModelRouter {
  constructor({ registry, evalLedger = null, allowExternalEscalation = false } = {}) {
    if (!registry) throw new Error('registry is required');
    this.registry = registry;
    this.evalLedger = evalLedger;
    this.allowExternalEscalation = allowExternalEscalation;
  }

  route(request) {
    const required = new Set(request.capabilities ?? []);
    const minContext = Number(request.minContextWindow ?? 0);
    const maxCost = request.maxCostPerMillionTokens ?? 0;
    const taskClass = request.taskClass ?? 'standard';

    // Escalation ladder: resolve the minimum tier this request is allowed to consider. A
    // request may name a cognitionClass (mapped to its cheapest natural tier) and/or force a
    // floor tier directly (e.g. after cheaper tiers were tried and rejected/failed
    // verification). Mechanical/provable work never reaches the frontier tier unless the
    // caller demonstrates the expected accepted-value gain justifies the cost.
    const cognitionTier = request.cognitionClass ? defaultTierForCognitionClass(request.cognitionClass) : EscalationTier.CHEAP_MODEL;
    let minTier = request.forceMinTier ?? cognitionTier;
    if (!isValidTier(minTier)) throw new Error(`unknown escalation tier: ${minTier}`);
    const minTierRank = tierRank(minTier);
    const justified = costJustified(request);

    const candidates = this.registry.list().filter((model) => {
      if (!model.enabled || !model.healthy) return false;
      if (!this.allowExternalEscalation && model.kind !== 'local') return false;
      if (model.contextWindow < minContext) return false;
      if ([...required].some((capability) => !model.capabilities.includes(capability))) return false;
      const blendedCost = model.costPerMillionInputTokens + model.costPerMillionOutputTokens;
      if (maxCost >= 0 && blendedCost > maxCost) return false;
      if (tierRank(model.tier) < minTierRank) return false;
      if (tierRank(model.tier) >= COST_JUSTIFICATION_REQUIRED_FROM && !justified) return false;
      if (this.evalLedger) {
        const health = this.evalLedger.healthRecommendation(model.id, taskClass);
        if (!health.healthy) return false;
      }
      return true;
    }).sort((a, b) => {
      // Cheapest-correct fallback: prefer the cheapest tier that clears eligibility, then
      // local before external, then observed acceptance/latency, then static tie-breakers.
      if (a.tier !== b.tier) return tierRank(a.tier) - tierRank(b.tier);
      if (a.kind !== b.kind) return a.kind === 'local' ? -1 : 1;
      if (this.evalLedger) {
        const aStats = this.evalLedger.stats(a.id, taskClass);
        const bStats = this.evalLedger.stats(b.id, taskClass);
        const ar = aStats.acceptanceRate ?? -1;
        const br = bStats.acceptanceRate ?? -1;
        if (br !== ar) return br - ar;
        const al = aStats.averageLatencyMs ?? Infinity;
        const bl = bStats.averageLatencyMs ?? Infinity;
        if (al !== bl) return al - bl;
      }
      if (b.priority !== a.priority) return b.priority - a.priority;
      const aCost = a.costPerMillionInputTokens + a.costPerMillionOutputTokens;
      const bCost = b.costPerMillionInputTokens + b.costPerMillionOutputTokens;
      if (aCost !== bCost) return aCost - bCost;
      return b.contextWindow - a.contextWindow;
    });

    const model = candidates[0] ?? null;
    const fallbackModels = candidates.slice(1).map((candidate) => candidate.id);
    return {
      model,
      fallbackModels,
      explanation: model ? {
        selected: model.id,
        selectedTier: model.tier,
        local: model.kind === 'local',
        requiredCapabilities: [...required],
        minContextWindow: minContext,
        minTier,
        costJustified: justified,
        taskClass,
        fallbackModels,
        externalEscalationAllowed: this.allowExternalEscalation
      } : {
        selected: null,
        requiredCapabilities: [...required],
        minContextWindow: minContext,
        minTier,
        costJustified: justified,
        taskClass,
        externalEscalationAllowed: this.allowExternalEscalation,
        reason: 'no healthy eligible model'
      }
    };
  }
}
