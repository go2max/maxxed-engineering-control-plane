import { MergeRiskClassifier } from './merge-risk-classifier.js';
import { EconomicImpactCertificate } from './economic-impact-certificate.js';

export const EconomicVerdict = Object.freeze({
  ACCEPT: 'ACCEPT',
  REJECT: 'REJECT',
  ESCALATE: 'ESCALATE'
});

const classifier = new MergeRiskClassifier();

/**
 * Independent economic-acceptance authority. Kept separate from the implementer and the
 * ordinary functional verifier (per AGENT_ROLES.md role-separation principle): this verifier
 * never runs as the same identity that produced the candidate or that ran functional checks,
 * and cost acceptance never substitutes for functional/security acceptance — it is an
 * additional, independent gate.
 */
export class EconomicVerifier {
  constructor({ policyVersion, escalationThresholdUsd = 25 } = {}) {
    if (!policyVersion) throw new Error('policyVersion is required');
    this.policyVersion = String(policyVersion);
    this.escalationThresholdUsd = Number(escalationThresholdUsd);
  }

  /**
   * Verify a candidate's economic acceptance.
   * `certificate` must be an EconomicImpactCertificate.issue(...) output bound to the exact
   * sourceSha/candidateSha/policyVersion under review — a missing or mis-bound certificate for
   * a C3+ class fails closed (REJECT), it never silently passes.
   */
  verify({
    sourceSha,
    candidateSha,
    riskClass,
    certificate = null,
    implementerId = null,
    functionalVerifierId = null,
    economicVerifierId = null,
    canary = null
  } = {}) {
    if (!economicVerifierId) {
      return { verdict: EconomicVerdict.REJECT, reason: 'economic-verifier-identity-required', riskClass };
    }
    if (economicVerifierId === implementerId || economicVerifierId === functionalVerifierId) {
      return { verdict: EconomicVerdict.REJECT, reason: 'economic-verifier-authority-must-be-independent', riskClass };
    }

    // Proof of origin comes first, before any binding/threshold reasoning: a certificate is only
    // evidence if this control plane's own issuer signed it. A hand-constructed object that merely
    // *looks* like a certificate (correct SHAs, riskClass, provenance, an arbitrary certificateId)
    // has no signature under the process key and is rejected outright — the presence of a
    // certificate object is never itself a reason to trust it.
    if (certificate && !EconomicImpactCertificate.verifySignature(certificate)) {
      return { verdict: EconomicVerdict.REJECT, reason: 'certificate-signature-invalid', riskClass };
    }

    const requiresCertificate = classifier.requiresEconomicCertificate(riskClass);
    if (!requiresCertificate) {
      // C0-C2: low-overhead path — docs-only / bounded changes don't require a full economic
      // certificate, but if one was still provided we still validate its binding.
      if (certificate && !EconomicImpactCertificate.isBoundTo(certificate, { sourceSha, candidateSha, policyVersion: this.policyVersion })) {
        return { verdict: EconomicVerdict.REJECT, reason: 'certificate-not-bound-to-candidate', riskClass };
      }
      return { verdict: EconomicVerdict.ACCEPT, reason: 'below-economic-certificate-threshold', riskClass, certificateRequired: false };
    }

    // C3-C5: certificate is mandatory. Missing, wrong-binding, low-confidence-without-provenance,
    // or stale evidence fails closed rather than defaulting to pass.
    if (!certificate) {
      return { verdict: EconomicVerdict.REJECT, reason: 'missing-required-economic-certificate', riskClass, certificateRequired: true };
    }
    if (!EconomicImpactCertificate.isBoundTo(certificate, { sourceSha, candidateSha, policyVersion: this.policyVersion })) {
      return { verdict: EconomicVerdict.REJECT, reason: 'certificate-not-bound-to-candidate', riskClass, certificateRequired: true };
    }
    if (!certificate.provenance || !(certificate.confidence >= 0)) {
      return { verdict: EconomicVerdict.REJECT, reason: 'certificate-missing-provenance-or-confidence', riskClass };
    }
    if (certificate.provenance === 'estimated' && certificate.confidence < 0.3 && rank(riskClass) >= rank('C4')) {
      return { verdict: EconomicVerdict.ESCALATE, reason: 'low-confidence-estimate-for-high-risk-class', riskClass };
    }

    if (Math.abs(certificate.estimatedMonthlyDeltaUsd) >= this.escalationThresholdUsd && rank(riskClass) >= rank('C4')) {
      // High-risk, materially cost-affecting merges require a canary/observation window before
      // full acceptance.
      if (!canary || canary.state !== 'OBSERVED_WITHIN_THRESHOLD') {
        return { verdict: EconomicVerdict.ESCALATE, reason: 'high-risk-cost-affecting-merge-requires-canary', riskClass };
      }
    }

    return { verdict: EconomicVerdict.ACCEPT, reason: 'economic-acceptance-satisfied', riskClass, certificateId: certificate.certificateId };
  }
}

function rank(cls) { return ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'].indexOf(cls); }
