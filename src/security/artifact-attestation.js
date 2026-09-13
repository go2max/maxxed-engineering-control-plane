import crypto from 'node:crypto';
import { digest } from '../leverage/solution-cas.js';

export function buildSbom({ product, sourceSha, components = [], generatedAt = Date.now() } = {}) {
  if (!product || !/^[0-9a-f]{40}$/i.test(String(sourceSha ?? ''))) throw new Error('product and exact sourceSha are required');
  const normalized = components.map((component) => ({
    name: String(component.name), version: component.version == null ? null : String(component.version),
    type: component.type ?? 'library', source: component.source ?? null, license: component.license ?? null,
    checksum: component.checksum ?? null
  })).sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
  const document = { format: 'maxxed-sbom-v1', product, sourceSha: String(sourceSha).toLowerCase(), components: normalized, generatedAt: Number(generatedAt) };
  return { ...document, digest: digest(document) };
}

export function buildArtifactAttestation({ subject, sourceSha, evidenceDigest, sbomDigest = null, toolchain = {}, model = null, transform = null, policyVersion = null, createdAt = Date.now() } = {}) {
  if (!subject?.name || !/^[0-9a-f]{64}$/i.test(String(subject.sha256 ?? ''))) throw new Error('attestation subject name and sha256 are required');
  if (!/^[0-9a-f]{40}$/i.test(String(sourceSha ?? ''))) throw new Error('attestation requires exact sourceSha');
  const statement = {
    version: 1,
    predicateType: 'https://maxxedtechnicalsystems.com/attestation/engineering/v1',
    subject: { name: String(subject.name), sha256: String(subject.sha256).toLowerCase() },
    sourceSha: String(sourceSha).toLowerCase(),
    evidenceDigest: evidenceDigest ?? null,
    sbomDigest,
    toolchain: structuredClone(toolchain),
    model: model ? structuredClone(model) : null,
    transform: transform ? structuredClone(transform) : null,
    policyVersion,
    createdAt: Number(createdAt)
  };
  return { statement, digest: digest(statement), signature: null, algorithm: null };
}

export function signArtifactAttestation(attestation, privateKey) {
  if (!privateKey) throw new Error('privateKey is required');
  const payload = Buffer.from(JSON.stringify(attestation.statement), 'utf8');
  const signature = crypto.sign(null, payload, privateKey).toString('base64');
  return { ...structuredClone(attestation), signature, algorithm: 'ed25519' };
}

export function verifyArtifactAttestation(attestation, publicKey) {
  if (!attestation?.signature || !publicKey) return { ok: false, reason: 'signature-or-public-key-missing' };
  const expectedDigest = digest(attestation.statement);
  if (expectedDigest !== attestation.digest) return { ok: false, reason: 'statement-digest-mismatch' };
  const ok = crypto.verify(null, Buffer.from(JSON.stringify(attestation.statement), 'utf8'), publicKey, Buffer.from(attestation.signature, 'base64'));
  return { ok, reason: ok ? 'signature-valid' : 'signature-invalid' };
}
