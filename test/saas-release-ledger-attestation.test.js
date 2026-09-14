import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { SaasReleaseLedger } from '../src/factories/saas-release-ledger.js';
import { buildArtifactAttestation, signArtifactAttestation } from '../src/security/artifact-attestation.js';

const SOURCE_SHA = 'a'.repeat(40);
const SUBJECT_SHA = 'b'.repeat(64);

function signedAttestation(overrides = {}) {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const attestation = buildArtifactAttestation({
    subject: { name: 'release.tar.gz', sha256: SUBJECT_SHA },
    sourceSha: SOURCE_SHA,
    ...overrides
  });
  return signArtifactAttestation(attestation, privateKey);
}

test('records a release entry carrying a signed attestation and its digest', () => {
  const ledger = new SaasReleaseLedger();
  const attestation = signedAttestation();
  const entry = ledger.record({ productKey: 'p', kind: 'deploy', commitSha: SOURCE_SHA, attestation });
  assert.equal(entry.attestationDigest, attestation.digest);
});

test('rejects an unsigned attestation on record', () => {
  const ledger = new SaasReleaseLedger();
  const attestation = buildArtifactAttestation({
    subject: { name: 'release.tar.gz', sha256: SUBJECT_SHA },
    sourceSha: SOURCE_SHA
  });
  assert.throws(() => ledger.record({ productKey: 'p', kind: 'deploy', commitSha: SOURCE_SHA, attestation }), /signed/);
});

test('rejects an attestation whose sourceSha does not match the release commitSha', () => {
  const ledger = new SaasReleaseLedger();
  const attestation = signedAttestation();
  assert.throws(
    () => ledger.record({ productKey: 'p', kind: 'deploy', commitSha: 'c'.repeat(40), attestation }),
    /sourceSha does not match/
  );
});

test('release entries without an attestation are still accepted (attestationDigest null)', () => {
  const ledger = new SaasReleaseLedger();
  const entry = ledger.record({ productKey: 'p', kind: 'deploy', commitSha: SOURCE_SHA });
  assert.equal(entry.attestationDigest, null);
});
