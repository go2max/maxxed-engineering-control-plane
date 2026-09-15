import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recurringCostAmplification, projectRecurringCosts, projectCompositionEconomics } from '../src/economics/recurring-cost-amplifier.js';

test('a tiny per-invocation cost becomes a material monthly delta via frequency x fan-out x retry', () => {
  const result = recurringCostAmplification({ perInvocationCostUsd: 0.0001, frequencyPerMonth: 500_000, fanOut: 10, retryMultiplier: 3 });
  assert.ok(result.estimatedMonthlyDelta > 25, `expected material delta, got ${result.estimatedMonthlyDelta}`);
});

test('projectRecurringCosts flags a tiny diff causing high-frequency recurring cost as an escalation', () => {
  const projection = projectRecurringCosts([
    { id: 'poll-loop', perInvocationCostUsd: 0.0005, frequencyPerMonth: 200_000, fanOut: 1, retryMultiplier: 1 }
  ], { escalationThresholdUsd: 25 });
  assert.equal(projection.escalate, true);
  assert.equal(projection.tinyDiffHighFrequency, true);
});

test('individually cheap shards that become expensive in composition are blocked', () => {
  const shardA = projectRecurringCosts([{ perInvocationCostUsd: 0.001, frequencyPerMonth: 1000 }], { escalationThresholdUsd: 25 });
  const shardB = projectRecurringCosts([{ perInvocationCostUsd: 0.001, frequencyPerMonth: 1000 }], { escalationThresholdUsd: 25 });
  assert.equal(shardA.escalate, false);
  assert.equal(shardB.escalate, false);
  const composition = projectCompositionEconomics([shardA, shardB], { sharedSurfaceMultiplier: 20 });
  assert.equal(composition.individuallyCheapButCompositionExpensive, true);
});

test('unchanged-cost docs-only projection stays at zero with no escalation', () => {
  const projection = projectRecurringCosts([]);
  assert.equal(projection.totalMonthlyDelta, 0);
  assert.equal(projection.escalate, false);
});
