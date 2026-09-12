import test from 'node:test';
import assert from 'node:assert/strict';
import { FailureClass } from '../src/verification/verifier.js';
import { buildRepairPlan, FailureFingerprintRegistry, fingerprintFailure } from '../src/verification/failure-fingerprint.js';

test('volatile ids and paths normalize into stable failure fingerprint', () => {
  const a = fingerprintFailure({ class: FailureClass.TEST_FAILURE, check: 'unit', message: 'failed at C:\\repo\\x.js commit abcdef1234567 id 123456' });
  const b = fingerprintFailure({ class: FailureClass.TEST_FAILURE, check: 'unit', message: 'failed at C:/repo/x.js commit fedcba7654321 id 987654' });
  assert.equal(a, b);
});

test('external state uncertainty requires reconciliation and disables automatic repair', () => {
  const plan = buildRepairPlan({ class: FailureClass.EXTERNAL_STATE_UNCERTAIN, message: 'provider timeout after mutation' });
  assert.equal(plan.automatic, false);
  assert.equal(plan.requiresReconciliation, true);
  assert.ok(plan.steps.includes('read-authoritative-external-state'));
});

test('infrastructure failures request compatible-worker reschedule', () => {
  const plan = buildRepairPlan({ class: FailureClass.INFRASTRUCTURE_FAILURE, message: 'worker lost' });
  assert.equal(plan.automatic, true);
  assert.equal(plan.retryDifferentWorker, true);
});

test('registry attributes repeated failure across tasks', () => {
  const registry = new FailureFingerprintRegistry();
  const failure = { class: FailureClass.BUILD_FAILURE, check: 'build', message: 'compile failed' };
  const first = registry.record('a', failure, 1000);
  const second = registry.record('b', failure, 2000);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(second.count, 2);
  assert.deepEqual(second.tasks.sort(), ['a', 'b']);
});
