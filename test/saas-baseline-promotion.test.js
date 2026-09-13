import test from 'node:test';
import assert from 'node:assert/strict';
import { SaasWebFactory, WebFactoryStage } from '../src/factories/saas-web-factory.js';
import { buildBaselineContract, resolveProductDelta, specDigest } from '../src/factories/saas-baseline.js';
import { buildPromotionRecord, buildRollbackPlan, productionAcceptanceRecord, verifyPromotionLineage } from '../src/factories/environment-promotion.js';

test('factory separates reusable platform foundations from product delta', () => {
  const spec = { capabilities: ['auth', 'billing-entitlements', 'admin', 'custom-scheduling-engine'] };
  const delta = resolveProductDelta({ spec });
  assert.deepEqual(delta.reused, ['admin', 'auth', 'billing-entitlements']);
  assert.deepEqual(delta.productDelta, ['custom-scheduling-engine']);
  assert.equal(delta.specDigest, specDigest(spec));
});

test('factory run and task templates retain exact spec lineage', () => {
  const factory = new SaasWebFactory();
  const run = factory.createRun({ productKey: 'app', repository: 'go2max/app', runId: 'r1', spec: { capabilities: ['auth', 'custom-feature'] } });
  assert.match(run.specDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(run.baseline.productDelta, ['custom-feature']);
  const tasks = factory.requiredTaskTemplates(run);
  assert.ok(tasks.every((task) => task.metadata.specDigest === run.specDigest));
  assert.ok(tasks.every((task) => task.dedupeKey.includes(run.specDigest)));
});

test('canonical SPEC evidence cannot claim a different specification', () => {
  const factory = new SaasWebFactory();
  const run = factory.createRun({ productKey: 'app', repository: 'go2max/app', runId: 'r1', spec: { capabilities: ['auth'] } });
  assert.throws(() => factory.record(run, WebFactoryStage.SPEC, { ok: true, specId: 's1', requirementsHash: 'f'.repeat(64) }), /does not match/);
});

test('promotion requires exact accepted commit and specification lineage', () => {
  const spec = { capabilities: ['auth'] };
  const digest = specDigest(spec);
  const promotion = buildPromotionRecord({
    productKey: 'app', repository: 'go2max/app', environment: 'production',
    commitSha: 'a'.repeat(40), specDigest: digest, deploymentId: 'dep-2', url: 'https://app.example.test',
    acceptanceBundleId: 'bundle-1', previousDeployment: { commitSha: 'b'.repeat(40), deploymentId: 'dep-1', url: 'https://app.example.test' }
  });
  assert.equal(verifyPromotionLineage({ promotion, acceptedCommitSha: 'a'.repeat(40), acceptedSpecDigest: digest }).ok, true);
  assert.equal(verifyPromotionLineage({ promotion, acceptedCommitSha: 'c'.repeat(40), acceptedSpecDigest: digest }).ok, false);
  assert.equal(buildRollbackPlan(promotion).automatic, true);
});

test('production acceptance fails on smoke browser api or console evidence', () => {
  const promotion = { commitSha: 'a'.repeat(40), deploymentId: 'dep' };
  const good = productionAcceptanceRecord({ promotion, smoke: { ok: true }, browser: { ok: true }, api: { ok: true }, consoleErrors: 0 });
  assert.equal(good.accepted, true);
  const bad = productionAcceptanceRecord({ promotion, smoke: { ok: true }, browser: { ok: false }, api: { ok: true }, consoleErrors: 2 });
  assert.equal(bad.accepted, false);
  assert.deepEqual(bad.failures, ['browser-smoke', 'console-errors']);
});

test('baseline contract includes reusable cross-cutting invariants', () => {
  const contract = buildBaselineContract({ productKey: 'app', repository: 'go2max/app', spec: { capabilities: ['auth'] } });
  assert.ok(contract.invariantChecks.includes('tenant-boundary'));
  assert.ok(contract.invariantChecks.includes('deployment-lineage'));
  assert.ok(contract.requiredFoundations.includes('billing-entitlements'));
});
