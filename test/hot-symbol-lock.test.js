import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotSymbolLock } from '../src/patch/hot-symbol-lock.js';

test('disjoint shards compose without repo-wide serialization (cold identifiers never block)', () => {
  const lock = new HotSymbolLock({ hotThreshold: 100 });
  const a = lock.acquire('shard-a', { scope: { files: ['a.js'], symbols: [] } });
  const b = lock.acquire('shard-b', { scope: { files: ['b.js'], symbols: [] } });
  assert.equal(a.acquired, true);
  assert.equal(b.acquired, true);
  assert.deepEqual(a.hotIdentifiers, []);
  assert.deepEqual(b.hotIdentifiers, []);
});

test('a hot file serializes competing shards without locking the whole repo', () => {
  const lock = new HotSymbolLock({ hotThreshold: 2, hotWindow: 10 });
  // Warm up the "hot" identifier so it crosses the threshold.
  lock.acquire('warm-1', { scope: { files: ['hot.js'], symbols: [] } });
  lock.release('warm-1');
  lock.acquire('warm-2', { scope: { files: ['hot.js'], symbols: [] } });
  lock.release('warm-2');

  const first = lock.acquire('shard-x', { scope: { files: ['hot.js'], symbols: [] } });
  assert.equal(first.acquired, true);
  assert.ok(first.hotIdentifiers.includes('hot.js'));

  const second = lock.acquire('shard-y', { scope: { files: ['hot.js'], symbols: [] } });
  assert.equal(second.acquired, false);
  assert.ok(second.blockedBy.includes('hot.js'));

  // An unrelated cold-file shard still proceeds immediately — no repo-wide lock.
  const unrelated = lock.acquire('shard-z', { scope: { files: ['cold.js'], symbols: [] } });
  assert.equal(unrelated.acquired, true);

  lock.release('shard-x');
  const retry = lock.acquire('shard-y', { scope: { files: ['hot.js'], symbols: [] } });
  assert.equal(retry.acquired, true);
});
