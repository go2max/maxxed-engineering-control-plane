import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HorizonCompressionEngine } from '../src/patch/horizon-compression.js';
import { AdaptiveShardSizer } from '../src/patch/adaptive-shard-sizing.js';

test('a novel/high-risk packet with a large tool-call count exceeds its reliable horizon and is routed to decompose', () => {
  const engine = new HorizonCompressionEngine();
  const { prediction, decision } = engine.evaluate({
    modelId: 'model-mid', taskClass: 'refactor',
    novelty: 0.9, dependencyDepth: 7, mutationSurface: 0.9, repoEntropy: 0.9,
    toolCallCount: 50, expectedVerificationCost: 0.9
  });
  assert.equal(prediction.exceedsHorizon, true);
  assert.equal(decision.action, 'decompose');
});

test('a low-risk, well-proven packet within its tool-call budget is admitted', () => {
  const engine = new HorizonCompressionEngine();
  for (let i = 0; i < 30; i += 1) {
    engine.sizer.recordOutcome({ executorId: 'model-strong', taskClass: 'bugfix', shardLines: 400, outcome: 'accepted' });
  }
  const { prediction, decision } = engine.evaluate({
    modelId: 'model-strong', taskClass: 'bugfix',
    novelty: 0.1, dependencyDepth: 1, mutationSurface: 0.1, repoEntropy: 0.1,
    toolCallCount: 3, expectedVerificationCost: 0.1
  });
  assert.equal(prediction.exceedsHorizon, false);
  assert.equal(decision.action, 'admit');
});

test('hard loop prevention: once maxDecompositionDepth is reached, decomposition is refused and escalation is forced', () => {
  const engine = new HorizonCompressionEngine({ maxDecompositionDepth: 2 });
  const input = {
    modelId: 'model-weak', taskClass: 'security-patch',
    novelty: 0.95, dependencyDepth: 8, mutationSurface: 0.95, repoEntropy: 0.9,
    toolCallCount: 60, expectedVerificationCost: 0.9
  };

  const first = engine.evaluate({ ...input, decompositionDepth: 0 });
  assert.equal(first.decision.action, 'decompose');

  const second = engine.evaluate({ ...input, decompositionDepth: 1 });
  assert.equal(second.decision.action, 'decompose');

  const third = engine.evaluate({ ...input, decompositionDepth: 2 });
  assert.equal(third.prediction.loopBoundHit, true);
  assert.equal(third.decision.action, 'escalate-model');
  assert.equal(third.decision.reason, 'max-decomposition-depth-reached');
});

test('predicted-vs-actual is persisted and calibration can be computed once the actual outcome is recorded', () => {
  const engine = new HorizonCompressionEngine();
  const { prediction } = engine.evaluate({
    modelId: 'model-mid', taskClass: 'bugfix',
    novelty: 0.4, dependencyDepth: 2, mutationSurface: 0.4, repoEntropy: 0.4,
    toolCallCount: 5, expectedVerificationCost: 0.4
  });
  engine.recordPrediction({ predictionId: 'pred-1', modelId: 'model-mid', taskClass: 'bugfix', prediction });

  const beforeActual = engine.calibrationFor('pred-1');
  assert.equal(beforeActual.resolved, false);

  const calibration = engine.recordActual({ predictionId: 'pred-1', actualToolCallCount: prediction.reliableHorizon + 3, actualLines: 220, outcome: 'accepted' });
  assert.equal(calibration.resolved, true);
  assert.equal(calibration.absoluteError, 3);
  assert.equal(calibration.overPredicted, false);

  const report = engine.calibrationReport();
  assert.equal(report.resolvedCount, 1);
  assert.equal(report.acceptanceRate, 1);

  // recordActual also feeds the underlying AdaptiveShardSizer so both layers stay in sync.
  assert.equal(engine.sizer.statsFor('model-mid', 'bugfix').acceptedRuns, 1);
});

test('recordActual rejects an unknown outcome and an unknown predictionId', () => {
  const engine = new HorizonCompressionEngine();
  assert.throws(() => engine.recordActual({ predictionId: 'missing', actualToolCallCount: 1, outcome: 'accepted' }), /unknown predictionId/);

  const { prediction } = engine.evaluate({ modelId: 'm', taskClass: 't', toolCallCount: 1 });
  engine.recordPrediction({ predictionId: 'pred-x', modelId: 'm', taskClass: 't', prediction });
  assert.throws(() => engine.recordActual({ predictionId: 'pred-x', actualToolCallCount: 1, outcome: 'bogus' }), /unknown horizon outcome/);
});

test('an injected AdaptiveShardSizer instance is reused as the envelope predictor, not reimplemented', () => {
  const sizer = new AdaptiveShardSizer({ minLines: 20, baselineTargetLines: 100, maxLines: 500 });
  sizer.recordOutcome({ executorId: 'shared-model', taskClass: 'bugfix', shardLines: 90, outcome: 'accepted' });
  const engine = new HorizonCompressionEngine({ sizer });
  assert.equal(engine.sizer, sizer);
  const { prediction } = engine.evaluate({ modelId: 'shared-model', taskClass: 'bugfix', toolCallCount: 1 });
  assert.equal(prediction.envelope.sampleSize, sizer.statsFor('shared-model', 'bugfix').runs);
});

test('observed average tool-call count from prior resolved runs shifts the reliable horizon for the same model/task-class', () => {
  const engine = new HorizonCompressionEngine();
  const features = { modelId: 'model-mid', taskClass: 'bugfix', novelty: 0.3, dependencyDepth: 1, mutationSurface: 0.3, repoEntropy: 0.3, expectedVerificationCost: 0.3 };
  const before = engine.predictHorizon({ ...features, toolCallCount: 4 });

  for (let i = 0; i < 5; i += 1) {
    const { prediction } = engine.evaluate({ ...features, toolCallCount: 4 });
    engine.recordPrediction({ predictionId: `p-${i}`, modelId: 'model-mid', taskClass: 'bugfix', prediction });
    engine.recordActual({ predictionId: `p-${i}`, actualToolCallCount: 60, outcome: 'accepted' });
  }

  const after = engine.predictHorizon({ ...features, toolCallCount: 4 });
  assert.ok(after.reliableHorizon >= before.reliableHorizon, `expected after(${after.reliableHorizon}) >= before(${before.reliableHorizon})`);
  assert.notEqual(after.reliableHorizon, before.reliableHorizon);
});

test('snapshot/restore round-trips predictions, model observation history, and the underlying sizer state', () => {
  const engine = new HorizonCompressionEngine();
  const { prediction } = engine.evaluate({ modelId: 'model-a', taskClass: 'refactor', toolCallCount: 5, novelty: 0.5 });
  engine.recordPrediction({ predictionId: 'pred-1', modelId: 'model-a', taskClass: 'refactor', prediction });
  engine.recordActual({ predictionId: 'pred-1', actualToolCallCount: 8, actualLines: 150, outcome: 'accepted' });

  const snap = engine.snapshot();
  const restored = new HorizonCompressionEngine();
  restored.restore(snap);

  assert.deepEqual(restored.calibrationFor('pred-1'), engine.calibrationFor('pred-1'));
  assert.deepEqual(restored.calibrationReport(), engine.calibrationReport());
  assert.deepEqual(restored.sizer.statsFor('model-a', 'refactor'), engine.sizer.statsFor('model-a', 'refactor'));
});
