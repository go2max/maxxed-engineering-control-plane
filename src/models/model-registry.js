import { isValidTier, EscalationTier } from './cognition-classes.js';

// A model that declares no explicit tier is assumed cheap-model if it runs locally (cost is
// near-zero and it should never be treated as scarce), and strong-model if it is external
// (external models are assumed more capable but non-free until proven otherwise). Nothing is
// ever defaulted into the frontier tier: that classification must be explicit, since it
// changes cost-justification gating.
function defaultTier(kind) {
  return kind === 'local' ? EscalationTier.CHEAP_MODEL : EscalationTier.STRONG_MODEL;
}

export class ModelRegistry {
  #models = new Map();

  register(input) {
    if (!input?.id) throw new Error('model id is required');
    const tier = input.tier ?? defaultTier(input.kind ?? 'local');
    if (!isValidTier(tier)) throw new Error(`unknown escalation tier: ${tier}`);
    const model = {
      id: input.id,
      kind: input.kind ?? 'local',
      endpoint: input.endpoint ?? null,
      capabilities: [...new Set(input.capabilities ?? [])],
      contextWindow: Number(input.contextWindow ?? 0),
      maxOutputTokens: Number(input.maxOutputTokens ?? 0),
      healthy: input.healthy !== false,
      enabled: input.enabled !== false,
      priority: Number(input.priority ?? 0),
      costPerMillionInputTokens: Number(input.costPerMillionInputTokens ?? 0),
      costPerMillionOutputTokens: Number(input.costPerMillionOutputTokens ?? 0),
      tier,
      metadata: input.metadata ?? {}
    };
    this.#models.set(model.id, model);
    return this.get(model.id);
  }

  setHealth(id, healthy) {
    const model = this.#models.get(id);
    if (!model) throw new Error(`unknown model: ${id}`);
    model.healthy = Boolean(healthy);
    return this.get(id);
  }

  get(id) {
    const model = this.#models.get(id);
    return model ? structuredClone(model) : null;
  }

  list() {
    return [...this.#models.values()].map((model) => structuredClone(model));
  }
}
