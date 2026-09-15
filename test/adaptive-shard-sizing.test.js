import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveShardSizer } from '../src/patch/adaptive-shard-sizing.js';

test('stronger executor with strong history receives a larger safe shard than a novel/risky task', () => {
  const sizer = new AdaptiveShardSizer({ minLines: 40, baselineTargetLines: 250, maxLines: 1200 });
  for (let i = 0; i < 30; i += 1) {
    sizer.recordOutcome({ executorId: 'exec-strong', taskClass: 'refactor', shardLines: 400 + i, outcome: 'accepted' });
  }
  const strong = sizer.recommend({
    executorId: 'exec-strong', taskClass: 'refactor',
    novelty: 0.1, dependencyDepth: 1, mutationSurface: 0.2, contextEntropy: 0.2, verifierCost: 0.2
  });
  const risky = sizer.recommend({
    executorId: 'exec-new', taskClass: 'refactor',
    novelty: 0.9, dependencyDepth: 6, mutationSurface: 0.9, contextEntropy: 0.8, verifierCost: 0.8
  });

  assert.ok(strong.targetLines > risky.targetLines, `expected strong.targetLines(${strong.targetLines}) > risky.targetLines(${risky.targetLines})`);
  assert.equal(risky.decomposeFurther, true);
  assert.equal(strong.decomposeFurther, false);
});

test('a risky/novel task is recommended for further decomposition even with no history', () => {
  const sizer = new AdaptiveShardSizer();
  const rec = sizer.recommend({ executorId: 'exec-unknown', taskClass: 'security-patch', novelty: 0.95, dependencyDepth: 7, mutationSurface: 0.9, contextEntropy: 0.9, verifierCost: 0.9 });
  assert.equal(rec.decomposeFurther, true);
  assert.ok(rec.targetLines <= sizer.baselineTargetLines);
});

test('shard-size outcomes feed back into the learning store and shift future recommendations', () => {
  const sizer = new AdaptiveShardSizer();
  const before = sizer.recommend({ executorId: 'exec-1', taskClass: 'bugfix', novelty: 0.3, dependencyDepth: 1, mutationSurface: 0.3, contextEntropy: 0.3, verifierCost: 0.3 });
  for (let i = 0; i < 20; i += 1) sizer.recordOutcome({ executorId: 'exec-1', taskClass: 'bugfix', shardLines: 300, outcome: 'accepted' });
  const after = sizer.recommend({ executorId: 'exec-1', taskClass: 'bugfix', novelty: 0.3, dependencyDepth: 1, mutationSurface: 0.3, contextEntropy: 0.3, verifierCost: 0.3 });
  assert.ok(after.targetLines >= before.targetLines);
  assert.equal(sizer.statsFor('exec-1', 'bugfix').acceptedRuns, 20);
});

test('snapshot/restore round-trips learned stats', () => {
  const sizer = new AdaptiveShardSizer();
  sizer.recordOutcome({ executorId: 'exec-1', taskClass: 'bugfix', shardLines: 300, outcome: 'accepted' });
  sizer.recordOutcome({ executorId: 'exec-1', taskClass: 'bugfix', shardLines: 100, outcome: 'failed' });
  const snap = sizer.snapshot();
  const restored = new AdaptiveShardSizer();
  restored.restore(snap);
  assert.deepEqual(restored.statsFor('exec-1', 'bugfix'), sizer.statsFor('exec-1', 'bugfix'));
});
