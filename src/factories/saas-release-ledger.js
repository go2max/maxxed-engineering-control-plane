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

  record({ productKey, kind, runId = null, specDigest = null, commitSha = null, deploymentId = null, status = null, metadata = {} } = {}, now = Date.now()) {
    if (!productKey || !kind) throw new Error('productKey and kind are required');
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
