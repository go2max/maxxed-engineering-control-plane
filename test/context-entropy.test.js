import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreContextEntropy, splitByEntropy } from '../src/leverage/context-entropy.js';

function coherentPacket() {
  return {
    objective: 'add retry to fetch client',
    items: [
      { path: 'src/net/fetch-client.js', intentTag: 'feature', dependsOn: ['net/base'], changedAt: 1 },
      { path: 'src/net/retry.js', intentTag: 'feature', dependsOn: ['net/base'], changedAt: 1 },
      { path: 'test/net/fetch-client.test.js', intentTag: 'feature', dependsOn: ['net/fetch-client'], changedAt: 1 }
    ],
    history: [1]
  };
}

function highEntropyPacket() {
  return {
    objective: 'grab-bag change',
    items: [
      { path: 'src/net/fetch-client.js', intentTag: 'feature', dependsOn: ['net/base'], changedAt: 1 },
      { path: 'src/billing/invoice.js', intentTag: 'bugfix', dependsOn: ['billing/ledger', 'billing/tax'], changedAt: 2 },
      { path: 'src/auth/session.js', intentTag: 'refactor', dependsOn: ['auth/token', 'auth/store'], changedAt: 3 },
      { path: 'docs/CHANGELOG.md', intentTag: 'docs', dependsOn: [], changedAt: 4 },
      { path: 'vendor/generated/bundle.js', intentTag: 'chore', generated: true, changedAt: 5 },
      { path: 'src/perf/cache.js', intentTag: 'perf', dependsOn: ['perf/lru'], changedAt: 6 }
    ],
    history: [1, 2, 3, 4, 5, 6, 7, 8]
  };
}

test('scoreContextEntropy scores a coherent single-purpose packet low', () => {
  const entropy = scoreContextEntropy(coherentPacket());
  assert.equal(entropy.level, 'low');
  assert.ok(entropy.score < 0.35, `expected low score, got ${entropy.score}`);
});

test('scoreContextEntropy scores unrelated files + mixed intents + deep history + noise high', () => {
  const entropy = scoreContextEntropy(highEntropyPacket());
  assert.equal(entropy.level, 'high');
  assert.ok(entropy.score >= 0.6, `expected high score, got ${entropy.score}`);
  assert.ok(entropy.factors.mixedIntents > 0.5);
  assert.ok(entropy.factors.noiseRatio > 0);
  assert.ok(entropy.factors.historyDepth > 0.5);
});

test('splitByEntropy leaves a low-entropy packet unsplit', () => {
  const result = splitByEntropy(coherentPacket());
  assert.equal(result.split, false);
  assert.equal(result.packets.length, 1);
  assert.equal(result.packets[0].items.length, 3);
});

test('splitByEntropy actually splits a high-entropy packet into coherent sub-packets', () => {
  const packet = highEntropyPacket();
  const result = splitByEntropy(packet, { threshold: 0.6 });
  assert.equal(result.split, true);
  assert.ok(result.packets.length > 1, `expected multiple packets, got ${result.packets.length}`);

  // Every original item must be preserved across the split (no silent loss).
  const originalPaths = packet.items.map((item) => item.path).sort();
  const splitPaths = result.packets.flatMap((p) => p.items.map((item) => item.path)).sort();
  assert.deepEqual(splitPaths, originalPaths);

  // Each split packet should be more internally coherent than the source:
  // re-scoring a split sub-packet should not exceed the parent's entropy.
  for (const sub of result.packets) {
    const subEntropy = scoreContextEntropy(sub);
    assert.ok(subEntropy.score <= result.entropy.score + 1e-9,
      `sub-packet ${sub.splitKey} entropy ${subEntropy.score} exceeded parent ${result.entropy.score}`);
  }
});

test('splitByEntropy can cluster by intent instead of path', () => {
  const packet = highEntropyPacket();
  const result = splitByEntropy(packet, { threshold: 0.6, by: 'intent' });
  assert.equal(result.split, true);
  const keys = result.packets.map((p) => p.splitKey).sort();
  assert.ok(keys.length > 1);
});
