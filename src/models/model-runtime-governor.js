export class ModelRuntimeGovernor {
  constructor({ failureThreshold = 3, cooldownMs = 60_000 } = {}) {
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.state = new Map();
  }

  register(model) {
    const maxConcurrency = Math.max(1, Number(model?.metadata?.maxConcurrency ?? 1));
    const artifactSha256 = model?.metadata?.artifactSha256 ?? null;
    if (artifactSha256 && !/^[a-f0-9]{64}$/i.test(artifactSha256)) throw new Error(`invalid artifact sha256 for ${model.id}`);
    if (!this.state.has(model.id)) {
      this.state.set(model.id, { modelId: model.id, maxConcurrency, inFlight: 0, consecutiveFailures: 0, circuitOpenUntil: 0, warm: false, lastHealthAt: null, lastHealthOk: null, artifactSha256 });
    }
    return this.get(model.id);
  }

  healthResult(modelId, healthy, now = Date.now()) {
    const value = this.#require(modelId);
    value.lastHealthAt = now;
    value.lastHealthOk = Boolean(healthy);
    if (healthy) {
      value.warm = true;
      value.consecutiveFailures = 0;
      value.circuitOpenUntil = 0;
    } else {
      this.recordFailure(modelId, now);
    }
    return this.get(modelId);
  }

  isAdmissible(modelId, now = Date.now()) {
    const value = this.#require(modelId);
    if (value.circuitOpenUntil > now) return false;
    return value.inFlight < value.maxConcurrency;
  }

  acquire(modelId, now = Date.now()) {
    const value = this.#require(modelId);
    if (!this.isAdmissible(modelId, now)) return false;
    value.inFlight += 1;
    return true;
  }

  release(modelId) {
    const value = this.#require(modelId);
    value.inFlight = Math.max(0, value.inFlight - 1);
  }

  recordSuccess(modelId) {
    const value = this.#require(modelId);
    value.consecutiveFailures = 0;
    value.circuitOpenUntil = 0;
    value.warm = true;
  }

  recordFailure(modelId, now = Date.now()) {
    const value = this.#require(modelId);
    value.consecutiveFailures += 1;
    if (value.consecutiveFailures >= this.failureThreshold) value.circuitOpenUntil = now + this.cooldownMs;
  }

  availableSlots(modelId, now = Date.now()) {
    const value = this.#require(modelId);
    if (value.circuitOpenUntil > now) return 0;
    return Math.max(0, value.maxConcurrency - value.inFlight);
  }

  get(modelId) { const value = this.state.get(modelId); return value ? structuredClone(value) : null; }
  list() { return [...this.state.values()].map((value) => structuredClone(value)); }

  #require(modelId) {
    const value = this.state.get(modelId);
    if (!value) throw new Error(`model runtime is not registered: ${modelId}`);
    return value;
  }
}

export class LocalModelExecutionPool {
  constructor({ registry, router, governor, clientFactory } = {}) {
    if (!registry || !router || !governor || !clientFactory) throw new Error('registry, router, governor and clientFactory are required');
    this.registry = registry;
    this.router = router;
    this.governor = governor;
    this.clientFactory = clientFactory;
  }

  async execute(request, payload, { now = Date.now() } = {}) {
    const route = this.router.route(request);
    const ordered = [route.model?.id, ...(route.fallbackModels ?? [])].filter(Boolean);
    const attempts = [];

    for (const modelId of ordered) {
      const model = this.registry.get(modelId);
      if (!model || model.kind !== 'local') continue;
      if (!this.governor.get(modelId)) this.governor.register(model);
      if (!this.governor.acquire(modelId, now)) {
        attempts.push({ modelId, outcome: 'not-admissible' });
        continue;
      }
      try {
        const client = this.clientFactory(model);
        const result = await client.generate({ model: model.id, ...payload });
        this.governor.recordSuccess(modelId);
        attempts.push({ modelId, outcome: 'success' });
        return { model, result, attempts, route };
      } catch (error) {
        this.governor.recordFailure(modelId, now);
        attempts.push({ modelId, outcome: 'failure', error: error.message });
      } finally {
        this.governor.release(modelId);
      }
    }

    const error = new Error('all eligible local models failed or were unavailable');
    error.attempts = attempts;
    throw error;
  }
}
