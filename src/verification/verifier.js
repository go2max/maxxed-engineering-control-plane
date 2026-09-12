export const Verdict = Object.freeze({
  ACCEPT: 'ACCEPT',
  REPAIR: 'REPAIR',
  REJECT: 'REJECT',
  ESCALATE: 'ESCALATE'
});

export const FailureClass = Object.freeze({
  TEST_FAILURE: 'TEST_FAILURE',
  BUILD_FAILURE: 'BUILD_FAILURE',
  POLICY_FAILURE: 'POLICY_FAILURE',
  SECURITY_FAILURE: 'SECURITY_FAILURE',
  INFRASTRUCTURE_FAILURE: 'INFRASTRUCTURE_FAILURE',
  EXTERNAL_STATE_UNCERTAIN: 'EXTERNAL_STATE_UNCERTAIN',
  NON_REPAIRABLE: 'NON_REPAIRABLE'
});

export class AcceptanceVerifier {
  verify({ acceptance = {}, evidence = {} } = {}) {
    const required = acceptance.requiredChecks ?? [];
    const checks = evidence.checks ?? {};
    const missing = required.filter((name) => !(name in checks));
    const failed = required.filter((name) => checks[name]?.ok === false);
    const securityFailed = failed.some((name) => checks[name]?.class === FailureClass.SECURITY_FAILURE);
    const policyFailed = failed.some((name) => checks[name]?.class === FailureClass.POLICY_FAILURE);
    const externalUncertain = failed.some((name) => checks[name]?.class === FailureClass.EXTERNAL_STATE_UNCERTAIN);

    if (securityFailed || policyFailed || externalUncertain) {
      return { verdict: Verdict.ESCALATE, missing, failed, reason: 'high-risk acceptance failure' };
    }
    if (missing.length) return { verdict: Verdict.REJECT, missing, failed, reason: 'required evidence missing' };
    if (failed.length) return { verdict: Verdict.REPAIR, missing, failed, reason: 'repairable acceptance failures' };
    return { verdict: Verdict.ACCEPT, missing: [], failed: [], reason: 'all required checks passed' };
  }
}
