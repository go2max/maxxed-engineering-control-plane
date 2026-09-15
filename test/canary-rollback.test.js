import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CanaryRollbackController } from '../src/economics/canary-rollback.js';

test('rollback threshold triggers on canary regression', () => {
  const controller = new CanaryRollbackController({ observationWindowMs: 10_000, regressionMultiplierThreshold: 1.5 });
  controller.start({ candidateSha: 'a'.repeat(40), certificateId: 'cert-1', forecastMonthlyDeltaUsd: 10, now: 0 });
  const result = controller.observe('a'.repeat(40), { observedMonthlyDeltaUsd: 20, now: 1000 }); // 2x forecast > 1.5x threshold
  assert.equal(result.state, 'ROLLBACK_TRIGGERED');
  assert.equal(result.rollbackReason, 'forecast-multiplier-exceeded');
});

test('canary within threshold completes as OBSERVED_WITHIN_THRESHOLD after the window elapses', () => {
  const controller = new CanaryRollbackController({ observationWindowMs: 5000, regressionMultiplierThreshold: 1.5 });
  controller.start({ candidateSha: 'b'.repeat(40), certificateId: 'cert-2', forecastMonthlyDeltaUsd: 10, now: 0 });
  controller.observe('b'.repeat(40), { observedMonthlyDeltaUsd: 11, now: 1000 });
  const result = controller.observe('b'.repeat(40), { observedMonthlyDeltaUsd: 11, now: 6000 });
  assert.equal(result.state, 'OBSERVED_WITHIN_THRESHOLD');
});

test('absolute cap triggers rollback independent of forecast multiplier', () => {
  const controller = new CanaryRollbackController({ observationWindowMs: 10_000, regressionMultiplierThreshold: 10, absoluteCapUsd: 50 });
  controller.start({ candidateSha: 'c'.repeat(40), certificateId: 'cert-3', forecastMonthlyDeltaUsd: 5, now: 0 });
  const result = controller.observe('c'.repeat(40), { observedMonthlyDeltaUsd: 60, now: 500 });
  assert.equal(result.state, 'ROLLBACK_TRIGGERED');
  assert.equal(result.rollbackReason, 'absolute-cap-exceeded');
});
