import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePromotionGate, DEFAULT_PROMOTION_POLICY } from '../src/training/promotion-gate.js';

function scores({ taskSuccessRate, regressionRate, hallucinationRate }) {
  return { taskSuccessRate, regressionRate, hallucinationRate, toolUseCorrectness: 0.9, latencyMsP50: 500, costPerTaskUsd: 0.01 };
}

test('promotes candidate that beats incumbent on target domain with no safety regression', () => {
  const incumbentScores = { coding: scores({ taskSuccessRate: 0.70, regressionRate: 0.05, hallucinationRate: 0.03 }) };
  const candidateScores = { coding: scores({ taskSuccessRate: 0.80, regressionRate: 0.05, hallucinationRate: 0.03 }) };
  const result = evaluatePromotionGate({ targetDomain: 'coding', incumbentScores, candidateScores });
  assert.equal(result.verdict, 'PROMOTE');
  assert.equal(result.domainImprovement.passed, true);
  assert.deepEqual(result.safetyRegressions, []);
});

test("operator's callout case: domain score improves but a safety metric regresses beyond threshold -> reject", () => {
  const incumbentScores = { coding: scores({ taskSuccessRate: 0.70, regressionRate: 0.05, hallucinationRate: 0.03 }) };
  // Domain metric clearly improves (+10 points) but hallucination rate jumps by 5 points, well
  // past the 2-point default threshold. Must reject despite the domain win.
  const candidateScores = { coding: scores({ taskSuccessRate: 0.80, regressionRate: 0.05, hallucinationRate: 0.08 }) };
  const result = evaluatePromotionGate({ targetDomain: 'coding', incumbentScores, candidateScores });
  assert.equal(result.verdict, 'REJECT');
  assert.equal(result.domainImprovement.passed, true, 'domain metric itself did improve');
  assert.equal(result.safetyRegressions.length, 1);
  assert.equal(result.safetyRegressions[0].metric, 'hallucinationRate');
  assert.ok(result.reasons.some((r) => r.includes('material safety regression')));
});

test('rejects candidate that does not beat incumbent on target domain, even with clean safety metrics', () => {
  const incumbentScores = { coding: scores({ taskSuccessRate: 0.70, regressionRate: 0.05, hallucinationRate: 0.03 }) };
  const candidateScores = { coding: scores({ taskSuccessRate: 0.65, regressionRate: 0.05, hallucinationRate: 0.03 }) };
  const result = evaluatePromotionGate({ targetDomain: 'coding', incumbentScores, candidateScores });
  assert.equal(result.verdict, 'REJECT');
  assert.equal(result.domainImprovement.passed, false);
  assert.deepEqual(result.safetyRegressions, []);
});

test('a tie on the target domain does not promote (strict improvement required)', () => {
  const incumbentScores = { coding: scores({ taskSuccessRate: 0.70, regressionRate: 0.05, hallucinationRate: 0.03 }) };
  const candidateScores = { coding: scores({ taskSuccessRate: 0.70, regressionRate: 0.05, hallucinationRate: 0.03 }) };
  const result = evaluatePromotionGate({ targetDomain: 'coding', incumbentScores, candidateScores });
  assert.equal(result.verdict, 'REJECT');
  assert.equal(result.domainImprovement.delta, 0);
});

test('safety regression just under threshold is not material', () => {
  const incumbentScores = { coding: scores({ taskSuccessRate: 0.70, regressionRate: 0.05, hallucinationRate: 0.03 }) };
  const candidateScores = { coding: scores({ taskSuccessRate: 0.80, regressionRate: 0.069, hallucinationRate: 0.03 }) }; // +0.019, under 0.02 default
  const result = evaluatePromotionGate({ targetDomain: 'coding', incumbentScores, candidateScores });
  assert.equal(result.verdict, 'PROMOTE');
  assert.deepEqual(result.safetyRegressions, []);
});

test('safety regression on a non-target domain still blocks promotion (cross-cutting)', () => {
  const incumbentScores = {
    coding: scores({ taskSuccessRate: 0.70, regressionRate: 0.05, hallucinationRate: 0.03 }),
    'business-reasoning': scores({ taskSuccessRate: 0.60, regressionRate: 0.04, hallucinationRate: 0.02 }),
  };
  const candidateScores = {
    coding: scores({ taskSuccessRate: 0.85, regressionRate: 0.05, hallucinationRate: 0.03 }),
    // business-reasoning is not the target domain, but its safety metrics blew past threshold.
    'business-reasoning': scores({ taskSuccessRate: 0.62, regressionRate: 0.10, hallucinationRate: 0.02 }),
  };
  const result = evaluatePromotionGate({ targetDomain: 'coding', incumbentScores, candidateScores });
  assert.equal(result.verdict, 'REJECT');
  assert.equal(result.safetyRegressions.length, 1);
  assert.equal(result.safetyRegressions[0].domain, 'business-reasoning');
});

test('per-metric threshold override tightens the gate for a specific safety metric', () => {
  const incumbentScores = { coding: scores({ taskSuccessRate: 0.70, regressionRate: 0.05, hallucinationRate: 0.03 }) };
  const candidateScores = { coding: scores({ taskSuccessRate: 0.80, regressionRate: 0.05, hallucinationRate: 0.045 }) }; // +0.015, under global 0.02 default
  const lenient = evaluatePromotionGate({ targetDomain: 'coding', incumbentScores, candidateScores });
  assert.equal(lenient.verdict, 'PROMOTE');

  const strictPolicy = { ...DEFAULT_PROMOTION_POLICY, maxRegressionByMetric: { hallucinationRate: 0.01 } };
  const strict = evaluatePromotionGate({ targetDomain: 'coding', incumbentScores, candidateScores, policy: strictPolicy });
  assert.equal(strict.verdict, 'REJECT');
  assert.equal(strict.safetyRegressions[0].metric, 'hallucinationRate');
});

test('missing target-domain scores rejects with a clear reason instead of throwing', () => {
  const result = evaluatePromotionGate({ targetDomain: 'security-reliability', incumbentScores: {}, candidateScores: {} });
  assert.equal(result.verdict, 'REJECT');
  assert.ok(result.reasons[0].includes('missing scores'));
});

test('domains only scored on one side (incumbent or candidate) are excluded from cross-cutting safety check', () => {
  const incumbentScores = {
    coding: scores({ taskSuccessRate: 0.70, regressionRate: 0.05, hallucinationRate: 0.03 }),
    'outreach-support': scores({ taskSuccessRate: 0.50, regressionRate: 0.20, hallucinationRate: 0.15 }), // only incumbent scored this
  };
  const candidateScores = { coding: scores({ taskSuccessRate: 0.80, regressionRate: 0.05, hallucinationRate: 0.03 }) };
  const result = evaluatePromotionGate({ targetDomain: 'coding', incumbentScores, candidateScores });
  assert.equal(result.verdict, 'PROMOTE');
  assert.deepEqual(result.domainsEvaluated, ['coding']);
});
