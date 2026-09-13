import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelRegistry } from '../src/models/model-registry.js';
import { ModelRouter } from '../src/models/model-router.js';
import { ModelRuntimeGovernor, LocalModelExecutionPool } from '../src/models/model-runtime-governor.js';

test('artifact checksum mismatch blocks model admission', () => {
  const governor = new ModelRuntimeGovernor();
  governor.register({ id: 'm1', metadata: { artifactSha256: 'a'.repeat(64), maxConcurrency: 1 } });
  assert.equal(governor.verifyArtifactIntegrity('m1', 'b'.repeat(64)), false);
  assert.equal(governor.isAdmissible('m1'), false);
});

test('concurrency budget prevents oversubscription', () => {
  const governor = new ModelRuntimeGovernor();
  governor.register({ id: 'm1', metadata: { maxConcurrency: 1 } });
  assert.equal(governor.acquire('m1', 0), true);
  assert.equal(governor.acquire('m1', 0), false);
  governor.release('m1');
  assert.equal(governor.acquire('m1', 0), true);
});

test('failure threshold opens local circuit until cooldown', () => {
  const governor = new ModelRuntimeGovernor({ failureThreshold: 2, cooldownMs: 100 });
  governor.register({ id: 'm1', metadata: {} });
  governor.recordFailure('m1', 0);
  governor.recordFailure('m1', 1);
  assert.equal(governor.isAdmissible('m1', 50), false);
  assert.equal(governor.isAdmissible('m1', 101), true);
});

test('warmup probes local model health', async () => {
  const registry = new ModelRegistry();
  registry.register({ id: 'm1', kind: 'local', capabilities: ['code'], contextWindow: 8192 });
  const governor = new ModelRuntimeGovernor();
  const results = await governor.warmupAll(registry, () => ({ health: async () => true }), 1000);
  assert.equal(results[0].healthy, true);
  assert.equal(governor.get('m1').warm, true);
});

test('execution pool fails over between local models only', async () => {
  const registry = new ModelRegistry();
  registry.register({ id: 'm1', kind: 'local', capabilities: ['code'], contextWindow: 8192, priority: 20, metadata: { maxConcurrency: 1 } });
  registry.register({ id: 'm2', kind: 'local', capabilities: ['code'], contextWindow: 8192, priority: 10, metadata: { maxConcurrency: 1 } });
  const router = new ModelRouter({ registry, allowExternalEscalation: false });
  const governor = new ModelRuntimeGovernor({ failureThreshold: 1, cooldownMs: 1000 });
  const pool = new LocalModelExecutionPool({
    registry,
    router,
    governor,
    clientFactory: (model) => ({ generate: async () => {
      if (model.id === 'm1') throw new Error('primary failed');
      return { text: 'ok' };
    } })
  });
  const result = await pool.execute({ capabilities: ['code'] }, { messages: [{ role: 'user', content: 'x' }] }, { now: 0 });
  assert.equal(result.model.id, 'm2');
  assert.deepEqual(result.attempts.map((item) => item.outcome), ['failure', 'success']);
});
