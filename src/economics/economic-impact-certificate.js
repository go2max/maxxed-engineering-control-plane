import { digest } from '../leverage/solution-cas.js';
import { signCertificatePayload, verifyCertificatePayload } from '../security/certificate-signing-key.js';

const SHA40 = /^[0-9a-f]{40}$/i;

// Exactly the fields that make up a certificate's signed core. Anything a caller adds outside this
// list is not covered by the signature and therefore carries no authority.
const CORE_FIELDS = Object.freeze([
  'version', 'sourceSha', 'candidateSha', 'policyVersion', 'riskClass', 'measurements',
  'estimatedMonthlyDeltaUsd', 'provenance', 'confidence', 'recurringAmplification', 'issuedAt'
]);

function coreOf(certificate) {
  const core = {};
  for (const field of CORE_FIELDS) core[field] = certificate?.[field];
  return core;
}

/** The exact payload the HMAC covers: the immutable core, its id, and any reconciled observation. */
function signaturePayload(certificate) {
  return { ...coreOf(certificate), certificateId: certificate?.certificateId, observed: certificate?.observed ?? null };
}

const COST_CATEGORIES = Object.freeze([
  'computeMs', 'dbReads', 'dbWrites', 'dbScans', 'storageGrowthBytes', 'egressBytes',
  'ciBuildMinutes', 'externalApiCalls', 'modelTokenSpendUsd', 'loggingVolumeBytes',
  'workerFanOut', 'scheduledJobFrequencyPerMonth', 'pollingCadencePerMinute', 'retryMultiplier'
]);

function normalizeMeasurements(measurements = {}) {
  const row = {};
  for (const category of COST_CATEGORIES) row[category] = Number(measurements[category] ?? 0);
  return row;
}

/**
 * An Economic Impact Certificate is an immutable, source-bound proof of a candidate's projected
 * (and, once observed, actual) economic delta relative to current main. It is bound to the
 * exact source SHA, candidate SHA and policy version so it can never be silently reused across a
 * different diff or a stale policy.
 */
export class EconomicImpactCertificate {
  static issue({
    sourceSha,
    candidateSha,
    policyVersion,
    riskClass,
    measurements = {},
    estimatedMonthlyDeltaUsd = 0,
    provenance = 'estimated',
    confidence = 0.5,
    recurringAmplification = null,
    now = Date.now()
  } = {}) {
    if (!SHA40.test(String(sourceSha ?? ''))) throw new Error('economic certificate requires exact sourceSha');
    if (!SHA40.test(String(candidateSha ?? ''))) throw new Error('economic certificate requires exact candidateSha');
    if (!policyVersion) throw new Error('economic certificate requires policyVersion');
    if (!riskClass) throw new Error('economic certificate requires riskClass');
    if (!['estimated', 'measured', 'benchmarked'].includes(provenance)) throw new Error(`unknown provenance: ${provenance}`);

    const normalized = normalizeMeasurements(measurements);
    const core = {
      version: 1,
      sourceSha: String(sourceSha).toLowerCase(),
      candidateSha: String(candidateSha).toLowerCase(),
      policyVersion: String(policyVersion),
      riskClass: String(riskClass),
      measurements: normalized,
      estimatedMonthlyDeltaUsd: Number(estimatedMonthlyDeltaUsd),
      provenance,
      confidence: Math.min(1, Math.max(0, Number(confidence))),
      recurringAmplification: recurringAmplification ? structuredClone(recurringAmplification) : null,
      issuedAt: Number(now)
    };
    const certificateId = digest(core);
    // The id is an unkeyed content address (useful for dedupe/audit), NOT proof of origin. The
    // signature below is what makes this certificate unforgeable outside the control-plane process.
    const signature = signCertificatePayload({ ...core, certificateId, observed: null });
    return Object.freeze({ ...core, certificateId, observed: null, signature });
  }

  /**
   * Certificates are immutable, so reconciling observed actuals returns a *new* certificate
   * that references the original by id rather than mutating it.
   */
  static reconcile(certificate, { observedMonthlyDeltaUsd, observedAt = Date.now(), observedMeasurements = {} } = {}) {
    if (!certificate?.certificateId) throw new Error('a valid certificate is required for reconciliation');
    // Reconciliation must start from a genuinely issued certificate: an unsigned or forged one can
    // never be laundered into a signed certificate by passing through this path.
    if (!EconomicImpactCertificate.verifySignature(certificate)) {
      throw new Error('refusing to reconcile a certificate that fails signature verification');
    }
    const observed = Object.freeze({
      basedOnCertificateId: certificate.certificateId,
      observedMonthlyDeltaUsd: Number(observedMonthlyDeltaUsd),
      observedMeasurements: normalizeMeasurements(observedMeasurements),
      observedAt: Number(observedAt),
      deltaFromForecastUsd: Number(observedMonthlyDeltaUsd) - Number(certificate.estimatedMonthlyDeltaUsd),
      forecastErrorRatio: certificate.estimatedMonthlyDeltaUsd !== 0
        ? (Number(observedMonthlyDeltaUsd) - certificate.estimatedMonthlyDeltaUsd) / Math.abs(certificate.estimatedMonthlyDeltaUsd)
        : (observedMonthlyDeltaUsd === 0 ? 0 : null)
    });
    const reconciled = { ...certificate, observed };
    return Object.freeze({ ...reconciled, signature: signCertificatePayload(signaturePayload(reconciled)) });
  }

  /**
   * Proof of origin: the certificate's id is the content address of its own core (so a mutated
   * core is detected), and the HMAC over that core + id + observation verifies under the current
   * process signing key (so a hand-constructed certificate, however well-formed, is rejected).
   * Never throws and never reveals anything about the key.
   */
  static verifySignature(certificate) {
    if (!certificate || typeof certificate !== 'object') return false;
    if (typeof certificate.signature !== 'string') return false;
    const core = coreOf(certificate);
    if (digest(core) !== certificate.certificateId) return false;
    return verifyCertificatePayload(signaturePayload(certificate), certificate.signature);
  }

  /**
   * Verifies a certificate is exactly bound to the source/candidate SHA and policy version under
   * review, and hasn't been reused against a different diff.
   */
  static isBoundTo(certificate, { sourceSha, candidateSha, policyVersion } = {}) {
    if (!certificate) return false;
    return certificate.sourceSha === String(sourceSha ?? '').toLowerCase()
      && certificate.candidateSha === String(candidateSha ?? '').toLowerCase()
      && certificate.policyVersion === String(policyVersion ?? '');
  }
}

export { COST_CATEGORIES };
