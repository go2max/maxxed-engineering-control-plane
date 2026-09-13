import { createHash } from 'node:crypto';

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

export class VerificationLedger {
  constructor({ maxEntries = 10_000 } = {}) {
    this.maxEntries = maxEntries;
    this.entries = [];
    this.sequence = 0;
  }

  record({ taskKey, kind, verdict = null, action = null, evidenceDigest = null, relatedTaskKey = null, metadata = {} } = {}, now = Date.now()) {
    if (!taskKey || !kind) throw new Error('taskKey and kind are required');
    const entry = {
      sequence: ++this.sequence,
      taskKey,
      kind,
      verdict,
      action,
      evidenceDigest,
      relatedTaskKey,
      metadata: structuredClone(metadata),
      occurredAt: now
    };
    entry.recordDigest = digest(entry);
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries);
    return structuredClone(entry);
  }

  forTask(taskKey) { return this.entries.filter((entry) => entry.taskKey === taskKey).map((entry) => structuredClone(entry)); }
  list({ afterSequence = 0, limit = 200 } = {}) { return this.entries.filter((entry) => entry.sequence > afterSequence).slice(0, Math.max(1, Math.min(1000, limit))).map((entry) => structuredClone(entry)); }
  snapshot() { return { version: 1, maxEntries: this.maxEntries, sequence: this.sequence, entries: this.entries }; }
  restore(snapshot) {
    if (!snapshot || snapshot.version !== 1) throw new Error('unsupported verification ledger snapshot');
    this.maxEntries = Number(snapshot.maxEntries ?? this.maxEntries);
    this.sequence = Number(snapshot.sequence ?? 0);
    this.entries = (snapshot.entries ?? []).map((entry) => structuredClone(entry));
  }
}
