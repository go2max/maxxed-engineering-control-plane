// Regression tests for the CRITICAL/HIGH certificate-forgery findings of today's security review.
// Each test reproduces the review's proof-of-concept and asserts it NOW fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EconomicVerifier, EconomicVerdict } from '../src/economics/economic-verifier.js';
import { EconomicImpactCertificate } from '../src/economics/economic-impact-certificate.js';
import { EconomicCertificateIssuer } from '../src/economics/economic-certificate-issuer.js';
import { buildEvidenceBundle } from '../src/verification/evidence-bundle.js';
import {
  issueProofCertificate, verifyCertificateIntegrity, certificateFingerprint, CertificateCache
} from '../src/verification/proof-certificate.js';
import { signCertificatePayload, verifyCertificatePayload } from '../src/security/certificate-signing-key.js';
import { digest } from '../src/leverage/solution-cas.js';
import { createHash } from 'node:crypto';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

// --- Finding 1: economic certificates ---------------------------------------------------------

/** Exactly the hand-written object the security review's PoC attached to a C5 payment diff. */
function forgedEconomicCertificate(overrides = {}) {
  return {
    version: 1,
    sourceSha: SHA_A,
    candidateSha: SHA_B,
    policyVersion: 'v1',
    riskClass: 'C0',
    measurements: {},
    estimatedMonthlyDeltaUsd: 0,
    provenance: 'measured',
    confidence: 1,
    recurringAmplification: null,
    issuedAt: 0,
    certificateId: 'anything',
    observed: null,
    ...overrides
  };
}

test('PoC: a hand-forged economic certificate is rejected by EconomicVerifier (C5 payment diff)', () => {
  const verifier = new EconomicVerifier({ policyVersion: 'v1' });
  const result = verifier.verify({
    sourceSha: SHA_A, candidateSha: SHA_B, riskClass: 'C5',
    implementerId: 'impl-1', functionalVerifierId: 'verifier-1', economicVerifierId: 'econ-1',
    certificate: forgedEconomicCertificate()
  });
  assert.equal(result.verdict, EconomicVerdict.REJECT);
  assert.equal(result.reason, 'certificate-signature-invalid');
});

test('a forged certificate with a *correctly computed* certificateId is still rejected (id is not a signature)', () => {
  const forged = forgedEconomicCertificate();
  const { certificateId: _ignored, observed: _observed, ...core } = forged;
  const withRealId = { ...forged, certificateId: digest(core) };
  assert.equal(EconomicImpactCertificate.verifySignature(withRealId), false);

  const verifier = new EconomicVerifier({ policyVersion: 'v1' });
  const result = verifier.verify({
    sourceSha: SHA_A, candidateSha: SHA_B, riskClass: 'C4',
    implementerId: 'impl-1', functionalVerifierId: 'verifier-1', economicVerifierId: 'econ-1',
    certificate: withRealId
  });
  assert.equal(result.verdict, EconomicVerdict.REJECT);
  assert.equal(result.reason, 'certificate-signature-invalid');
});

test('mutating a genuinely issued economic certificate invalidates its signature', () => {
  const genuine = EconomicImpactCertificate.issue({
    sourceSha: SHA_A, candidateSha: SHA_B, policyVersion: 'v1', riskClass: 'C4',
    estimatedMonthlyDeltaUsd: 900, provenance: 'estimated', confidence: 0.4
  });
  assert.equal(EconomicImpactCertificate.verifySignature(genuine), true);

  // Downgrade the projected cost while keeping the original signature.
  const tampered = { ...genuine, estimatedMonthlyDeltaUsd: 0 };
  assert.equal(EconomicImpactCertificate.verifySignature(tampered), false);
  // Recomputing the unkeyed certificateId does not help the attacker either.
  const { certificateId: _id, observed: _obs, signature: _sig, ...core } = tampered;
  assert.equal(EconomicImpactCertificate.verifySignature({ ...tampered, certificateId: digest(core) }), false);
});

test('an unsigned certificate is rejected even on the C0-C2 low-overhead path', () => {
  const verifier = new EconomicVerifier({ policyVersion: 'v1' });
  const result = verifier.verify({
    sourceSha: SHA_A, candidateSha: SHA_B, riskClass: 'C1',
    implementerId: 'impl-1', functionalVerifierId: 'verifier-1', economicVerifierId: 'econ-1',
    certificate: forgedEconomicCertificate({ riskClass: 'C1' })
  });
  assert.equal(result.verdict, EconomicVerdict.REJECT);
  assert.equal(result.reason, 'certificate-signature-invalid');
});

test('honest evidence still passes: a certificate from the real issuer verifies and is accepted', () => {
  const issuer = new EconomicCertificateIssuer({ policyVersion: 'v1' });
  const issued = issuer.issue({
    task: {
      key: 't1',
      metadata: {
        execution: { ref: SHA_A },
        economics: {
          touchesScheduledWork: true,
          evidence: { provenance: 'measured', confidence: 0.9, computeMs: 1200, scheduledJobFrequencyPerMonth: 30 }
        }
      }
    },
    evidence: { artifacts: { commitSha: SHA_B }, producerId: 'impl-1', verifierId: 'verifier-1' }
  });
  assert.ok(issued?.certificate, 'the real issuer should issue a certificate for this evidence');
  assert.equal(EconomicImpactCertificate.verifySignature(issued.certificate), true);

  const verifier = new EconomicVerifier({ policyVersion: 'v1' });
  const result = verifier.verify({
    sourceSha: SHA_A, candidateSha: SHA_B, riskClass: issued.classification.class,
    implementerId: 'impl-1', functionalVerifierId: 'verifier-1', economicVerifierId: 'econ-1',
    certificate: issued.certificate
  });
  assert.notEqual(result.verdict, EconomicVerdict.REJECT);
});

test('reconciliation refuses to launder an unsigned certificate into a signed one', () => {
  assert.throws(
    () => EconomicImpactCertificate.reconcile(forgedEconomicCertificate(), { observedMonthlyDeltaUsd: 0 }),
    /signature verification/
  );
  const genuine = EconomicImpactCertificate.issue({ sourceSha: SHA_A, candidateSha: SHA_B, policyVersion: 'v1', riskClass: 'C3', estimatedMonthlyDeltaUsd: 10 });
  const reconciled = EconomicImpactCertificate.reconcile(genuine, { observedMonthlyDeltaUsd: 12 });
  assert.equal(EconomicImpactCertificate.verifySignature(reconciled), true);
});

// --- Finding 3: proof certificates ------------------------------------------------------------

function baseProofInput(overrides = {}) {
  const evidenceBundle = buildEvidenceBundle({ taskKey: 'shard-1', evidence: { artifacts: { commitSha: SHA_A } } });
  return {
    evidenceBundle,
    sourceSha: SHA_A,
    mutationDigest: 'mutation-digest-1',
    environmentFingerprint: 'env-v1',
    policyVersion: 'policy-v1',
    executorId: 'agent-1',
    verifierId: 'verifier-1',
    acceptanceContractDigest: 'contract-1',
    checks: { tests: [{ name: 'unit', passed: true, verifiedBy: 'verifier-1' }] },
    ...overrides
  };
}

test('PoC: relabelling a self-reported proof certificate as independently verified fails integrity', () => {
  const selfReported = issueProofCertificate(baseProofInput({
    executorId: 'agent-1',
    verifierId: 'agent-1:self-verified',
    checks: { tests: [{ name: 'shard-acceptance', passed: true, selfReported: true }] }
  }));
  assert.equal(selfReported.accepted, false);
  assert.equal(verifyCertificateIntegrity(selfReported), true);

  // The exact review PoC: flip selfReported, claim an independent verifier, force accepted, and
  // recompute the seal with the module's own exported digest algorithm.
  const forged = {
    ...selfReported,
    accepted: true,
    hasExternalEvidence: true,
    verifiedBy: 'independent-security-verifier',
    checks: { ...selfReported.checks, tests: [{ ...selfReported.checks.tests[0], selfReported: false, verifiedBy: 'independent-security-verifier' }] }
  };
  delete forged.seal;
  // An attacker without the key can only produce an unkeyed digest — which no longer validates.
  const unkeyedSeal = createHash('sha256').update(JSON.stringify(forged)).digest('hex');
  assert.equal(verifyCertificateIntegrity({ ...forged, seal: unkeyedSeal }), false);
  assert.equal(verifyCertificateIntegrity({ ...forged, seal: selfReported.seal }), false);
});

test('a forged proof certificate cannot be cached or reused', () => {
  const cache = new CertificateCache();
  const honest = issueProofCertificate(baseProofInput());
  cache.put(honest);

  const forged = { ...honest, accepted: true, checks: { ...honest.checks, security: [{ name: 'pentest', passed: true, verifiedBy: 'nobody', selfReported: false }] } };
  assert.equal(verifyCertificateIntegrity(forged), false);
  assert.throws(() => cache.put(forged), /integrity verification/);

  // The honest certificate is untouched and still reusable.
  const identity = certificateFingerprint({
    sourceSha: SHA_A, mutationDigest: 'mutation-digest-1', environmentFingerprint: 'env-v1',
    policyVersion: 'policy-v1', executorId: 'agent-1', verifierId: 'verifier-1', acceptanceContractDigest: 'contract-1'
  });
  const reuse = cache.tryReuse(identity);
  assert.equal(reuse.reused, true);
  assert.equal(reuse.certificate.accepted, true);
  assert.deepEqual(reuse.certificate.checks.security, []);
});

test('finding 2: differing checks/accepted change the content fingerprint and cannot collide in the cache', () => {
  const honest = issueProofCertificate(baseProofInput());
  // Same identity dimensions, different asserted content (a failing check ⇒ accepted:false).
  const contradictory = issueProofCertificate(baseProofInput({
    checks: { tests: [{ name: 'unit', passed: false, verifiedBy: 'verifier-1' }] }
  }));

  assert.equal(honest.fingerprint, contradictory.fingerprint, 'identity dimensions are unchanged');
  assert.notEqual(honest.contentFingerprint, contradictory.contentFingerprint);
  assert.equal(honest.accepted, true);
  assert.equal(contradictory.accepted, false);

  const cache = new CertificateCache();
  cache.put(honest);
  // Contradictory evidence for the same identity fails closed instead of silently overwriting.
  assert.throws(() => cache.put(contradictory), /conflicting content/);
  assert.equal(cache.get(honest.fingerprint), null);
  assert.equal(cache.tryReuse({ fingerprint: honest.fingerprint }).reused, false);
});

test('re-putting an identical, genuinely issued certificate is still allowed (no false-positive conflict)', () => {
  const cache = new CertificateCache();
  const input = baseProofInput();
  cache.put(issueProofCertificate({ ...input, now: 1 }));
  cache.put(issueProofCertificate({ ...input, now: 2 }));
  assert.equal(cache.tryReuse({ fingerprint: issueProofCertificate(input).fingerprint }).reused, true);
});

// --- Signing key ------------------------------------------------------------------------------

test('the signing key never appears in a signature and signatures are content-bound', () => {
  const signature = signCertificatePayload({ a: 1, b: [2, 3] });
  assert.match(signature, /^[0-9a-f]{64}$/);
  // Canonicalization: key order does not change the signature.
  assert.equal(signCertificatePayload({ b: [2, 3], a: 1 }), signature);
  assert.equal(verifyCertificatePayload({ a: 1, b: [2, 3] }, signature), true);
  assert.equal(verifyCertificatePayload({ a: 2, b: [2, 3] }, signature), false);
  assert.equal(verifyCertificatePayload({ a: 1, b: [2, 3] }, 'not-a-signature'), false);
  assert.equal(verifyCertificatePayload({ a: 1, b: [2, 3] }, null), false);
  const secret = process.env.MAXXED_CERTIFICATE_SIGNING_KEY;
  if (secret) assert.equal(signature.includes(secret), false);
});
