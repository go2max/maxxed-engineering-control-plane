import test from 'node:test';
import assert from 'node:assert/strict';
import {
  wilsonLowerBound,
  stageAcceptanceRatesFromOutcomeStore,
  stageRateFromWorkerPerformance,
  estimateChainReliability,
  flagUnsafeChains,
  decideDeterministicTransformFirst,
} from '../src/verification/reliability-budget.js';
import { WorkerPerformanceLedger } from '../src/scheduler/worker-performance.js';

function outcomeRecord({ verifierOutcomes }) {
  return {
    schemaVersion: 1,
    taskClass: 'coding',
    sourceFingerprint: 'repo:go2max/x@abc:issue-98',
    executor: { id: 'worker-1', model: 'local-coder-v3', kind: 'coding-agent' },
    finalAcceptance: verifierOutcomes.every((v) => v.verdict === 'pass') ? 'accepted' : 'rejected',
    verifierOutcomes,
  };
}

test('wilsonLowerBound returns 0 for no samples and grows toward the raw rate with more samples', () => {
  assert.equal(wilsonLowerBound(0, 0), 0);
  const fewSamples = wilsonLowerBound(3, 3); // 100% over 3 trials
  const manySamples = wilsonLowerBound(300, 300); // 100% over 300 trials
  assert.ok(fewSamples < manySamples, 'more samples at the same rate should raise the conservative lower bound');
  assert.ok(fewSamples > 0 && fewSamples < 1);
  assert.ok(manySamples > 0.98);
});

test('stageAcceptanceRatesFromOutcomeStore aggregates real OutcomeStore verifierOutcomes into per-stage rates', () => {
  const records = [
    outcomeRecord({ verifierOutcomes: [{ name: 'planner-review', verdict: 'pass' }, { name: 'unit-tests', verdict: 'pass' }] }),
    outcomeRecord({ verifierOutcomes: [{ name: 'planner-review', verdict: 'pass' }, { name: 'unit-tests', verdict: 'fail' }] }),
    outcomeRecord({ verifierOutcomes: [{ name: 'planner-review', verdict: 'fail' }, { name: 'unit-tests', verdict: 'pass' }] }),
  ];

  const rates = stageAcceptanceRatesFromOutcomeStore(records);

  const planner = rates.get('planner-review');
  assert.equal(planner.total, 3);
  assert.equal(planner.accepted, 2);
  assert.ok(Math.abs(planner.rate - 2 / 3) < 1e-9);
  assert.ok(planner.lowerBound < planner.rate, 'lower bound must be conservative relative to raw rate');

  const unitTests = rates.get('unit-tests');
  assert.equal(unitTests.total, 3);
  assert.equal(unitTests.accepted, 2);
});

test('stageAcceptanceRatesFromOutcomeStore ignores records with no verifierOutcomes rather than fabricating a stage', () => {
  const rates = stageAcceptanceRatesFromOutcomeStore([{ taskClass: 'coding', finalAcceptance: 'accepted' }]);
  assert.equal(rates.size, 0);
});

test('stageRateFromWorkerPerformance adapts a live WorkerPerformanceLedger stat into the StageRate shape', () => {
  const ledger = new WorkerPerformanceLedger();
  for (let i = 0; i < 8; i += 1) ledger.record({ workerId: 'worker-9', taskClass: 'coding', accepted: true, durationMs: 1000 });
  for (let i = 0; i < 2; i += 1) ledger.record({ workerId: 'worker-9', taskClass: 'coding', accepted: false, durationMs: 1000 });

  const stageRate = stageRateFromWorkerPerformance('executor:worker-9', ledger, 'worker-9', 'coding');
  assert.equal(stageRate.stage, 'executor:worker-9');
  assert.equal(stageRate.total, 10);
  assert.equal(stageRate.accepted, 8);
  assert.ok(Math.abs(stageRate.rate - 0.8) < 1e-9);
});

test('estimateChainReliability multiplies real per-stage lower-bound rates and compares to policy', () => {
  const rates = stageAcceptanceRatesFromOutcomeStore([
    outcomeRecord({ verifierOutcomes: Array.from({ length: 50 }, () => ({ name: 'plan', verdict: 'pass' })).slice(0, 1) }),
  ]);
  // Build a controlled, high-sample-count stage map directly instead, for a deterministic assertion.
  const stageRates = new Map([
    ['plan', { stage: 'plan', total: 200, accepted: 190, rate: 0.95, lowerBound: 0.9, confidence: 1 }],
    ['code', { stage: 'code', total: 200, accepted: 180, rate: 0.9, lowerBound: 0.85, confidence: 1 }],
    ['review', { stage: 'review', total: 200, accepted: 196, rate: 0.98, lowerBound: 0.95, confidence: 1 }],
  ]);

  const result = estimateChainReliability(['plan', 'code', 'review'], stageRates, { policyMinimum: 0.7 });

  assert.equal(result.chain.length, 3);
  assert.ok(Math.abs(result.reliability - 0.95 * 0.9 * 0.98) < 1e-9);
  assert.ok(Math.abs(result.conservativeReliability - 0.9 * 0.85 * 0.95) < 1e-9);
  assert.equal(result.meetsPolicy, result.conservativeReliability >= 0.7);
  assert.deepEqual(result.unobservedStages, []);
});

test('estimateChainReliability fails closed on unobserved stages (no data => rate 0, chain flagged)', () => {
  const stageRates = new Map([['plan', { stage: 'plan', total: 100, accepted: 99, rate: 0.99, lowerBound: 0.95, confidence: 1 }]]);
  const result = estimateChainReliability(['plan', 'mystery-stage'], stageRates, { policyMinimum: 0.5 });
  assert.deepEqual(result.unobservedStages, ['mystery-stage']);
  assert.equal(result.conservativeReliability, 0);
  assert.equal(result.meetsPolicy, false);
});

test('estimateChainReliability rejects an empty chain', () => {
  assert.throws(() => estimateChainReliability([], new Map()), /non-empty/);
});

// ---------------------------------------------------------------------------------------------
// Acceptance-criteria regression case: an unsafe multi-LLM chain must be flagged.
// ---------------------------------------------------------------------------------------------

test('REGRESSION: flagUnsafeChains flags an unsafe multi-LLM chain (four compounding probabilistic stages, each individually plausible) below policy', () => {
  // Each stage looks fine in isolation (88-92% observed acceptance), but four independent
  // probabilistic LLM-to-LLM handoffs compound: 0.90 * 0.88 * 0.92 * 0.90 ~= 0.657, well under a
  // 0.7 policy floor. This is exactly the failure mode issue #98 exists to catch: nothing about
  // any single stage looks alarming, but the chain as a whole is not reliable enough to trust
  // without an intervening deterministic transform/guard.
  const stageRates = new Map([
    ['planner-llm', { stage: 'planner-llm', total: 300, accepted: 270, rate: 0.9, lowerBound: 0.86, confidence: 1 }],
    ['coder-llm', { stage: 'coder-llm', total: 300, accepted: 264, rate: 0.88, lowerBound: 0.84, confidence: 1 }],
    ['reviewer-llm', { stage: 'reviewer-llm', total: 300, accepted: 276, rate: 0.92, lowerBound: 0.88, confidence: 1 }],
    ['qa-llm', { stage: 'qa-llm', total: 300, accepted: 270, rate: 0.9, lowerBound: 0.86, confidence: 1 }],
  ]);

  // A comparison "safe" chain: same policy, but the middle two probabilistic hops are replaced by
  // a single, highly-reliable deterministic transform+guard stage (as the issue recommends).
  const safeStageRates = new Map(stageRates);
  safeStageRates.set('deterministic-transform', { stage: 'deterministic-transform', total: 1000, accepted: 998, rate: 0.998, lowerBound: 0.994, confidence: 1 });

  const flagged = flagUnsafeChains(
    {
      'unsafe-four-llm-chain': ['planner-llm', 'coder-llm', 'reviewer-llm', 'qa-llm'],
      'safer-chain-with-deterministic-middle': ['planner-llm', 'deterministic-transform', 'qa-llm'],
    },
    safeStageRates,
    { policyMinimum: 0.7 }
  );

  assert.equal(flagged.length, 1, 'exactly the unsafe multi-LLM chain should be flagged, not the deterministic-middle chain');
  assert.equal(flagged[0].name, 'unsafe-four-llm-chain');
  assert.ok(flagged[0].conservativeReliability < 0.7);
  assert.ok(flagged[0].shortfall > 0);
});

test('flagUnsafeChains does not flag a chain that meets policy, and results are sorted worst-first', () => {
  const stageRates = new Map([
    ['a', { stage: 'a', total: 100, accepted: 99, rate: 0.99, lowerBound: 0.95, confidence: 1 }],
    ['b', { stage: 'b', total: 100, accepted: 98, rate: 0.98, lowerBound: 0.93, confidence: 1 }],
    ['c', { stage: 'c', total: 100, accepted: 40, rate: 0.4, lowerBound: 0.31, confidence: 1 }],
  ]);
  const flagged = flagUnsafeChains(
    { good: ['a', 'b'], bad: ['a', 'b', 'c'] },
    stageRates,
    { policyMinimum: 0.7 }
  );
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].name, 'bad');
});

// ---------------------------------------------------------------------------------------------
// deterministic-transform-first decision helper
// ---------------------------------------------------------------------------------------------

test('decideDeterministicTransformFirst skips reason-if-unresolved when a deterministic transform resolves the work, and counts the avoided call', () => {
  let reasonIfUnresolvedCalls = 0;
  const outcome = decideDeterministicTransformFirst({
    reason: () => ({ resolved: false, result: { intent: 'normalize-path' } }),
    transformOrGuard: (reasonResult) => ({ applicable: true, resolved: true, result: `/normalized${reasonResult.intent}` }),
    reasonIfUnresolved: () => {
      reasonIfUnresolvedCalls += 1;
      return { resolved: true, result: 'should not run' };
    },
    independentVerification: (candidate) => ({ ok: candidate === '/normalized-transform', result: candidate }),
  });

  assert.equal(reasonIfUnresolvedCalls, 0, 'the probabilistic reason-if-unresolved step must not run once the deterministic transform resolved the work');
  assert.equal(outcome.avoidedModelCalls, 1);
  assert.equal(outcome.independentVerificationRan, true);
  const steps = outcome.trace.map((t) => t.step);
  assert.deepEqual(steps, ['reason', 'transform', 'reason-if-unresolved', 'independent-verification']);
  assert.equal(outcome.trace.find((t) => t.step === 'reason-if-unresolved').invoked, false);
});

test('decideDeterministicTransformFirst falls through to reason-if-unresolved when the transform/guard does not apply', () => {
  const outcome = decideDeterministicTransformFirst({
    reason: () => ({ resolved: false }),
    transformOrGuard: () => ({ applicable: false }),
    reasonIfUnresolved: () => ({ resolved: true, result: 'llm-resolved-it' }),
    independentVerification: (candidate) => ({ ok: true, result: candidate }),
  });

  assert.equal(outcome.resolved, true);
  assert.equal(outcome.result, 'llm-resolved-it');
  assert.equal(outcome.avoidedModelCalls, 0);
});

test('decideDeterministicTransformFirst always runs independent verification and never reports resolved if verification fails, even when the deterministic path "succeeded"', () => {
  const outcome = decideDeterministicTransformFirst({
    reason: () => ({ resolved: false }),
    transformOrGuard: () => ({ applicable: true, resolved: true, result: 'looks-fine-but-unsafe' }),
    independentVerification: () => ({ ok: false }),
  });

  assert.equal(outcome.independentVerificationRan, true);
  assert.equal(outcome.resolved, false, 'independent verification failing must override an earlier deterministic "resolved"');
  assert.equal(outcome.result, undefined);
});

test('decideDeterministicTransformFirst requires independentVerification and reason, refusing to silently skip either', () => {
  assert.throws(() => decideDeterministicTransformFirst({ independentVerification: () => ({ ok: true }) }), /reason is required/);
  assert.throws(() => decideDeterministicTransformFirst({ reason: () => ({ resolved: true }) }), /independentVerification is required/);
});

test('decideDeterministicTransformFirst: initial reason resolving immediately also avoids the probabilistic reason-if-unresolved call', () => {
  let reasonIfUnresolvedCalls = 0;
  const outcome = decideDeterministicTransformFirst({
    reason: () => ({ resolved: true, result: 'trivial-known-answer' }),
    reasonIfUnresolved: () => {
      reasonIfUnresolvedCalls += 1;
      return { resolved: true };
    },
    independentVerification: (candidate) => ({ ok: candidate === 'trivial-known-answer', result: candidate }),
  });

  assert.equal(reasonIfUnresolvedCalls, 0);
  assert.equal(outcome.avoidedModelCalls, 1);
  assert.equal(outcome.resolved, true);
});
