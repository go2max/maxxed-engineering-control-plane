import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelRegistry } from '../src/models/model-registry.js';
import { ModelRouter } from '../src/models/model-router.js';
import { LocalInferenceClient } from '../src/models/local-inference-client.js';

test('router prefers healthy local zero-cost capable model and blocks external by default', () => {
  const registry = new ModelRegistry();
  registry.register({ id: 'local-small', kind: 'local', capabilities: ['code'], contextWindow: 16000, priority: 10 });
  registry.register({ id: 'external-large', kind: 'external', capabilities: ['code'], contextWindow: 128000, priority: 100, costPerMillionInputTokens: 1 });
  const router = new ModelRouter({ registry });
  assert.equal(router.route({ capabilities: ['code'], minContextWindow: 8000 }).model.id, 'local-small');
});

test('router fails closed when only external model qualifies and escalation is disabled', () => {
  const registry = new ModelRegistry();
  registry.register({ id: 'external', kind: 'external', capabilities: ['reasoning'], contextWindow: 128000, priority: 100 });
  const router = new ModelRouter({ registry });
  assert.equal(router.route({ capabilities: ['reasoning'] }).model, null);
});

test('unhealthy models are excluded', () => {
  const registry = new ModelRegistry();
  registry.register({ id: 'local', kind: 'local', capabilities: ['code'], contextWindow: 32000 });
  registry.setHealth('local', false);
  assert.equal(new ModelRouter({ registry }).route({ capabilities: ['code'] }).model, null);
});

test('local inference client speaks OpenAI-compatible chat shape', async () => {
  let request;
  const client = new LocalInferenceClient({ fetchImpl: async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }], usage: { total_tokens: 3 } }) };
  }});
  const result = await client.generate({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(result.text, 'ok');
  assert.match(request.url, /\/v1\/chat\/completions$/);
});
