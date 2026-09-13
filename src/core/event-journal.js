import { createHash } from 'node:crypto';

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

export class EventJournal {
  constructor({ maxEntries = 10_000 } = {}) {
    this.maxEntries = maxEntries;
    this.entries = [];
    this.sequence = 0;
    this.idempotency = new Map();
  }

  append(type, payload = {}, now = Date.now()) {
    if (!type) throw new Error('event type is required');
    const entry = {
      sequence: ++this.sequence,
      type,
      occurredAt: now,
      payload: structuredClone(payload),
      payloadDigest: digest(payload)
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries);
    return structuredClone(entry);
  }

  once(key, request, producer) {
    if (!key) return producer();
    const requestDigest = digest(request);
    const existing = this.idempotency.get(key);
    if (existing) {
      if (existing.requestDigest !== requestDigest) throw new Error('idempotency key reused with different request');
      return structuredClone(existing.result);
    }
    const result = producer();
    if (result instanceof Promise) {
      return result.then((resolved) => {
        this.idempotency.set(key, { requestDigest, result: structuredClone(resolved) });
        return resolved;
      });
    }
    this.idempotency.set(key, { requestDigest, result: structuredClone(result) });
    return result;
  }

  list({ afterSequence = 0, limit = 200 } = {}) {
    return this.entries.filter((entry) => entry.sequence > afterSequence).slice(0, Math.max(1, Math.min(1000, limit))).map((entry) => structuredClone(entry));
  }

  snapshot() {
    return { version: 1, maxEntries: this.maxEntries, sequence: this.sequence, entries: this.entries, idempotency: [...this.idempotency.entries()] };
  }

  restore(snapshot) {
    if (!snapshot || snapshot.version !== 1) throw new Error('unsupported event journal snapshot');
    this.maxEntries = Number(snapshot.maxEntries ?? this.maxEntries);
    this.sequence = Number(snapshot.sequence ?? 0);
    this.entries = (snapshot.entries ?? []).map((entry) => structuredClone(entry));
    this.idempotency = new Map((snapshot.idempotency ?? []).map(([key, value]) => [key, structuredClone(value)]));
  }
}
