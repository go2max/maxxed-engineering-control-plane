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

    const candidates = this.registry.list().filter((model) => {
      if (!model.enabled || !model.healthy) return false;
      if (!this.allowExternalEscalation && model.kind !== 'local') return false;
      if (model.contextWindow < minContext) return false;
      if ([...required].some((capability) => !model.capabilities.includes(capability))) return false;
      const blendedCost = model.costPerMillionInputTokens + model.costPerMillionOutputTokens;
      if (maxCost >= 0 && blendedCost > maxCost) return false;
      if (this.evalLedger) {
        const health = this.evalLedger.healthRecommendation(model.id, taskClass);
        if (!health.healthy) return false;
      }
      return true;
    }).sort((a, b) => {
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
        local: model.kind === 'local',
        requiredCapabilities: [...required],
        minContextWindow: minContext,
        taskClass,
        fallbackModels,
        externalEscalationAllowed: this.allowExternalEscalation
      } : {
        selected: null,
        requiredCapabilities: [...required],
        minContextWindow: minContext,
        taskClass,
        externalEscalationAllowed: this.allowExternalEscalation,
        reason: 'no healthy eligible model'
      }
    };
  }
}
