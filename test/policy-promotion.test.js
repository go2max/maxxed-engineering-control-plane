import test from 'node:test';
import assert from 'node:assert/strict';
import { PolicyRegistry, evaluateCanary, DEFAULT_CANARY_POLICY, PROMOTION_STAGES } from '../src/training/policy-promotion.js';

function scores({ taskSuccessRate, regressionRate = 0.05, hallucinationRate = 0.03 }) {
  return { taskSuccessRate, regressionRate, hallucinationRate, toolUseCorrectness: 0.9, latencyMsP50: 500, costPerTaskUsd: 0.01 };
}

function controlCanary(overrides = {}) {
  return { acceptanceRate: 0.9, costPerTaskUsd: 0.02, latencyMsP50: 400, rollbackRate: 0.01, securityIncidentCount: 0, verifierEscapeRate: 0.001, ...overrides };
}

test('accepted and rejected outcomes are not this module\'s concern, but stage machine advances only forward', () => {
  const registry = new PolicyRegistry({ kind: 'shard-sizing', rule: 'fixed-1' });
  const v = registry.registerCandidate({ kind: 'shard-sizing', rule: 'learned-v1' });
  assert.throws(() => registry.advanceStage(v, 'CANARY'), /must advance one at a time/);
  registry.advanceStage(v, 'SHADOW');
  registry.advanceStage(v, 'BENCHMARK');
  assert.equal(registry.getVersion(v).stage, 'BENCHMARK');
});

test('shadow candidate has no live authority', () => {
  const registry = new PolicyRegistry({ kind: 'shard-sizing', rule: 'fixed-1' });
  const v = registry.registerCandidate({ kind: 'shard-sizing', rule: 'learned-v1' });
  registry.advanceStage(v, 'SHADOW');
  const active = registry.getActivePolicy();
  assert.equal(active.isFallback, true);
  assert.equal(active.policy.rule, 'fixed-1');
});

test('worse candidate cannot promote past BENCHMARK', () => {
  const registry = new PolicyRegistry({ kind: 'router', rule: 'default' });
  const v = registry.registerCandidate({ kind: 'router', rule: 'learned-v1' });
  registry.advanceStage(v, 'SHADOW');
  registry.advanceStage(v, 'BENCHMARK');
  const incumbentScores = { coding: scores({ taskSuccessRate: 0.7 }) };
  const worseScores = { coding: scores({ taskSuccessRate: 0.6 }) };
  const result = registry.promoteThroughGate({ version: v, targetDomain: 'coding', incumbentScores, candidateScores: worseScores });
  assert.equal(result.verdict, 'REJECT');
  assert.equal(registry.getVersion(v).stage, 'BENCHMARK');
  assert.equal(registry.getActivePolicy().policy.rule, 'default');
});

test('a candidate that beats the gate advances to CANARY, then PROMOTION_GATE on a clean canary, then PRODUCTION on finalize', () => {
  const registry = new PolicyRegistry({ kind: 'router', rule: 'default' });
  const v = registry.registerCandidate({ kind: 'router', rule: 'learned-v1' });
  registry.advanceStage(v, 'SHADOW');
  registry.advanceStage(v, 'BENCHMARK');
  const incumbentScores = { coding: scores({ taskSuccessRate: 0.7 }) };
  const betterScores = { coding: scores({ taskSuccessRate: 0.85 }) };
  const gateResult = registry.promoteThroughGate({ version: v, targetDomain: 'coding', incumbentScores, candidateScores: betterScores });
  assert.equal(gateResult.verdict, 'PROMOTE');
  assert.equal(registry.getVersion(v).stage, 'CANARY');

  const canaryResult = registry.recordCanaryResult(v, controlCanary(), controlCanary({ acceptanceRate: 0.91 }));
  assert.equal(canaryResult.verdict, 'CONTINUE');
  assert.equal(registry.getVersion(v).stage, 'PROMOTION_GATE');

  // Still no live authority until finalizePromotion is explicitly called with sign-off.
  assert.equal(registry.getActivePolicy().policy.rule, 'default');

  const finalized = registry.finalizePromotion(v, { approvedBy: 'operator-1' });
  assert.equal(finalized.stage, 'PRODUCTION');
  assert.equal(registry.getActivePolicy().policy.rule, 'learned-v1');
  assert.equal(registry.getActivePolicy().isFallback, false);
});

test('finalizePromotion refuses without an explicit approver (independent gate)', () => {
  const registry = new PolicyRegistry({ kind: 'router', rule: 'default' });
  const v = registry.registerCandidate({ kind: 'router', rule: 'learned-v1' });
  registry.advanceStage(v, 'SHADOW');
  registry.advanceStage(v, 'BENCHMARK');
  registry.promoteThroughGate({
    version: v,
    targetDomain: 'coding',
    incumbentScores: { coding: scores({ taskSuccessRate: 0.7 }) },
    candidateScores: { coding: scores({ taskSuccessRate: 0.9 }) },
  });
  registry.recordCanaryResult(v, controlCanary(), controlCanary());
  assert.throws(() => registry.finalizePromotion(v, {}), /requires an explicit approvedBy/);
});

test('canary regression rolls back to the previous policy automatically', () => {
  const registry = new PolicyRegistry({ kind: 'router', rule: 'default' });
  const v = registry.registerCandidate({ kind: 'router', rule: 'learned-v1' });
  registry.advanceStage(v, 'SHADOW');
  registry.advanceStage(v, 'BENCHMARK');
  registry.promoteThroughGate({
    version: v,
    targetDomain: 'coding',
    incumbentScores: { coding: scores({ taskSuccessRate: 0.7 }) },
    candidateScores: { coding: scores({ taskSuccessRate: 0.9 }) },
  });
  const regressedCandidate = controlCanary({ acceptanceRate: 0.5, securityIncidentCount: 1 });
  const canaryResult = registry.recordCanaryResult(v, controlCanary(), regressedCandidate);
  assert.equal(canaryResult.verdict, 'ROLLBACK');
  assert.ok(canaryResult.regressions.some((r) => r.metric === 'acceptanceRate'));
  assert.ok(canaryResult.regressions.some((r) => r.metric === 'securityIncidentCount'));
  assert.equal(registry.getVersion(v).stage, 'ROLLED_BACK');
  // control (deterministic fallback, since nothing was ever promoted) keeps serving
  assert.equal(registry.getActivePolicy().isFallback, true);
});

test('post-promotion rollback restores deterministic fallback when no prior production version exists', () => {
  const registry = new PolicyRegistry({ kind: 'router', rule: 'default' });
  const v = registry.registerCandidate({ kind: 'router', rule: 'learned-v1' });
  registry.advanceStage(v, 'SHADOW');
  registry.advanceStage(v, 'BENCHMARK');
  registry.promoteThroughGate({
    version: v,
    targetDomain: 'coding',
    incumbentScores: { coding: scores({ taskSuccessRate: 0.7 }) },
    candidateScores: { coding: scores({ taskSuccessRate: 0.9 }) },
  });
  registry.recordCanaryResult(v, controlCanary(), controlCanary());
  registry.finalizePromotion(v, { approvedBy: 'operator-1' });
  assert.equal(registry.getActivePolicy().policy.rule, 'learned-v1');

  registry.rollbackProduction('acceptance rate dropped in production monitoring');
  const active = registry.getActivePolicy();
  assert.equal(active.isFallback, true);
  assert.equal(active.policy.rule, 'default');
  assert.equal(registry.getVersion(v).stage, 'ROLLED_BACK');
});

test('a second promoted version retires the first; rollback of the second falls back to fallback, not to the retired first', () => {
  const registry = new PolicyRegistry({ kind: 'router', rule: 'default' });

  const v1 = registry.registerCandidate({ kind: 'router', rule: 'learned-v1' });
  registry.advanceStage(v1, 'SHADOW');
  registry.advanceStage(v1, 'BENCHMARK');
  registry.promoteThroughGate({ version: v1, targetDomain: 'coding', incumbentScores: { coding: scores({ taskSuccessRate: 0.7 }) }, candidateScores: { coding: scores({ taskSuccessRate: 0.85 }) } });
  registry.recordCanaryResult(v1, controlCanary(), controlCanary());
  registry.finalizePromotion(v1, { approvedBy: 'operator-1' });

  const v2 = registry.registerCandidate({ kind: 'router', rule: 'learned-v2' });
  registry.advanceStage(v2, 'SHADOW');
  registry.advanceStage(v2, 'BENCHMARK');
  registry.promoteThroughGate({ version: v2, targetDomain: 'coding', incumbentScores: { coding: scores({ taskSuccessRate: 0.85 }) }, candidateScores: { coding: scores({ taskSuccessRate: 0.95 }) } });
  registry.recordCanaryResult(v2, controlCanary(), controlCanary());
  registry.finalizePromotion(v2, { approvedBy: 'operator-2' });

  assert.equal(registry.getVersion(v1).stage, 'RETIRED');
  assert.equal(registry.getActivePolicy().policy.rule, 'learned-v2');

  registry.rollbackProduction('regression');
  assert.equal(registry.getActivePolicy().isFallback, true);
  assert.equal(registry.getActivePolicy().policy.rule, 'default');
});

test('deterministic fallback remains usable when no learned policy has ever been registered', () => {
  const registry = new PolicyRegistry({ kind: 'router', rule: 'default' });
  const active = registry.getActivePolicy();
  assert.equal(active.isFallback, true);
  assert.equal(active.stage, 'DETERMINISTIC_FALLBACK');
});

test('PolicyRegistry serializes and restores via toJSON/fromJSON', () => {
  const registry = new PolicyRegistry({ kind: 'router', rule: 'default' });
  const v = registry.registerCandidate({ kind: 'router', rule: 'learned-v1' });
  registry.advanceStage(v, 'SHADOW');
  const restored = PolicyRegistry.fromJSON(JSON.parse(JSON.stringify(registry.toJSON())));
  assert.equal(restored.getVersion(v).stage, 'SHADOW');
  assert.equal(restored.getActivePolicy().isFallback, true);
});

test('evaluateCanary continues on metrics within threshold', () => {
  const result = evaluateCanary(controlCanary(), controlCanary({ acceptanceRate: 0.895, costPerTaskUsd: 0.021 }), DEFAULT_CANARY_POLICY);
  assert.equal(result.verdict, 'CONTINUE');
  assert.deepEqual(result.regressions, []);
});

test('evaluateCanary rolls back on cost regression past threshold', () => {
  const result = evaluateCanary(controlCanary(), controlCanary({ costPerTaskUsd: 0.03 }), DEFAULT_CANARY_POLICY);
  assert.equal(result.verdict, 'ROLLBACK');
  assert.equal(result.regressions[0].metric, 'costPerTaskUsd');
});

test('PROMOTION_STAGES is the exact required promotion path', () => {
  assert.deepEqual(PROMOTION_STAGES, ['OFFLINE_REPLAY', 'SHADOW', 'BENCHMARK', 'CANARY', 'PROMOTION_GATE', 'PRODUCTION']);
});
