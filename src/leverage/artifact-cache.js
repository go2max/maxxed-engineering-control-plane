import { digest } from './solution-cas.js';

export function artifactKey({ kind, inputs, toolchain = null, environment = null } = {}) {
  if (!kind) throw new Error('artifact kind is required');
  return digest({ kind, inputs, toolchain, environment });
}

export class ArtifactCache {
  constructor({ maxEntries = 50_000 } = {}) { this.maxEntries = Math.max(1, Number(maxEntries)); this.entries = new Map(); }
  put(input, artifact, { tags = [], ttlMs = null, now = Date.now() } = {}) {
    const key = typeof input === 'string' ? input : artifactKey(input);
    const row = { key, artifact: structuredClone(artifact), tags: [...new Set(tags)].sort(), createdAt: now, expiresAt: ttlMs ? now + Number(ttlMs) : null, hits: 0 };
    this.entries.set(key, row); while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value); return structuredClone(row);
  }
  get(input, now = Date.now()) {
    const key = typeof input === 'string' ? input : artifactKey(input); const row = this.entries.get(key);
    if (!row) return null; if (row.expiresAt && row.expiresAt <= now) { this.entries.delete(key); return null; }
    row.hits += 1; return structuredClone(row);
  }
  invalidateTags(tags = []) { const wanted = new Set(tags); let removed = 0; for (const [key, row] of this.entries) if (row.tags.some((tag) => wanted.has(tag))) { this.entries.delete(key); removed += 1; } return removed; }
  snapshot() { return { version: 1, maxEntries: this.maxEntries, entries: [...this.entries.values()].map(structuredClone) }; }
  restore(snapshot) { this.maxEntries = Math.max(1, Number(snapshot?.maxEntries ?? this.maxEntries)); this.entries = new Map((snapshot?.entries ?? []).map((row) => [row.key, structuredClone(row)])); }
}
