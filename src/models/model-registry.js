export class ModelRegistry {
  #models = new Map();

  register(input) {
    if (!input?.id) throw new Error('model id is required');
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
