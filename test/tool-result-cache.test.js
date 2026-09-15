import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolResultCache, toolCacheKey } from '../src/leverage/tool-result-cache.js';

test('identical reads hit the cache without invoking the loader again', async () => {
  const cache = new ToolResultCache();
  let calls = 0;
  const load = async () => { calls += 1; return { sha: 'abc123' }; };
  const first = await cache.getOrLoad({ tool: 'repo.headSha', scope: { repo: 'r1' }, params: {} }, load);
  const second = await cache.getOrLoad({ tool: 'repo.headSha', scope: { repo: 'r1' }, params: {} }, load);
  assert.equal(calls, 1);
  assert.equal(first.hit, false);
  assert.equal(second.hit, true);
  assert.deepEqual(second.value, { sha: 'abc123' });
});

test('concurrent identical requests coalesce into a single underlying read (singleflight)', async () => {
  const cache = new ToolResultCache();
  let calls = 0;
  const load = async () => { calls += 1; await new Promise((r) => setTimeout(r, 10)); return { value: calls }; };
  const input = { tool: 'issue.state', scope: { repo: 'r1' }, params: { number: 65 } };
  const [a, b, c] = await Promise.all([cache.getOrLoad(input, load), cache.getOrLoad(input, load), cache.getOrLoad(input, load)]);
  assert.equal(calls, 1);
  assert.equal([a, b, c].filter((r) => r.coalesced).length, 2);
  assert.deepEqual(a.value, { value: 1 });
  assert.deepEqual(b.value, { value: 1 });
  assert.deepEqual(c.value, { value: 1 });
});

test('scope fingerprint change forces a fresh load instead of reusing a stale scope', async () => {
  const cache = new ToolResultCache();
  let calls = 0;
  const load = async () => { calls += 1; return { calls }; };
  const input = { tool: 'file.read', scope: { repo: 'r1' }, params: { path: 'a.js' } };
  await cache.getOrLoad(input, load, { scopeFingerprint: 'sha-1' });
  const second = await cache.getOrLoad(input, load, { scopeFingerprint: 'sha-2' });
  assert.equal(calls, 2);
  assert.equal(second.hit, false);
});

test('ttl expiry forces a re-fetch', async () => {
  const cache = new ToolResultCache({ defaultTtlMs: 5 });
  let calls = 0;
  const load = async () => { calls += 1; return { calls }; };
  const input = { tool: 'x', scope: {}, params: {} };
  await cache.getOrLoad(input, load, { now: 0 });
  const stale = await cache.getOrLoad(input, load, { now: 1000 });
  assert.equal(calls, 2);
  assert.equal(stale.hit, false);
});

test('tags and scope invalidation evict matching entries', async () => {
  const cache = new ToolResultCache();
  await cache.getOrLoad({ tool: 'a', scope: {}, params: {} }, async () => 1, { tags: ['repo:r1'] });
  await cache.getOrLoad({ tool: 'b', scope: {}, params: {} }, async () => 2, { scopeFingerprint: 'sha-9' });
  assert.equal(cache.invalidateTags(['repo:r1']), 1);
  assert.equal(cache.invalidateScope('sha-9'), 1);
  assert.equal(cache.entries.size, 0);
});

test('verify quarantines a tampered/corrupted entry', async () => {
  const cache = new ToolResultCache();
  const key = toolCacheKey({ tool: 'a', scope: {}, params: {} });
  await cache.getOrLoad(key, async () => ({ n: 1 }));
  const row = cache.entries.get(key);
  row.value = { n: 999 }; // simulate corruption without recomputing checksum
  const result = cache.verify(key);
  assert.equal(result.ok, false);
  assert.equal(result.quarantined, true);
  assert.equal(cache.entries.has(key), false);
  assert.equal(cache.stats.quarantined, 1);
});

test('an unscoped entry does not satisfy a scoped lookup (security review finding 5)', async () => {
  const cache = new ToolResultCache();
  let calls = 0;
  const load = async () => { calls += 1; return { calls }; };
  const input = { tool: 'file.read', scope: { repo: 'r1' }, params: { path: 'a.js' } };
  // Stored without a scopeFingerprint, as every current caller does.
  await cache.getOrLoad(input, load);
  assert.equal(calls, 1);
  // A future scoped lookup must NOT be served the unscoped entry.
  const scoped = await cache.getOrLoad(input, load, { scopeFingerprint: 'sha-1' });
  assert.equal(calls, 2);
  assert.equal(scoped.hit, false);
});

test('a scoped entry does not satisfy a differently-scoped or unscoped lookup', async () => {
  const cache = new ToolResultCache();
  let calls = 0;
  const load = async () => { calls += 1; return { calls }; };
  const input = { tool: 'file.read', scope: { repo: 'r1' }, params: { path: 'a.js' } };
  await cache.getOrLoad(input, load, { scopeFingerprint: 'sha-1' });
  assert.equal(calls, 1);
  // An unscoped lookup must not be served the scoped entry.
  const unscoped = await cache.getOrLoad(input, load);
  assert.equal(calls, 2);
  assert.equal(unscoped.hit, false);
});

test('a tampered snapshot entry is dropped on restore, not loaded (security review finding 6)', async () => {
  const cache = new ToolResultCache();
  await cache.getOrLoad({ tool: 'good', scope: {}, params: {} }, async () => ({ n: 1 }));
  await cache.getOrLoad({ tool: 'poisoned', scope: {}, params: {} }, async () => ({ n: 2 }));
  const snap = cache.snapshot();
  const poisonedKey = toolCacheKey({ tool: 'poisoned', scope: {}, params: {} });
  const poisonedRow = snap.entries.find((row) => row.key === poisonedKey);
  // Simulate a snapshot poisoned/corrupted outside this process: value and checksum disagree.
  poisonedRow.value = { n: 999 };

  const restored = new ToolResultCache();
  restored.restore(snap);
  assert.equal(restored.entries.size, 1);
  assert.equal(restored.entries.has(poisonedKey), false);
  const goodKey = toolCacheKey({ tool: 'good', scope: {}, params: {} });
  assert.equal(restored.entries.has(goodKey), true);
  assert.equal(restored.stats.quarantined, 1);
});

test('eviction is recency-based (LRU), not insertion-order (FIFO), on overflow (issue #94 harvest)', async () => {
  const cache = new ToolResultCache({ maxEntries: 2 });
  const load = async (n) => ({ n });
  await cache.getOrLoad('a', () => load(1));
  await cache.getOrLoad('b', () => load(2));
  // Re-reading 'a' makes it more recently used than 'b', even though 'a' was written first.
  const hitA = await cache.getOrLoad('a', () => load(1));
  assert.equal(hitA.hit, true);
  // Inserting a third entry must evict 'b' (the true LRU entry), not 'a' (insertion order
  // would have evicted 'a' as the oldest write).
  await cache.getOrLoad('c', () => load(3));
  assert.equal(cache.entries.has('a'), true);
  assert.equal(cache.entries.has('b'), false);
  assert.equal(cache.entries.has('c'), true);
});

test('snapshot/restore round-trips entries and stats', async () => {
  const cache = new ToolResultCache();
  await cache.getOrLoad({ tool: 'a', scope: {}, params: {} }, async () => 1);
  const snap = cache.snapshot();
  const restored = new ToolResultCache();
  restored.restore(snap);
  assert.equal(restored.entries.size, 1);
  assert.equal(restored.stats.misses, 1);
});
