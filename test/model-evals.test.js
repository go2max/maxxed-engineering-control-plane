import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelRegistry } from '../src/models/model-registry.js';
import { ModelRouter } from '../src/models/model-router.js';
import { ModelEvalLedger, modelManifestDigest } from '../src/models/model-evals.js';

test('model manifest digest is deterministic across capability order', () => {
  const a = modelManifestDigest({ id: 'm', family: 'qwen', artifactSha256: 'abc', capabilities: ['code', 'reasoning'], contextWindow: 32000 });
  const b = modelManifestDigest({ id: 'm', family: 'qwen', artifactSha256: 'abc', capabilities: ['reasoning', 'code'], contextWindow: 32000 });
  assert.equal(a, b);
});

test('poor acceptance rate demotes model after minimum evidence', () => {
  const ledger = new ModelEvalLedger();
  for (let i = 0; i < 5; i += 1) ledger.record({ modelId: 'bad', taskClass: 'code', accepted: i === 0 });
  const health = ledger.healthRecommendation('bad', 'code', { minRuns: 5, minAcceptanceRate: 0.6 });
  assert.equal(health.healthy, false);
});

test('router chooses higher-acceptance local model and exposes fallback order', () => {
  const registry = new ModelRegistry();
  registry.register({ id: 'a', kind: 'local', capabilities: ['code'], contextWindow: 32000, priority: 10 });
  registry.register({ id: 'b', kind: 'local', capabilities: ['code'], contextWindow: 32000, priority: 10 });
  const ledger = new ModelEvalLedger();
  for (let i = 0; i < 5; i += 1) ledger.record({ modelId: 'a', taskClass: 'code', accepted: true, latencyMs: 200 });
  for (let i = 0; i < 4; i += 1) ledger.record({ modelId: 'b', taskClass: 'code', accepted: true, latencyMs: 100 });
  ledger.record({ modelId: 'b', taskClass: 'code', accepted: false, latencyMs: 100 });
  const result = new ModelRouter({ registry, evalLedger: ledger }).route({ capabilities: ['code'], taskClass: 'code' });
  assert.equal(result.model.id, 'a');
  assert.deepEqual(result.fallbackModels, ['b']);
});
