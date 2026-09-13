import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlPlaneRuntime } from '../src/service/control-plane-runtime.js';

function createRuntime() {
  return new ControlPlaneRuntime({
    modelDefinitions: [
      { id: 'm1', kind: 'local', endpoint: 'http://127.0.0.1:8080', capabilities: ['code'], contextWindow: 8192, metadata: { maxConcurrency: 1 } },
      { id: 'm2', kind: 'local', endpoint: 'http://127.0.0.1:8081', capabilities: ['code'], contextWindow: 8192, metadata: { maxConcurrency: 1 } }
    ],
    modelClientFactory: (model) => ({
      health: async () => true,
      generate: async () => {
        if (model.id === 'm1') throw new Error('primary failed');
        return { text: 'ok', usage: null };
      }
    })
  });
}

test('runtime warms local models and exposes admission state', async () => {
  const runtime = createRuntime();
  const warmed = await runtime.warmupModels(1000);
  assert.equal(warmed.length, 2);
  assert.ok(warmed.every((entry) => entry.healthy));
  assert.equal(runtime.status().models.runtime.length, 2);
});

test('runtime executes with local-to-local failover and records eval history', async () => {
  const runtime = createRuntime();
  const result = await runtime.executeModel({
    request: { capabilities: ['code'], taskClass: 'coding' },
    messages: [{ role: 'user', content: 'fix it' }],
    now: 1000
  });
  assert.equal(result.model.id, 'm2');
  const evals = runtime.status().models.evals;
  assert.ok(evals.some((entry) => entry.modelId === 'm2' && entry.accepted === 1));
});

test('model runtime and eval state persist across restart without in-flight leakage', async () => {
  const first = createRuntime();
  await first.warmupModels(1000);
  await first.executeModel({ request: { capabilities: ['code'], taskClass: 'coding' }, messages: [{ role: 'user', content: 'x' }], now: 1001 });
  const snapshot = first.snapshot();

  const second = createRuntime();
  second.restore(snapshot, 2000);
  assert.equal(second.status().models.runtime.length, 2);
  assert.ok(second.status().models.runtime.every((entry) => entry.inFlight === 0));
  assert.ok(second.status().models.evals.some((entry) => entry.taskClass === 'coding'));
});
