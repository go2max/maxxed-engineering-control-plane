import { digest } from './solution-cas.js';

// Bounded read-only tool-result cache with singleflight coalescing (issue #65, section 4).
// Keys must bind tool + scope (repo/tenant/sensitivity) + params so a fingerprint identifies
// what was actually observed, not just a filename/branch/prompt string.
export function toolCacheKey({ tool, scope = {}, params = {} } = {}) {
  if (!tool) throw new Error('tool is required');
  return digest({ tool, scope, params });
}

export class ToolResultCache {
  constructor({ maxEntries = 20_000, defaultTtlMs = 60_000 } = {}) {
    this.maxEntries = Math.max(1, Number(maxEntries));
    this.defaultTtlMs = Number(defaultTtlMs);
    this.entries = new Map();
    this.inFlight = new Map();
    this.stats = { hits: 0, misses: 0, coalesced: 0, quarantined: 0 };
  }

  // getOrLoad resolves `input` to a cache key, returns a fresh cache hit when present and
  // in-scope, coalesces concurrent identical loads into a single underlying `loader()` call,
  // and otherwise executes `loader()` once and stores the result.
  async getOrLoad(input, loader, { ttlMs = this.defaultTtlMs, tags = [], scopeFingerprint = null, now = Date.now() } = {}) {
    if (typeof loader !== 'function') throw new Error('loader function is required');
    const key = typeof input === 'string' ? input : toolCacheKey(input);
    const cached = this.entries.get(key);
    if (cached && (!cached.expiresAt || cached.expiresAt > now) && (!scopeFingerprint || !cached.scopeFingerprint || cached.scopeFingerprint === scopeFingerprint)) {
      cached.hits += 1;
      this.stats.hits += 1;
      return { key, value: structuredClone(cached.value), hit: true, coalesced: false };
    }
    if (this.inFlight.has(key)) {
      this.stats.coalesced += 1;
      const value = await this.inFlight.get(key);
      return { key, value: structuredClone(value), hit: false, coalesced: true };
    }
    this.stats.misses += 1;
    const promise = (async () => {
      const value = await loader();
      this._store(key, value, { ttlMs, tags, scopeFingerprint, now });
      return value;
    })();
    this.inFlight.set(key, promise);
    try {
      const value = await promise;
      return { key, value: structuredClone(value), hit: false, coalesced: false };
    } finally {
      this.inFlight.delete(key);
    }
  }

  _store(key, value, { ttlMs, tags, scopeFingerprint, now }) {
    const row = {
      key,
      value: structuredClone(value),
      tags: [...new Set(tags)].sort(),
      scopeFingerprint: scopeFingerprint ?? null,
      createdAt: now,
      expiresAt: ttlMs ? now + Number(ttlMs) : null,
      hits: 0,
      checksum: digest(value)
    };
    this.entries.set(key, row);
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
  }

  peek(input, now = Date.now()) {
    const key = typeof input === 'string' ? input : toolCacheKey(input);
    const row = this.entries.get(key);
    if (!row) return null;
    if (row.expiresAt && row.expiresAt <= now) { this.entries.delete(key); return null; }
    return structuredClone(row);
  }

  invalidateTags(tags = []) {
    const wanted = new Set(tags);
    let removed = 0;
    for (const [key, row] of this.entries) if (row.tags.some((tag) => wanted.has(tag))) { this.entries.delete(key); removed += 1; }
    return removed;
  }

  invalidateScope(scopeFingerprint) {
    let removed = 0;
    for (const [key, row] of this.entries) if (row.scopeFingerprint === scopeFingerprint) { this.entries.delete(key); removed += 1; }
    return removed;
  }

  // Verify recomputes the content digest for a stored entry and quarantines (evicts) it on
  // mismatch instead of ever serving a corrupted/poisoned value (issue #65, section 12).
  verify(input) {
    const key = typeof input === 'string' ? input : toolCacheKey(input);
    const row = this.entries.get(key);
    if (!row) return { ok: true, present: false, quarantined: false };
    const expected = digest(row.value);
    if (expected !== row.checksum) {
      this.entries.delete(key);
      this.stats.quarantined += 1;
      return { ok: false, present: false, quarantined: true };
    }
    return { ok: true, present: true, quarantined: false };
  }

  snapshot() {
    return {
      version: 1,
      maxEntries: this.maxEntries,
      defaultTtlMs: this.defaultTtlMs,
      stats: { ...this.stats },
      entries: [...this.entries.values()].map((row) => structuredClone(row))
    };
  }

  restore(snapshot) {
    this.maxEntries = Math.max(1, Number(snapshot?.maxEntries ?? this.maxEntries));
    this.defaultTtlMs = Number(snapshot?.defaultTtlMs ?? this.defaultTtlMs);
    this.stats = { hits: 0, misses: 0, coalesced: 0, quarantined: 0, ...(snapshot?.stats ?? {}) };
    this.entries = new Map((snapshot?.entries ?? []).map((row) => [row.key, structuredClone(row)]));
    this.inFlight = new Map();
  }
}
