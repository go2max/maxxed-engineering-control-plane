import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CompositionBisector } from '../src/patch/composition-bisector.js';

function bundle(shardKey, files) {
  return { shardKey, baseSha: 'a'.repeat(40), scope: { files, symbols: [], resources: [] }, dependsOn: [], writes: [] };
}

test('a failing 32-shard composition is reduced to the minimal failing subset', async () => {
  const bundles = Array.from({ length: 32 }, (_, i) => bundle(`shard-${i + 1}`, [`file-${i + 1}.js`]));
  const cursedShard = 'shard-19';
  const bisector = new CompositionBisector({ maxVerifications: 500 });
  const result = await bisector.bisect({
    bundles,
    verify: (subset) => !subset.some((bundle) => bundle.shardKey === cursedShard)
  });
  assert.deepEqual(result.minimalFailingSubset, [cursedShard]);
  assert.ok(result.verifications < bundles.length, `expected fewer verifications than linear scan (${bundles.length}), got ${result.verifications}`);
});

test('isolates a minimal interacting pair when two shards only fail together', async () => {
  const bundles = Array.from({ length: 10 }, (_, i) => bundle(`shard-${i + 1}`, [`file-${i + 1}.js`]));
  const pair = new Set(['shard-3', 'shard-7']);
  const bisector = new CompositionBisector();
  const result = await bisector.bisect({
    bundles,
    verify: (subset) => {
      const present = subset.filter((bundle) => pair.has(bundle.shardKey));
      return present.length < 2; // fails only when both interacting shards are present together
    }
  });
  assert.deepEqual(new Set(result.minimalFailingSubset), pair);
});

test('reports full-composition-passed-on-recheck when the batch no longer fails', async () => {
  const bundles = [bundle('shard-1', ['a.js']), bundle('shard-2', ['b.js'])];
  const bisector = new CompositionBisector();
  const result = await bisector.bisect({ bundles, verify: () => true });
  assert.equal(result.note, 'full-composition-passed-on-recheck');
  assert.deepEqual(result.minimalFailingSubset, []);
});
