import { createHash } from 'node:crypto';

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

export class SaasReleaseLedger {
  constructor({ maxEntries = 10_000 } = {}) {
    this.maxEntries = maxEntries;
    this.entries = [];
    this.sequence = 0;
  }

  record({ productKey, kind, runId = null, specDigest = null, commitSha = null, deploymentId = null, status = null, metadata = {}, attestation = null } = {}, now = Date.now()) {
    if (!productKey || !kind) throw new Error('productKey and kind are required');
    if (attestation != null) {
      // Provenance gate: a release ledger entry that carries an attestation must reference a
      // *signed* one (see src/security/artifact-attestation.js). This does not itself verify the
      // signature against a trust root (no key material is available at the ledger layer) — that
      // belongs to the deploy/release pipeline before it calls record(). This check only prevents
      // an unsigned or malformed attestation from being silently accepted into the ledger.
      if (!attestation.statement || !attestation.digest) throw new Error('attestation must include statement and digest');
      if (!attestation.signature || attestation.algorithm !== 'ed25519') throw new Error('attestation must be signed (ed25519) before it can be recorded');
      if (commitSha && attestation.statement.sourceSha && String(attestation.statement.sourceSha).toLowerCase() !== String(commitSha).toLowerCase()) {
        throw new Error('attestation sourceSha does not match release commitSha');
      }
    }
    const entry = {
      sequence: ++this.sequence,
      productKey,
      kind,
      runId,
      specDigest,
      commitSha,
      deploymentId,
      status,
      metadata: structuredClone(metadata),
      attestationDigest: attestation ? attestation.digest : null,
      occurredAt: now
    };
    entry.recordDigest = digest(entry);
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries);
    return structuredClone(entry);
  }

  forProduct(productKey) { return this.entries.filter((entry) => entry.productKey === productKey).map((entry) => structuredClone(entry)); }
  latest(productKey, kind = null) {
    return [...this.entries].reverse().find((entry) => entry.productKey === productKey && (!kind || entry.kind === kind)) ?? null;
  }
  list() { return this.entries.map((entry) => structuredClone(entry)); }
  snapshot() { return { version: 1, maxEntries: this.maxEntries, sequence: this.sequence, entries: this.entries }; }
  restore(snapshot) {
    if (!snapshot || snapshot.version !== 1) throw new Error('unsupported SaaS release ledger snapshot');
    this.maxEntries = Number(snapshot.maxEntries ?? this.maxEntries);
    this.sequence = Number(snapshot.sequence ?? 0);
    this.entries = (snapshot.entries ?? []).map((entry) => structuredClone(entry));
  }
}
