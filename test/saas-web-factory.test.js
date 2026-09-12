import test from 'node:test';
import assert from 'node:assert/strict';
import { SaasWebFactory, WebFactoryStage } from '../src/factories/saas-web-factory.js';

test('factory emits ordered dependency-linked task templates', () => {
  const factory = new SaasWebFactory();
  const run = factory.createRun({ productKey: 'demo', repository: 'go2max/demo', runId: 'r1' });
  const tasks = factory.requiredTaskTemplates(run);
  assert.equal(tasks.length, Object.keys(WebFactoryStage).length);
  assert.deepEqual(tasks[1].dependencies, ['r1:spec']);
  assert.deepEqual(tasks.find((task) => task.metadata.stage === WebFactoryStage.BROWSER).requirements.capabilities, ['browser']);
});

test('factory cannot skip stages and fails closed on failed evidence', () => {
  const factory = new SaasWebFactory();
  const run = factory.createRun({ productKey: 'demo', repository: 'go2max/demo', runId: 'r1' });
  assert.throws(() => factory.record(run, WebFactoryStage.IMPLEMENT, { ok: true }), /expected stage SPEC/);
  const failed = factory.record(run, WebFactoryStage.SPEC, { ok: false, reason: 'invalid spec' });
  assert.equal(failed.state, 'FAILED');
});

test('all passing stages produce accepted run', () => {
  const factory = new SaasWebFactory();
  let run = factory.createRun({ productKey: 'demo', repository: 'go2max/demo', runId: 'r1' });
  for (const stage of Object.values(WebFactoryStage)) run = factory.record(run, stage, { ok: true });
  assert.equal(run.state, 'ACCEPTED');
});
