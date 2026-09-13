import { createHash } from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

export function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function solutionKey({ taskClass, normalizedSpec, dependencySlice = null, environment = null, policyVersion = null } = {}) {
  if (!taskClass) throw new Error('taskClass is required');
  if (!normalizedSpec) throw new Error('normalizedSpec is required');
  return digest({ taskClass, normalizedSpec, dependencySlice, environment, policyVersion });
}

export class SolutionCAS {
  constructor({ maxEntries = 10_000 } = {}) { this.maxEntries = Math.max(1, Number(maxEntries)); this.entries = new Map(); }

  put(input, result, { confidence = 1, reusable = true, tags = [], now = Date.now() } = {}) {
    const key = typeof input === 'string' ? input : solutionKey(input);
    const row = { key, inputDigest: typeof input === 'string' ? input : digest(input), result: structuredClone(result), confidence: Number(confidence), reusable: Boolean(reusable), tags: [...new Set(tags)].sort(), createdAt: now, hits: 0, lastHitAt: null };
    this.entries.set(key, row);
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
    return structuredClone(row);
  }

  get(input, now = Date.now()) {
    const key = typeof input === 'string' ? input : solutionKey(input);
    const row = this.entries.get(key);
    if (!row || !row.reusable) return null;
    row.hits += 1; row.lastHitAt = now;
    return structuredClone(row);
  }

  findByTag(tags = [], { minConfidence = 0.8, limit = 8 } = {}) {
    const wanted = new Set(tags);
    return [...this.entries.values()]
      .filter((row) => row.reusable && row.confidence >= minConfidence && [...wanted].every((tag) => row.tags.includes(tag)))
      .sort((a, b) => b.confidence - a.confidence || b.hits - a.hits || b.createdAt - a.createdAt)
      .slice(0, limit).map((row) => structuredClone(row));
  }

  snapshot() { return { version: 1, maxEntries: this.maxEntries, entries: [...this.entries.values()].map((row) => structuredClone(row)) }; }
  restore(snapshot) { this.maxEntries = Math.max(1, Number(snapshot?.maxEntries ?? this.maxEntries)); this.entries = new Map((snapshot?.entries ?? []).map((row) => [row.key, structuredClone(row)])); }
}
