import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EconomicVerifier, EconomicVerdict } from '../src/economics/economic-verifier.js';
import { EconomicImpactCertificate } from '../src/economics/economic-impact-certificate.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

test('no C3-C5 merge can be accepted on functional tests alone: missing certificate fails closed', () => {
  const verifier = new EconomicVerifier({ policyVersion: 'v1' });
  const result = verifier.verify({
    sourceSha: SHA_A, candidateSha: SHA_B, riskClass: 'C4',
    implementerId: 'impl-1', functionalVerifierId: 'verifier-1', economicVerifierId: 'econ-1',
    certificate: null
  });
  assert.equal(result.verdict, EconomicVerdict.REJECT);
  assert.equal(result.reason, 'missing-required-economic-certificate');
});

test('economic verifier authority must be independent of implementer/functional verifier', () => {
  const verifier = new EconomicVerifier({ policyVersion: 'v1' });
  const result = verifier.verify({
    sourceSha: SHA_A, candidateSha: SHA_B, riskClass: 'C1',
    implementerId: 'agent-x', functionalVerifierId: 'verifier-1', economicVerifierId: 'agent-x'
  });
  assert.equal(result.verdict, EconomicVerdict.REJECT);
  assert.equal(result.reason, 'economic-verifier-authority-must-be-independent');
});

test('C0-C2 merges accept without a mandatory certificate (unchanged-cost / low overhead)', () => {
  const verifier = new EconomicVerifier({ policyVersion: 'v1' });
  const result = verifier.verify({
    sourceSha: SHA_A, candidateSha: SHA_B, riskClass: 'C1',
    implementerId: 'impl-1', functionalVerifierId: 'verifier-1', economicVerifierId: 'econ-1'
  });
  assert.equal(result.verdict, EconomicVerdict.ACCEPT);
  assert.equal(result.certificateRequired, false);
});

test('a properly bound C3 certificate is accepted', () => {
  const verifier = new EconomicVerifier({ policyVersion: 'v1' });
  const cert = EconomicImpactCertificate.issue({
    sourceSha: SHA_A, candidateSha: SHA_B, policyVersion: 'v1', riskClass: 'C3',
    estimatedMonthlyDeltaUsd: 5, provenance: 'measured', confidence: 0.9
  });
  const result = verifier.verify({
    sourceSha: SHA_A, candidateSha: SHA_B, riskClass: 'C3',
    implementerId: 'impl-1', functionalVerifierId: 'verifier-1', economicVerifierId: 'econ-1',
    certificate: cert
  });
  assert.equal(result.verdict, EconomicVerdict.ACCEPT);
});

test('a certificate bound to a different candidate SHA is rejected, not silently reused', () => {
  const verifier = new EconomicVerifier({ policyVersion: 'v1' });
  const cert = EconomicImpactCertificate.issue({ sourceSha: SHA_A, candidateSha: SHA_A, policyVersion: 'v1', riskClass: 'C3', estimatedMonthlyDeltaUsd: 5 });
  const result = verifier.verify({
    sourceSha: SHA_A, candidateSha: SHA_B, riskClass: 'C3',
    implementerId: 'impl-1', functionalVerifierId: 'verifier-1', economicVerifierId: 'econ-1',
    certificate: cert
  });
  assert.equal(result.verdict, EconomicVerdict.REJECT);
  assert.equal(result.reason, 'certificate-not-bound-to-candidate');
});

test('high-risk material cost-affecting C4/C5 merge requires an observed canary before acceptance', () => {
  const verifier = new EconomicVerifier({ policyVersion: 'v1', escalationThresholdUsd: 25 });
  const cert = EconomicImpactCertificate.issue({
    sourceSha: SHA_A, candidateSha: SHA_B, policyVersion: 'v1', riskClass: 'C4',
    estimatedMonthlyDeltaUsd: 100, provenance: 'measured', confidence: 0.9
  });
  const withoutCanary = verifier.verify({
    sourceSha: SHA_A, candidateSha: SHA_B, riskClass: 'C4',
    implementerId: 'impl-1', functionalVerifierId: 'verifier-1', economicVerifierId: 'econ-1',
    certificate: cert
  });
  assert.equal(withoutCanary.verdict, EconomicVerdict.ESCALATE);

  const withCanary = verifier.verify({
    sourceSha: SHA_A, candidateSha: SHA_B, riskClass: 'C4',
    implementerId: 'impl-1', functionalVerifierId: 'verifier-1', economicVerifierId: 'econ-1',
    certificate: cert, canary: { state: 'OBSERVED_WITHIN_THRESHOLD' }
  });
  assert.equal(withCanary.verdict, EconomicVerdict.ACCEPT);
});
