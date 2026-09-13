import { EngineeringTraceLedger, TraceDisposition } from '../telemetry/engineering-trace.js';

export class LocalInferenceClient {
  constructor({ baseUrl = 'http://127.0.0.1:8080', fetchImpl = fetch, telemetry = new EngineeringTraceLedger(), now = () => Date.now() } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetch = fetchImpl;
    this.telemetry = telemetry;
    this.now = now;
  }

  async generate({ model, messages, temperature = 0, maxTokens = 2048, signal, telemetry = {} } = {}) {
    if (!model) throw new Error('model is required');
    if (!Array.isArray(messages) || !messages.length) throw new Error('messages are required');
    const startedAt = this.now();
    let response;
    let body;
    try {
      response = await this.fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream: false }), signal
      });
      try { body = await response.json(); } catch { body = null; }
      const completedAt = this.now();
      const ok = Boolean(response.ok);
      this.telemetry?.record({
        name: 'model.inference', lane: telemetry.lane ?? 'model', stage: 'inference', traceId: telemetry.traceId, parentSpanId: telemetry.spanId ?? telemetry.parentSpanId ?? null,
        taskKey: telemetry.taskKey ?? null, repository: telemetry.repository ?? null, workerId: telemetry.workerId ?? null, machineId: telemetry.machineId ?? null,
        agentId: telemetry.agentId ?? null, model, provider: telemetry.provider ?? 'local', startedAt, firstOutputAt: completedAt, completedAt,
        outcome: ok ? 'SUCCEEDED' : 'FAILED', disposition: ok ? TraceDisposition.PRODUCTIVE : TraceDisposition.FAILED, usage: body?.usage ?? null,
        attributes: { endpoint: this.baseUrl, messageCount: messages.length, maxTokens, temperature, httpStatus: response.status }
      });
      if (!ok) throw new Error(body?.error?.message ?? body?.error ?? `local inference failed: ${response.status}`);
      return { text: body?.choices?.[0]?.message?.content ?? '', usage: body?.usage ?? null, raw: body, telemetry: { startedAt, completedAt } };
    } catch (error) {
      if (!response) {
        const completedAt = this.now();
        this.telemetry?.record({ name: 'model.inference', lane: telemetry.lane ?? 'model', stage: 'inference', traceId: telemetry.traceId, parentSpanId: telemetry.spanId ?? telemetry.parentSpanId ?? null, taskKey: telemetry.taskKey ?? null, repository: telemetry.repository ?? null, model, provider: telemetry.provider ?? 'local', startedAt, completedAt, outcome: 'FAILED', disposition: TraceDisposition.FAILED, attributes: { endpoint: this.baseUrl, error: error?.name ?? 'Error' } });
      }
      throw error;
    }
  }

  async health() {
    try { const response = await this.fetch(`${this.baseUrl}/health`, { headers: { accept: 'application/json' } }); return response.ok; }
    catch { return false; }
  }
}
