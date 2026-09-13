import test from 'node:test';
import assert from 'node:assert/strict';
import { LeverageTrend } from '../src/leverage/leverage-trend.js';

test('leverage trend projects selectable ranges and derived metrics', () => {
  const trend = new LeverageTrend();
  const now = Date.UTC(2026, 8, 13, 12, 0, 0);
  trend.record({ at: now - 2 * 60 * 60 * 1000, acceptedEngineeringHours: 40, ownerHours: 0.5, elapsedHours: 1, cacheHits: 4, transformHits: 3, reasoningRuns: 3, accepted: 9, firstPassAccepted: 7, repairedAccepted: 2, failed: 1, activeConcurrency: 4 });
  trend.record({ at: now - 30 * 60 * 1000, acceptedEngineeringHours: 60, ownerHours: 0.5, elapsedHours: 0.5, cacheHits: 6, transformHits: 2, reasoningRuns: 2, accepted: 10, firstPassAccepted: 9, repairedAccepted: 1, failed: 0, activeConcurrency: 6 });
  const oneDay = trend.project({ range: '1d', now });
  assert.equal(oneDay.range, '1d');
  assert.equal(oneDay.points.length, 2);
  const last = oneDay.points.at(-1);
  assert.equal(last.leverageMultiplier, 120);
  assert.equal(last.cacheHitRate, 0.6);
  assert.equal(last.transformHitRate, 0.2);
  assert.equal(last.firstPassAcceptanceRate, 0.9);
  assert.equal(last.repairShare, 0.1);
  assert.equal(last.activeConcurrency, 6);
});

test('leverage trend excludes samples outside selected range', () => {
  const trend = new LeverageTrend();
  const now = Date.UTC(2026, 8, 13, 12, 0, 0);
  trend.record({ at: now - 2 * 24 * 60 * 60 * 1000, acceptedEngineeringHours: 100, ownerHours: 1 });
  trend.record({ at: now - 60 * 60 * 1000, acceptedEngineeringHours: 20, ownerHours: 1 });
  assert.equal(trend.project({ range: '1d', now }).points.length, 1);
  assert.equal(trend.project({ range: '3d', now }).points.length, 2);
});
