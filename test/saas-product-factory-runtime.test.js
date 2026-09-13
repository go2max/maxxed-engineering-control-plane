import test from 'node:test';
import assert from 'node:assert/strict';
import { SaasProductFactoryRuntime, planProductFamily } from '../src/factories/saas-product-factory-runtime.js';
import { WebFactoryStage } from '../src/factories/saas-web-factory.js';

test('family plan reuses one shared baseline and keeps only product deltas distinct', () => {
  const family = planProductFamily({
    familyKey: 'maxxed-saas',
    products: [
      { productKey: 'a', repository: 'org/a', spec: { capabilities: ['auth', 'admin', 'custom-a'] } },
      { productKey: 'b', repository: 'org/b', spec: { capabilities: ['auth', 'billing-entitlements', 'custom-b'] } }
    ]
  });
  assert.equal(family.sharedFoundationInstances, 1);
  assert.ok(family.sharedFoundations.includes('auth'));
  assert.deepEqual(family.products[0].productDelta, ['custom-a']);
  assert.deepEqual(family.products[1].productDelta, ['custom-b']);
});

test('product creation emits only product-specific delta tasks plus standard stage chain', () => {
  const runtime = new SaasProductFactoryRuntime();
  const created = runtime.createProduct({ productKey: 'a', repository: 'org/a', runId: 'run-a', spec: { capabilities: ['auth', 'admin', 'custom-engine'] } }, 10);
  const deltas = created.tasks.filter((task) => task.metadata?.productDeltaCapability);
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].metadata.productDeltaCapability, 'custom-engine');
  assert.equal(created.tasks.some((task) => task.metadata?.productDeltaCapability === 'auth'), false);
});

test('accepted run promotes only the exact accepted commit and spec digest', () => {
  const runtime = new SaasProductFactoryRuntime();
  const { run } = runtime.createProduct({ productKey: 'a', repository: 'org/a', runId: 'run-a', spec: { capabilities: ['auth'] } }, 10);
  const stored = runtime.runs.get(run.runId);
  stored.state = 'ACCEPTED';
  stored.evidence.ACCEPT = { acceptedCommitSha: 'a'.repeat(40) };
  runtime.runs.set(run.runId, stored);
  assert.throws(() => runtime.promote(run.runId, { environment: 'production', commitSha: 'b'.repeat(40), deploymentId: 'd1', url: 'https://example.test' }), /deployed commit differs/);
  const promotion = runtime.promote(run.runId, { environment: 'production', commitSha: 'a'.repeat(40), deploymentId: 'd2', url: 'https://example.test' });
  assert.equal(promotion.specDigest, run.specDigest);
});

test('production verification marks healthy release live and failed release produces rollback plan', () => {
  const runtime = new SaasProductFactoryRuntime();
  const { run } = runtime.createProduct({ productKey: 'a', repository: 'org/a', runId: 'run-a', spec: { capabilities: [] } }, 10);
  const stored = runtime.runs.get(run.runId);
  stored.state = 'ACCEPTED';
  stored.evidence.ACCEPT = { acceptedCommitSha: 'a'.repeat(40) };
  runtime.runs.set(run.runId, stored);
  const previousDeployment = { commitSha: 'c'.repeat(40), deploymentId: 'old', url: 'https://old.example.test' };
  const promotion = runtime.promote(run.runId, { environment: 'production', commitSha: 'a'.repeat(40), deploymentId: 'new', url: 'https://new.example.test', previousDeployment });
  const live = runtime.verifyProduction(run.runId, promotion, { smoke: { ok: true }, browser: { ok: true }, api: { ok: true }, consoleErrors: 0 });
  assert.equal(live.status, 'LIVE');
  const failed = runtime.verifyProduction(run.runId, promotion, { smoke: { ok: false }, browser: { ok: true }, api: { ok: true }, consoleErrors: 0 });
  assert.equal(failed.status, 'ROLLBACK_REQUIRED');
  assert.equal(failed.rollbackPlan.automatic, true);
  assert.equal(failed.rollbackPlan.target.deploymentId, 'old');
});

test('factory lifecycle ledger survives snapshot restore', () => {
  const runtime = new SaasProductFactoryRuntime();
  runtime.createProduct({ productKey: 'a', repository: 'org/a', runId: 'run-a', spec: { capabilities: [] } }, 10);
  const snapshot = runtime.snapshot();
  const restored = new SaasProductFactoryRuntime();
  restored.restore(snapshot);
  assert.equal(restored.productStatus('a').history.length, 1);
  assert.equal(restored.runs.get('run-a').productKey, 'a');
});
