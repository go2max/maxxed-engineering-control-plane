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
    const failureClasses = [...new Set(failed.map((name) => checks[name]?.class).filter(Boolean))];
    const securityFailed = failureClasses.includes(FailureClass.SECURITY_FAILURE);
    const policyFailed = failureClasses.includes(FailureClass.POLICY_FAILURE);
    const externalUncertain = failureClasses.includes(FailureClass.EXTERNAL_STATE_UNCERTAIN);
    const independenceRequired = acceptance.requireIndependentVerifier === true;
    const producerId = evidence.producerId ?? null;
    const verifierId = evidence.verifierId ?? null;

    if (independenceRequired && (!producerId || !verifierId || producerId === verifierId)) {
      return { verdict: Verdict.REJECT, missing, failed, failureClasses, reason: 'independent verifier evidence required', producerId, verifierId, independent: false };
    }
    if (securityFailed || policyFailed || externalUncertain) {
      return { verdict: Verdict.ESCALATE, missing, failed, failureClasses, reason: 'high-risk acceptance failure', producerId, verifierId, independent: producerId && verifierId ? producerId !== verifierId : null };
    }
    if (missing.length) return { verdict: Verdict.REJECT, missing, failed, failureClasses, reason: 'required evidence missing', producerId, verifierId, independent: producerId && verifierId ? producerId !== verifierId : null };
    if (failed.length) return { verdict: Verdict.REPAIR, missing, failed, failureClasses, reason: 'repairable acceptance failures', producerId, verifierId, independent: producerId && verifierId ? producerId !== verifierId : null };
    return { verdict: Verdict.ACCEPT, missing: [], failed: [], failureClasses: [], reason: 'all required checks passed', producerId, verifierId, independent: producerId && verifierId ? producerId !== verifierId : null };
  }
}
