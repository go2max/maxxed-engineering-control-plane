import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CompositionTree } from '../src/patch/composition-tree.js';

test('records decomposition strategy and compares alternatives/counterfactuals', () => {
  const tree = new CompositionTree();
  const node = tree.record({
    parentTaskKey: 'task-1',
    baseSha: 'a'.repeat(40),
    strategy: 'micro-shard-8way',
    shards: [{ shardKey: 's1', estimatedLines: 100 }, { shardKey: 's2', estimatedLines: 120 }],
    projectedMs: 5000,
    alternatives: [
      { strategy: 'micro-shard-4way', shardCount: 4, projectedMs: 4000 },
      { strategy: 'single-shard', shardCount: 1, projectedMs: 9000 }
    ]
  });
  tree.updateOutcome(node.compositionDigest, { outcome: 'accepted', actualMs: 4800 });
  const comparison = tree.compareAlternatives(node.compositionDigest);
  assert.equal(comparison.ranked[0].strategy, 'micro-shard-4way');
  assert.equal(comparison.chosenWasBest, false);
});

test('forParent lists every recorded composition for a task', () => {
  const tree = new CompositionTree();
  tree.record({ parentTaskKey: 'task-x', baseSha: 'a'.repeat(40), strategy: 's1', shards: [] });
  tree.record({ parentTaskKey: 'task-x', baseSha: 'a'.repeat(40), strategy: 's2', shards: [{ shardKey: 'x' }] });
  assert.equal(tree.forParent('task-x').length, 2);
});
