export class ModelRouter {
  constructor({ registry, allowExternalEscalation = false } = {}) {
    if (!registry) throw new Error('registry is required');
    this.registry = registry;
    this.allowExternalEscalation = allowExternalEscalation;
  }

  route(request) {
    const required = new Set(request.capabilities ?? []);
    const minContext = Number(request.minContextWindow ?? 0);
    const maxCost = request.maxCostPerMillionTokens ?? 0;

    const candidates = this.registry.list().filter((model) => {
      if (!model.enabled || !model.healthy) return false;
      if (!this.allowExternalEscalation && model.kind !== 'local') return false;
      if (model.contextWindow < minContext) return false;
      if ([...required].some((capability) => !model.capabilities.includes(capability))) return false;
      const blendedCost = model.costPerMillionInputTokens + model.costPerMillionOutputTokens;
      if (maxCost >= 0 && blendedCost > maxCost) return false;
      return true;
    }).sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'local' ? -1 : 1;
      if (b.priority !== a.priority) return b.priority - a.priority;
      const aCost = a.costPerMillionInputTokens + a.costPerMillionOutputTokens;
      const bCost = b.costPerMillionInputTokens + b.costPerMillionOutputTokens;
      if (aCost !== bCost) return aCost - bCost;
      return b.contextWindow - a.contextWindow;
    });

    const model = candidates[0] ?? null;
    return {
      model,
      explanation: model ? {
        selected: model.id,
        local: model.kind === 'local',
        requiredCapabilities: [...required],
        minContextWindow: minContext,
        externalEscalationAllowed: this.allowExternalEscalation
      } : {
        selected: null,
        requiredCapabilities: [...required],
        minContextWindow: minContext,
        externalEscalationAllowed: this.allowExternalEscalation,
        reason: 'no healthy eligible model'
      }
    };
  }
}
