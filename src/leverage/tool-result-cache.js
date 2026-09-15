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
    if (cached && (!cached.expiresAt || cached.expiresAt > now) && cached.scopeFingerprint === (scopeFingerprint ?? null)) {
      cached.hits += 1;
      this.stats.hits += 1;
      this._touch(key, cached);
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
    this.entries.delete(key); // drop any stale position before re-inserting at the MRU end
    this.entries.set(key, row);
    // Evict least-recently-used first: a Map iterates in insertion order, and _touch()
    // (below) re-inserts an entry on every hit, so the front of iteration order is always
    // the entry that has gone longest without being read or written (issue #94 harvest:
    // adapted from isaacs/node-lru-cache's recency-list technique, see
    // docs/harvest-notes/isaacs-node-lru-cache.md). Previously this evicted strict
    // insertion order (FIFO), so a hot, frequently-read entry could still be evicted ahead
    // of a stale one that just happened to be written later.
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
  }

  // Moves `key` to the most-recently-used end of iteration order without changing its
  // content, so a cache hit protects the entry from eviction the same way a write does.
  _touch(key, row) {
    this.entries.delete(key);
    this.entries.set(key, row);
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

  // Verify recomputes the content digest for a stored entry from the same in-memory `row.value`
  // that produced `row.checksum`, and quarantines (evicts) it on mismatch. This only catches
  // in-process corruption (e.g. a caller mutating a returned/stored value in place); it cannot
  // detect a value that was poisoned before checksum and value were paired up together (a
  // poisoner who controls both sets them consistently). Restore-time tamper/poisoning defense
  // against an externally-supplied snapshot is handled separately by `restore()` below, which
  // drops any entry whose checksum does not match its value instead of trusting it (issue #65,
  // section 12; security review finding 6).
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
    // Fail-closed on restore (security review finding 6): a persisted snapshot may come from
    // outside this process (disk corruption, a poisoned file). Recompute each entry's checksum
    // and drop any entry whose value doesn't match its stored checksum instead of trusting it
    // wholesale, matching CertificateCache.restore()'s pattern in proof-certificate.js.
    this.entries = new Map();
    for (const row of snapshot?.entries ?? []) {
      if (!row || typeof row.key !== 'string') continue;
      const clone = structuredClone(row);
      if (digest(clone.value) !== clone.checksum) { this.stats.quarantined += 1; continue; }
      this.entries.set(clone.key, clone);
    }
    this.inFlight = new Map();
  }
}
