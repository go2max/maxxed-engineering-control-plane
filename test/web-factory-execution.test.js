import test from 'node:test';
import assert from 'node:assert/strict';
import { SaasWebFactory, WebFactoryStage } from '../src/factories/saas-web-factory.js';
import { WebFactoryExecutor } from '../src/factories/web-factory-executor.js';
import { semanticJobForStage, validateStageEvidence } from '../src/factories/web-stage-contracts.js';

test('stage contracts emit semantic jobs with concrete expected evidence', () => {
  const factory = new SaasWebFactory();
  const run = factory.createRun({ productKey: 'app', repository: 'go2max/app', runId: 'r1' });
  const job = semanticJobForStage(run, WebFactoryStage.SPEC);
  assert.equal(job.kind, 'planning');
  assert.ok(job.expectedEvidence.includes('requirementsHash'));
});

test('test and security evidence fail closed', () => {
  assert.equal(validateStageEvidence(WebFactoryStage.UNIT_API, { testCommand: 'npm test', passed: 5, failed: 1 }).ok, false);
  assert.equal(validateStageEvidence(WebFactoryStage.SECURITY, { scanner: 'local', critical: 0, high: 1 }).ok, false);
});

test('failed stage produces bounded repair handoff', () => {
  const factory = new SaasWebFactory();
  const executor = new WebFactoryExecutor({ factory, repairPlanner: (failure) => ({ automatic: true, failureClass: failure.class }) });
  let run = factory.createRun({ productKey: 'app', repository: 'go2max/app', runId: 'r1' });
  run = factory.record(run, WebFactoryStage.SPEC, { ok: true, specId: 's1', requirementsHash: 'h1' });
  run = factory.record(run, WebFactoryStage.IMPLEMENT, { ok: true, commitSha: 'a'.repeat(40), changedFiles: ['x.js'] });
  const result = executor.applyEvidence(run, { testCommand: 'npm test', passed: 3, failed: 1 });
  assert.equal(result.run.state, 'FAILED');
  assert.equal(result.failure.class, 'TEST_FAILURE');
  assert.equal(result.repairPlan.automatic, true);
});

test('production verification requires exact accepted commit', () => {
  const factory = new SaasWebFactory();
  const executor = new WebFactoryExecutor({ factory });
  let run = factory.createRun({ productKey: 'app', repository: 'go2max/app', runId: 'r1' });
  const evidence = {
    SPEC: { specId: 's', requirementsHash: 'h' },
    IMPLEMENT: { commitSha: 'a'.repeat(40), changedFiles: ['x'] },
    UNIT_API: { testCommand: 'npm test', passed: 1, failed: 0 },
    BROWSER: { baseUrl: 'http://staging', scenarios: ['smoke'], passed: 1, failed: 0 },
    ACCESSIBILITY: { standard: 'WCAG2.2AA', violations: 0 },
    SECURITY: { scanner: 'local', critical: 0, high: 0 },
    STAGING: { deploymentId: 'd', url: 'http://staging', commitSha: 'a'.repeat(40) },
    VISUAL_VERIFY: { baseUrl: 'http://staging', screenshots: ['home.png'], consoleErrors: 0 },
    ACCEPT: { acceptedCommitSha: 'a'.repeat(40), acceptanceBundleId: 'bundle' }
  };
  for (const stage of Object.values(WebFactoryStage)) run = executor.applyEvidence(run, evidence[stage]).run;
  assert.equal(run.state, 'ACCEPTED');
  assert.throws(() => executor.productionVerificationHandoff(run, { url: 'https://prod', commitSha: 'b'.repeat(40) }), /does not match/);
  assert.equal(executor.productionVerificationHandoff(run, { url: 'https://prod', commitSha: 'a'.repeat(40) }).kind, 'production-verification');
});
