import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EconomicImpactCertificate } from '../src/economics/economic-impact-certificate.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

test('certificate is bound to exact source/candidate SHA and policy version', () => {
  const cert = EconomicImpactCertificate.issue({
    sourceSha: SHA_A, candidateSha: SHA_B, policyVersion: 'v1', riskClass: 'C3',
    estimatedMonthlyDeltaUsd: 12.5, provenance: 'estimated', confidence: 0.6
  });
  assert.equal(EconomicImpactCertificate.isBoundTo(cert, { sourceSha: SHA_A, candidateSha: SHA_B, policyVersion: 'v1' }), true);
  assert.equal(EconomicImpactCertificate.isBoundTo(cert, { sourceSha: SHA_A, candidateSha: SHA_B, policyVersion: 'v2' }), false);
  assert.equal(EconomicImpactCertificate.isBoundTo(cert, { sourceSha: SHA_B, candidateSha: SHA_B, policyVersion: 'v1' }), false);
});

test('certificates are immutable', () => {
  const cert = EconomicImpactCertificate.issue({ sourceSha: SHA_A, candidateSha: SHA_B, policyVersion: 'v1', riskClass: 'C3', estimatedMonthlyDeltaUsd: 10 });
  assert.throws(() => { cert.estimatedMonthlyDeltaUsd = 999; });
  assert.equal(cert.estimatedMonthlyDeltaUsd, 10);
  assert.throws(() => { cert.certificateId = 'tampered'; });
});

test('rejects certificate issuance without exact 40-char SHAs', () => {
  assert.throws(() => EconomicImpactCertificate.issue({ sourceSha: 'short', candidateSha: SHA_B, policyVersion: 'v1', riskClass: 'C3' }));
  assert.throws(() => EconomicImpactCertificate.issue({ sourceSha: SHA_A, candidateSha: 'short', policyVersion: 'v1', riskClass: 'C3' }));
});

test('predicted and observed economic deltas are compared via reconcile()', () => {
  const cert = EconomicImpactCertificate.issue({ sourceSha: SHA_A, candidateSha: SHA_B, policyVersion: 'v1', riskClass: 'C3', estimatedMonthlyDeltaUsd: 20 });
  const reconciled = EconomicImpactCertificate.reconcile(cert, { observedMonthlyDeltaUsd: 30 });
  assert.equal(reconciled.observed.deltaFromForecastUsd, 10);
  assert.equal(reconciled.observed.forecastErrorRatio, 0.5);
  assert.equal(reconciled.observed.basedOnCertificateId, cert.certificateId);
  // Original certificate is untouched.
  assert.equal(cert.observed, null);
});
