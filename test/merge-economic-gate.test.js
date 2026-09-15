import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMergeEconomics, isMergeCandidate, extractChangedPaths } from '../src/economics/merge-economic-gate.js';
import { MergeRiskClassifier } from '../src/economics/merge-risk-classifier.js';
import { EconomicVerifier, EconomicVerdict } from '../src/economics/economic-verifier.js';
import { EconomicImpactCertificate } from '../src/economics/economic-impact-certificate.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function riskClassifier() { return new MergeRiskClassifier(); }
function economicVerifier() { return new EconomicVerifier({ policyVersion: 'v1' }); }

test('a task with no commit SHA is not a merge candidate and the gate is a no-op', () => {
  const task = { key: 't1', metadata: { execution: { ref: SHA_A } } };
  const evidence = { producerId: 'agent-1', artifacts: {} };
  assert.equal(isMergeCandidate({ task, evidence }), false);
  assert.equal(evaluateMergeEconomics({ task, evidence, riskClassifier: riskClassifier(), economicVerifier: economicVerifier() }), null);
});

test('gate is a no-op when riskClassifier/economicVerifier are not supplied', () => {
  const task = { key: 't1', metadata: { execution: { ref: SHA_A } } };
  const evidence = { producerId: 'agent-1', artifacts: { commitSha: SHA_B } };
  assert.equal(evaluateMergeEconomics({ task, evidence }), null);
});

test('a low-risk (C1) merge accepts with no certificate at all', () => {
  const task = { key: 't1', taskClass: 'standard', metadata: { execution: { ref: SHA_A }, economics: {} } };
  const evidence = { producerId: 'agent-1', verifierId: 'verifier-1', artifacts: { commitSha: SHA_B, changedPaths: ['src/util/format.js'] } };
  const result = evaluateMergeEconomics({ task, evidence, riskClassifier: riskClassifier(), economicVerifier: economicVerifier() });
  assert.equal(result.classification.class, 'C1');
  assert.equal(result.verdict.verdict, EconomicVerdict.ACCEPT);
});

test('a C3+ merge with no bound EconomicImpactCertificate fails closed (REJECT), not silent pass', () => {
  const task = { key: 't1', taskClass: 'standard', metadata: { execution: { ref: SHA_A }, economics: {} } };
  const evidence = { producerId: 'agent-1', verifierId: 'verifier-1', artifacts: { commitSha: SHA_B, changedPaths: ['src/jobs/nightly-sync.js'], diff: '+ setInterval(() => pollExternalApi(), 1000);' } };
  const result = evaluateMergeEconomics({ task, evidence, riskClassifier: riskClassifier(), economicVerifier: economicVerifier() });
  assert.ok(['C3', 'C4', 'C5'].includes(result.classification.class), `expected C3+, got ${result.classification.class}`);
  assert.equal(result.verdict.verdict, EconomicVerdict.REJECT);
  assert.equal(result.verdict.reason, 'missing-required-economic-certificate');
});

test('a C3 merge with a validly bound certificate accepts', () => {
  const cert = EconomicImpactCertificate.issue({ sourceSha: SHA_A, candidateSha: SHA_B, policyVersion: 'v1', riskClass: 'C3', estimatedMonthlyDeltaUsd: 5, provenance: 'measured', confidence: 0.9 });
  const task = { key: 't1', taskClass: 'standard', metadata: { execution: { ref: SHA_A }, economics: { touchesScheduledWork: true, certificate: cert } } };
  const evidence = { producerId: 'agent-1', verifierId: 'verifier-1', artifacts: { commitSha: SHA_B, changedPaths: ['src/jobs/nightly-sync.js'] } };
  const result = evaluateMergeEconomics({ task, evidence, riskClassifier: riskClassifier(), economicVerifier: economicVerifier() });
  assert.equal(result.classification.class, 'C3');
  assert.equal(result.verdict.verdict, EconomicVerdict.ACCEPT);
});

test('a payment/billing-surface merge with no certificate escalates classification to C5 and fails closed', () => {
  const task = { key: 't1', taskClass: 'standard', metadata: { execution: { ref: SHA_A }, economics: {} } };
  const evidence = { producerId: 'agent-1', verifierId: 'verifier-1', artifacts: { commitSha: SHA_B, changedPaths: ['src/billing/charge-card.js'] } };
  const result = evaluateMergeEconomics({ task, evidence, riskClassifier: riskClassifier(), economicVerifier: economicVerifier() });
  assert.equal(result.classification.class, 'C5');
  assert.equal(result.verdict.verdict, EconomicVerdict.REJECT);
});

test('extractChangedPaths falls back through changedPaths -> patchBundle writes -> diff parsing', () => {
  assert.deepEqual(extractChangedPaths({ artifacts: { changedPaths: ['a.js'] } }), ['a.js']);
  assert.deepEqual(extractChangedPaths({ artifacts: { patchBundle: { writes: [{ path: 'b.js' }] } } }), ['b.js']);
  assert.deepEqual(extractChangedPaths({ artifacts: { diff: 'diff --git a/c.js b/c.js\n+x' } }), ['c.js']);
  assert.deepEqual(extractChangedPaths({}), []);
});
