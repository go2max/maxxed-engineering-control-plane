import test from 'node:test';
import assert from 'node:assert/strict';
import { AcceptanceVerifier, FailureClass, Verdict } from '../src/verification/verifier.js';
import { RepairAction, RepairController } from '../src/verification/repair-controller.js';

test('verifier accepts complete passing evidence', () => {
  const verifier = new AcceptanceVerifier();
  const result = verifier.verify({
    acceptance: { requiredChecks: ['build', 'tests'] },
    evidence: { checks: { build: { ok: true }, tests: { ok: true } } }
  });
  assert.equal(result.verdict, Verdict.ACCEPT);
});

test('security and external-state uncertainty escalate instead of auto-repairing', () => {
  const verifier = new AcceptanceVerifier();
  const security = verifier.verify({ acceptance: { requiredChecks: ['security'] }, evidence: { checks: { security: { ok: false, class: FailureClass.SECURITY_FAILURE } } } });
  assert.equal(security.verdict, Verdict.ESCALATE);
  const external = verifier.verify({ acceptance: { requiredChecks: ['provider'] }, evidence: { checks: { provider: { ok: false, class: FailureClass.EXTERNAL_STATE_UNCERTAIN } } } });
  assert.equal(external.verdict, Verdict.ESCALATE);
});

test('repair controller stops repeated failures at bounded budget', () => {
  const controller = new RepairController({ maxAttempts: 3, breakerThreshold: 2 });
  const verification = { verdict: Verdict.REPAIR, failed: ['tests'], reason: 'repairable acceptance failures' };
  assert.equal(controller.decide('t1', verification).action, RepairAction.RETRY_REPAIR);
  const second = controller.decide('t1', verification);
  assert.equal(second.action, RepairAction.TERMINATE);
  assert.equal(second.history.breakerOpen, true);
  assert.equal(controller.decide('t1', verification).action, RepairAction.TERMINATE);
});
