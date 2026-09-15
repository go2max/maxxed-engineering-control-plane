import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseCostLens, aiSpendLens, scheduledWorkLens, thirdPartyApiLens, storageEgressLens, fleetSizingLens, runAllLenses, costPerAcceptedCapability } from '../src/economics/cost-lenses.js';

test('database cost lens escalates on new table scans', () => {
  assert.equal(databaseCostLens({ dbScansDelta: 1 }).escalate, true);
  assert.equal(databaseCostLens({ dbScansDelta: 0, dbReadsDelta: 10 }).escalate, false);
});

test('ai spend lens escalates on material premium-model spend', () => {
  assert.equal(aiSpendLens({ modelTokenSpendDeltaUsd: 20 }).escalate, true);
  assert.equal(aiSpendLens({ modelTokenSpendDeltaUsd: 0.1, callsPerRequest: 1 }).escalate, false);
});

test('scheduled-work lens escalates when frequency and duration both increase', () => {
  assert.equal(scheduledWorkLens({ frequencyPerMonthDelta: 100, jobDurationMsDelta: 200 }).escalate, true);
});

test('third-party API lens escalates on thin rate-limit headroom', () => {
  assert.equal(thirdPartyApiLens({ rateLimitHeadroomRatio: 1.05 }).escalate, true);
});

test('storage/egress lens escalates on material growth', () => {
  assert.equal(storageEgressLens({ storageGrowthBytesPerMonth: 100 * 1024 ** 3 }).escalate, true);
});

test('fleet sizing lens escalates on large fan-out increases', () => {
  assert.equal(fleetSizingLens({ workerFanOutDelta: 10 }).escalate, true);
});

test('runAllLenses aggregates escalation across every lens', () => {
  const report = runAllLenses({ database: { dbScansDelta: 1 } });
  assert.equal(report.escalate, true);
  assert.equal(report.lenses.length, 6);
});

test('cost-per-accepted-capability is a first-class metric', () => {
  const metric = costPerAcceptedCapability({ totalMonthlyDeltaUsd: 100, acceptedCapabilitiesCount: 4 });
  assert.equal(metric.costPerAcceptedCapabilityUsd, 25);
  assert.equal(costPerAcceptedCapability({ totalMonthlyDeltaUsd: 100, acceptedCapabilitiesCount: 0 }).costPerAcceptedCapabilityUsd, null);
});
