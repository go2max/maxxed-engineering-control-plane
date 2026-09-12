export class LocalInferenceClient {
  constructor({ baseUrl = 'http://127.0.0.1:8080', fetchImpl = fetch } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetch = fetchImpl;
  }

  async generate({ model, messages, temperature = 0, maxTokens = 2048, signal } = {}) {
    if (!model) throw new Error('model is required');
    if (!Array.isArray(messages) || !messages.length) throw new Error('messages are required');
    const response = await this.fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream: false }),
      signal
    });
    let body;
    try { body = await response.json(); } catch { body = null; }
    if (!response.ok) throw new Error(body?.error?.message ?? body?.error ?? `local inference failed: ${response.status}`);
    return {
      text: body?.choices?.[0]?.message?.content ?? '',
      usage: body?.usage ?? null,
      raw: body
    };
  }

  async health() {
    try {
      const response = await this.fetch(`${this.baseUrl}/health`, { headers: { accept: 'application/json' } });
      return response.ok;
    } catch {
      return false;
    }
  }
}
