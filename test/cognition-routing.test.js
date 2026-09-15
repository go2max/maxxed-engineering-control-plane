import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelRegistry } from '../src/models/model-registry.js';
import { ModelRouter } from '../src/models/model-router.js';
import { CognitionClass, EscalationTier, defaultTierForCognitionClass, nextTier, tierRank } from '../src/models/cognition-classes.js';
import { estimateFrontierJustification, harvestableFromAcceptedPackage, packageFrontierTask } from '../src/models/frontier-task-packaging.js';

test('escalation ladder orders tiers cheapest-first and frontier sits after strong-model', () => {
  assert.ok(tierRank(EscalationTier.REUSE) < tierRank(EscalationTier.CHEAP_MODEL));
  assert.ok(tierRank(EscalationTier.CHEAP_MODEL) < tierRank(EscalationTier.STRONG_MODEL));
  assert.ok(tierRank(EscalationTier.STRONG_MODEL) < tierRank(EscalationTier.FRONTIER));
  assert.equal(nextTier(EscalationTier.FRONTIER), EscalationTier.DECOMPOSITION);
  assert.equal(defaultTierForCognitionClass(CognitionClass.EXACT_REUSE), EscalationTier.REUSE);
  assert.equal(defaultTierForCognitionClass(CognitionClass.FRONTIER_REASONING), EscalationTier.FRONTIER);
});

test('router withholds frontier-tier models from mechanical work even when external escalation is allowed', () => {
  const registry = new ModelRegistry();
  registry.register({ id: 'cheap-local', kind: 'local', capabilities: ['code'], contextWindow: 16000, tier: EscalationTier.CHEAP_MODEL });
  registry.register({ id: 'frontier-external', kind: 'external', capabilities: ['code'], contextWindow: 200000, tier: EscalationTier.FRONTIER, costPerMillionInputTokens: 15, costPerMillionOutputTokens: 60 });
  const router = new ModelRouter({ registry, allowExternalEscalation: true });

  // Routine coding work, no cost justification supplied: frontier must never be selected.
  const routine = router.route({ capabilities: ['code'], cognitionClass: CognitionClass.ROUTINE_CODING });
  assert.equal(routine.model.id, 'cheap-local');
  assert.equal(routine.explanation.costJustified, false);
});

test('router escalates to frontier only when the request demonstrates cost justification', () => {
  const registry = new ModelRegistry();
  registry.register({ id: 'cheap-local', kind: 'local', capabilities: ['reasoning'], contextWindow: 16000, tier: EscalationTier.CHEAP_MODEL });
  registry.register({ id: 'frontier-external', kind: 'external', capabilities: ['reasoning'], contextWindow: 200000, tier: EscalationTier.FRONTIER, costPerMillionInputTokens: 15, costPerMillionOutputTokens: 60 });
  const router = new ModelRouter({ registry, allowExternalEscalation: true });

  // Cheaper tiers already failed twice: justified escalation, and the caller explicitly
  // forces the frontier floor so cheap-local is no longer considered.
  const escalated = router.route({
    capabilities: ['reasoning'],
    forceMinTier: EscalationTier.FRONTIER,
    lowerTierAttempts: 2,
    minContextWindow: 100000,
    maxCostPerMillionTokens: 100
  });
  assert.equal(escalated.model.id, 'frontier-external');
  assert.equal(escalated.explanation.costJustified, true);
});

test('router still fails closed toward local-first cheapest-correct fallback (regression)', () => {
  const registry = new ModelRegistry();
  registry.register({ id: 'local-small', kind: 'local', capabilities: ['code'], contextWindow: 16000, priority: 10 });
  registry.register({ id: 'external-large', kind: 'external', capabilities: ['code'], contextWindow: 128000, priority: 100, costPerMillionInputTokens: 1 });
  const router = new ModelRouter({ registry });
  assert.equal(router.route({ capabilities: ['code'], minContextWindow: 8000 }).model.id, 'local-small');
});

test('packageFrontierTask requires evidence requirements, mutation scope and budgets', () => {
  assert.throws(() => packageFrontierTask({ taskKey: 't1', objective: 'do it', cognitionClass: CognitionClass.FRONTIER_REASONING, costJustification: 'novel', evidenceRequirements: [], mutationScope: ['src/a.js'], shardBudget: 3, horizonBudgetMs: 60000 }), /evidenceRequirements/);
  assert.throws(() => packageFrontierTask({ taskKey: 't1', objective: 'do it', cognitionClass: CognitionClass.FRONTIER_REASONING, costJustification: 'novel', evidenceRequirements: ['tests pass'], mutationScope: [], shardBudget: 3, horizonBudgetMs: 60000 }), /mutationScope/);

  const pkg = packageFrontierTask({
    taskKey: 't1',
    objective: 'redesign the scheduler admission path',
    cognitionClass: CognitionClass.FRONTIER_REASONING,
    costJustification: 'high-novelty architectural change, two specialist attempts failed verification',
    minimalContext: [{ path: 'src/scheduler/portfolio-scheduler.js', reason: 'admission path under change' }],
    evidenceRequirements: ['npm test passes', 'no new backpressure regressions in scheduler-policy.test.js'],
    mutationScope: ['src/scheduler/portfolio-scheduler.js'],
    shardBudget: 5,
    horizonBudgetMs: 15 * 60_000
  });
  assert.equal(pkg.taskKey, 't1');
  assert.equal(pkg.shardBudget, 5);
  assert.equal(pkg.minimalContext[0].path, 'src/scheduler/portfolio-scheduler.js');
});

test('estimateFrontierJustification requires positive expected value and an escalation basis', () => {
  const noBasis = estimateFrontierJustification({ estimatedFrontierCostUnits: 10, estimatedAcceptedValueUnits: 100 });
  assert.equal(noBasis.justified, false);
  assert.equal(noBasis.reason, 'no-escalation-basis');

  const costTooHigh = estimateFrontierJustification({ lowerTierAttempts: 2, lowerTierFailures: 2, estimatedFrontierCostUnits: 100, estimatedAcceptedValueUnits: 10 });
  assert.equal(costTooHigh.justified, false);
  assert.equal(costTooHigh.reason, 'expected-accepted-value-does-not-exceed-cost');

  const ok = estimateFrontierJustification({ lowerTierAttempts: 2, lowerTierFailures: 2, estimatedFrontierCostUnits: 10, estimatedAcceptedValueUnits: 100 });
  assert.equal(ok.justified, true);
  assert.equal(ok.reason, 'lower-tier-attempts-exhausted');
});

test('harvestableFromAcceptedPackage normalizes an accepted frontier solution for reuse harvesting', () => {
  const pkg = packageFrontierTask({
    taskKey: 't1',
    objective: 'x',
    cognitionClass: CognitionClass.FRONTIER_REASONING,
    costJustification: 'novel',
    evidenceRequirements: ['tests pass'],
    mutationScope: ['src/a.js'],
    shardBudget: 1,
    horizonBudgetMs: 1000
  });
  const harvested = harvestableFromAcceptedPackage(pkg, { solutionDigest: 'sha256:abc' });
  assert.equal(harvested.sourceTaskKey, 't1');
  assert.equal(harvested.solutionDigest, 'sha256:abc');
  assert.ok(Number.isFinite(harvested.acceptedAt));
});
