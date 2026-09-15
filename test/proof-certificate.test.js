import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceBundle } from '../src/verification/evidence-bundle.js';
import {
  issueProofCertificate, verifyCertificateIntegrity, certificateFingerprint,
  CertificateCache, EvidenceGraph, EvidenceNodeKind, EvidenceComposability
} from '../src/verification/proof-certificate.js';

const SHA = 'a'.repeat(40);

function baseCertificateInput(overrides = {}) {
  const evidenceBundle = buildEvidenceBundle({ taskKey: 'shard-1', evidence: { artifacts: { commitSha: SHA } } });
  return {
    evidenceBundle,
    sourceSha: SHA,
    mutationDigest: 'mutation-digest-1',
    environmentFingerprint: 'env-v1',
    policyVersion: 'policy-v1',
    executorId: 'agent-1',
    verifierId: 'verifier-1',
    acceptanceContractDigest: 'contract-1',
    checks: {
      tests: [{ name: 'unit', passed: true, verifiedBy: 'verifier-1' }],
      structural: [{ name: 'lint', passed: true, verifiedBy: 'verifier-1' }]
    },
    ...overrides
  };
}

test('exact identical shard reuses compatible deterministic validation certificate', () => {
  const cache = new CertificateCache();
  const certificate = issueProofCertificate(baseCertificateInput());
  cache.put(certificate);
  const fingerprint = certificateFingerprint({
    sourceSha: SHA, mutationDigest: 'mutation-digest-1', environmentFingerprint: 'env-v1',
    policyVersion: 'policy-v1', executorId: 'agent-1', verifierId: 'verifier-1', acceptanceContractDigest: 'contract-1'
  });
  const result = cache.tryReuse(fingerprint);
  assert.equal(result.reused, true);
  assert.equal(result.certificate.fingerprint, certificate.fingerprint);
});

test('source/policy/toolchain mismatch forces revalidation', () => {
  const cache = new CertificateCache();
  cache.put(issueProofCertificate(baseCertificateInput()));
  const mismatchedPolicy = certificateFingerprint({
    sourceSha: SHA, mutationDigest: 'mutation-digest-1', environmentFingerprint: 'env-v1',
    policyVersion: 'policy-v2', executorId: 'agent-1', verifierId: 'verifier-1', acceptanceContractDigest: 'contract-1'
  });
  assert.equal(cache.tryReuse(mismatchedPolicy).reused, false);

  const mismatchedEnv = certificateFingerprint({
    sourceSha: SHA, mutationDigest: 'mutation-digest-1', environmentFingerprint: 'env-v2',
    policyVersion: 'policy-v1', executorId: 'agent-1', verifierId: 'verifier-1', acceptanceContractDigest: 'contract-1'
  });
  assert.equal(cache.tryReuse(mismatchedEnv).reused, false);

  const mismatchedSha = certificateFingerprint({
    sourceSha: 'b'.repeat(40), mutationDigest: 'mutation-digest-1', environmentFingerprint: 'env-v1',
    policyVersion: 'policy-v1', executorId: 'agent-1', verifierId: 'verifier-1', acceptanceContractDigest: 'contract-1'
  });
  assert.equal(cache.tryReuse(mismatchedSha).reused, false);
});

test('tampered certificate fails closed', () => {
  const cache = new CertificateCache();
  const certificate = issueProofCertificate(baseCertificateInput());
  cache.put(certificate);
  const tampered = { ...certificate, accepted: true, checks: { ...certificate.checks, tests: [{ name: 'unit', passed: false }] } };
  assert.equal(verifyCertificateIntegrity(tampered), false);
  cache.byFingerprint.set(certificate.fingerprint, tampered); // simulate storage-layer tamper
  const result = cache.tryReuse({ fingerprint: certificate.fingerprint });
  assert.equal(result.reused, false);
  assert.equal(result.reason, 'tamper-detected');
});

test('composition preserves child certificate lineage', () => {
  const graph = new EvidenceGraph();
  graph.addNode({ id: 'intent-1', kind: EvidenceNodeKind.INTENT });
  graph.addNode({ id: 'packet-1', kind: EvidenceNodeKind.WORK_PACKET, parents: ['intent-1'] });
  graph.addNode({ id: 'shard-1', kind: EvidenceNodeKind.SHARD, parents: ['packet-1'] });
  graph.addNode({ id: 'patch-1', kind: EvidenceNodeKind.PATCH, parents: ['shard-1'] });
  graph.addNode({ id: 'sha-1', kind: EvidenceNodeKind.CANDIDATE_SHA, parents: ['patch-1'] });

  const cache = new CertificateCache();
  const certificate = issueProofCertificate(baseCertificateInput());
  cache.put(certificate);
  graph.addNode({ id: 'validation-1', kind: EvidenceNodeKind.VALIDATION_EVIDENCE, parents: ['sha-1', 'shard-1'], data: { certificateFingerprint: certificate.fingerprint } });
  graph.addNode({ id: 'artifact-1', kind: EvidenceNodeKind.ARTIFACT, parents: ['validation-1'] });
  graph.addNode({ id: 'merge-1', kind: EvidenceNodeKind.MERGE, parents: ['artifact-1'] });
  graph.addNode({ id: 'release-1', kind: EvidenceNodeKind.RELEASE, parents: ['merge-1'] });

  const lineage = graph.lineage('release-1').map((node) => node.id);
  assert.ok(lineage.includes('shard-1'));
  assert.ok(lineage.includes('patch-1'));
  assert.ok(lineage.includes('validation-1'));

  const coverage = graph.evidenceCoverage('release-1', { certificateCache: cache });
  assert.equal(coverage.readyForRelease, true);
  assert.equal(coverage.missingProofReasons.length, 0);
});

test('integration-only checks are not incorrectly reused as shard-local proof', () => {
  const cache = new CertificateCache();
  const certificate = issueProofCertificate(baseCertificateInput({ composability: EvidenceComposability.INTEGRATION_ONLY }));
  cache.put(certificate);
  const result = cache.tryReuse({ fingerprint: certificate.fingerprint }, { requireComposable: true });
  assert.equal(result.reused, false);
  assert.equal(result.reason, 'integration-only-evidence-not-reusable-as-shard-proof');
});

test('agent self-report without external evidence cannot mark accepted', () => {
  const certificate = issueProofCertificate(baseCertificateInput({
    checks: { tests: [{ name: 'unit', passed: true, selfReported: true }] }
  }));
  assert.equal(certificate.hasExternalEvidence, false);
  assert.equal(certificate.accepted, false);
});

test('a check claimed verified by the executor itself is rejected as non-independent', () => {
  assert.throws(() => issueProofCertificate(baseCertificateInput({
    checks: { tests: [{ name: 'unit', passed: true, verifiedBy: 'agent-1' }] }
  })));
});

test('missing validation-evidence node surfaces missing-proof reason to release authority', () => {
  const graph = new EvidenceGraph();
  graph.addNode({ id: 'intent-1', kind: EvidenceNodeKind.INTENT });
  graph.addNode({ id: 'shard-1', kind: EvidenceNodeKind.SHARD, parents: ['intent-1'] });
  graph.addNode({ id: 'merge-1', kind: EvidenceNodeKind.MERGE, parents: ['shard-1'] });
  graph.addNode({ id: 'release-1', kind: EvidenceNodeKind.RELEASE, parents: ['merge-1'] });
  const coverage = graph.evidenceCoverage('release-1');
  assert.equal(coverage.readyForRelease, false);
  assert.equal(coverage.missingProofReasons[0].nodeId, 'shard-1');
});

test('narrow invalidation only affects the changed fingerprint', () => {
  const cache = new CertificateCache();
  const certificateA = issueProofCertificate(baseCertificateInput());
  const certificateB = issueProofCertificate(baseCertificateInput({ mutationDigest: 'mutation-digest-2' }));
  cache.put(certificateA);
  cache.put(certificateB);
  cache.invalidate(certificateA.fingerprint, 'source-changed');
  assert.equal(cache.get(certificateA.fingerprint), null);
  assert.notEqual(cache.get(certificateB.fingerprint), null);
});
