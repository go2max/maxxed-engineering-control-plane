import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EconomicLearningFeed } from '../src/economics/economic-learning-feed.js';

test('predicted-vs-observed deltas feed back and calibrate by risk class', () => {
  const feed = new EconomicLearningFeed();
  feed.record({ certificateId: 'c1', riskClass: 'C4', sourceSha: 'a'.repeat(40), candidateSha: 'b'.repeat(40), estimatedMonthlyDeltaUsd: 100, observedMonthlyDeltaUsd: 120 });
  feed.record({ certificateId: 'c2', riskClass: 'C4', sourceSha: 'a'.repeat(40), candidateSha: 'c'.repeat(40), estimatedMonthlyDeltaUsd: 50, observedMonthlyDeltaUsd: 40 });
  const calibration = feed.calibrationByRiskClass();
  assert.equal(calibration.C4.samples, 2);
  assert.ok(calibration.C4.meanAbsoluteForecastErrorRatio > 0);
});
