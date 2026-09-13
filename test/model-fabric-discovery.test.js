import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelRegistry } from '../src/models/model-registry.js';
import { ModelRuntimeGovernor } from '../src/models/model-runtime-governor.js';
import { ModelFabricDiscovery, assertRequestWithinModelBudget } from '../src/models/model-fabric-discovery.js';

test('online worker model is discovered and offline disappearance disables it', () => {
  const registry = new ModelRegistry();
  const governor = new ModelRuntimeGovernor();
  const discovery = new ModelFabricDiscovery({ registry, governor });
  const workers = [{
    workerId: 'ai-1', state: 'AVAILABLE',
    metadata: { localModels: [{ id: 'coder', endpoint: 'http://127.0.0.1:8080', contextWindow: 8192, maxOutputTokens: 2048, capabilities: ['coding'], maxConcurrency: 2 }] }
  }];
  const first = discovery.reconcile(workers);
  assert.equal(first.discovered[0].modelId, 'coder');
  assert.equal(registry.get('coder').enabled, true);
  const second = discovery.reconcile([]);
  assert.deepEqual(second.disabled, ['coder']);
  assert.equal(registry.get('coder').enabled, false);
  assert.equal(registry.get('coder').healthy, false);
});

test('request budget fails closed on context or output overflow', () => {
  const model = { id: 'small', contextWindow: 100, maxOutputTokens: 20 };
  assert.throws(() => assertRequestWithinModelBudget(model, { messages: [{ content: 'x'.repeat(400) }], maxTokens: 10 }), /context window/);
  assert.throws(() => assertRequestWithinModelBudget(model, { messages: [{ content: 'ok' }], maxTokens: 21 }), /maxOutputTokens/);
  const accepted = assertRequestWithinModelBudget(model, { messages: [{ content: 'abcd' }], maxTokens: 20 });
  assert.equal(accepted.totalTokens, 21);
});
