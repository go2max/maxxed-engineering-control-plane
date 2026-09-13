function normalizedModel(worker, advertised) {
  if (!advertised?.id) throw new Error(`worker ${worker.workerId} advertised a model without id`);
  const endpoint = advertised.endpoint ?? worker.metadata?.modelEndpoint ?? null;
  if (!endpoint) throw new Error(`local model ${advertised.id} is missing endpoint`);
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`unsupported local model endpoint protocol: ${url.protocol}`);
  return {
    id: advertised.id,
    kind: 'local',
    endpoint,
    capabilities: advertised.capabilities ?? [],
    contextWindow: Number(advertised.contextWindow ?? 0),
    maxOutputTokens: Number(advertised.maxOutputTokens ?? 0),
    healthy: worker.state === 'AVAILABLE' || worker.state === 'BUSY',
    enabled: worker.state === 'AVAILABLE' || worker.state === 'BUSY',
    priority: Number(advertised.priority ?? 0),
    costPerMillionInputTokens: 0,
    costPerMillionOutputTokens: 0,
    metadata: {
      ...(advertised.metadata ?? {}),
      workerId: worker.workerId,
      hostState: worker.state ?? null,
      artifactSha256: advertised.artifactSha256 ?? advertised.metadata?.artifactSha256 ?? null,
      maxConcurrency: Number(advertised.maxConcurrency ?? advertised.metadata?.maxConcurrency ?? 1),
      discoveredFromFabric: true
    }
  };
}

export class ModelFabricDiscovery {
  constructor({ registry, governor } = {}) {
    if (!registry || !governor) throw new Error('registry and governor are required');
    this.registry = registry;
    this.governor = governor;
    this.fabricModelIds = new Set();
  }

  reconcile(workers = []) {
    const seen = new Set();
    const discovered = [];
    for (const worker of workers) {
      for (const advertised of worker.metadata?.localModels ?? []) {
        const model = normalizedModel(worker, advertised);
        seen.add(model.id);
        this.fabricModelIds.add(model.id);
        const registered = this.registry.register(model);
        if (!this.governor.get(model.id)) this.governor.register(registered);
        discovered.push({ modelId: model.id, workerId: worker.workerId, enabled: registered.enabled, healthy: registered.healthy });
      }
    }

    const disabled = [];
    for (const modelId of this.fabricModelIds) {
      if (seen.has(modelId)) continue;
      const existing = this.registry.get(modelId);
      if (!existing) continue;
      this.registry.register({ ...existing, enabled: false, healthy: false, metadata: { ...existing.metadata, hostState: 'OFFLINE' } });
      disabled.push(modelId);
    }

    return { discovered, disabled, totalAdvertised: seen.size };
  }
}

export function estimateRequestTokens(messages = []) {
  const chars = messages.reduce((sum, message) => sum + String(message?.content ?? '').length, 0);
  return Math.ceil(chars / 4);
}

export function assertRequestWithinModelBudget(model, { messages = [], maxTokens = 2048 } = {}) {
  const inputTokens = estimateRequestTokens(messages);
  const outputTokens = Number(maxTokens ?? 0);
  if (outputTokens < 1) throw new Error('maxTokens must be positive');
  if (model.maxOutputTokens > 0 && outputTokens > model.maxOutputTokens) throw new Error(`requested output exceeds model maxOutputTokens: ${model.id}`);
  if (model.contextWindow > 0 && inputTokens + outputTokens > model.contextWindow) throw new Error(`request exceeds model context window: ${model.id}`);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}
