import test from 'node:test';
import assert from 'node:assert/strict';
import { PolicyRegistry } from '../src/training/policy-promotion.js';
import { PortfolioScheduler, DEFAULT_SCHEDULER_WEIGHTS, scoreTask } from '../src/scheduler/portfolio-scheduler.js';
import { TaskGraph } from '../src/core/task-graph.js';
import {
  SCHEDULER_WEIGHTS_TASK_CLASS,
  SCHEDULER_REPLAY_SCENARIOS,
  replaySchedulerWeights,
  buildSchedulerWeightDomainScores,
} from '../src/scheduler/scheduler-weight-policy.js';

function controlCanary(overrides = {}) {
  return { acceptanceRate: 0.9, costPerTaskUsd: 0.02, latencyMsP50: 400, rollbackRate: 0.01, securityIncidentCount: 0, verifierEscapeRate: 0.001, ...overrides };
}

test('DEFAULT_SCHEDULER_WEIGHTS passes every offline-replay invariant', () => {
  const results = replaySchedulerWeights(DEFAULT_SCHEDULER_WEIGHTS);
  assert.equal(results.length, SCHEDULER_REPLAY_SCENARIOS.length);
  assert.ok(results.every((r) => r.success === true), `expected all invariants to hold: ${JSON.stringify(results)}`);
});

test('scoreTask with an explicit weights option matches the default when weights are omitted (no behavior change)', () => {
  const graph = new TaskGraph();
  graph.add({ key: 'a', repository: 'r', metadata: { priority: 3, failureCount: 1 }, riskClass: 'high' });
  const withDefaults = scoreTask(graph, graph.get('a'), { now: 1000 });
  const withExplicit = scoreTask(graph, graph.get('a'), { now: 1000, weights: DEFAULT_SCHEDULER_WEIGHTS });
  assert.deepEqual(withDefaults, withExplicit);
});

test('a genuinely broken candidate (zero priority weight) fails offline replay and never even reaches the registry', () => {
  const broken = { ...DEFAULT_SCHEDULER_WEIGHTS, priorityWeight: 0 };
  const results = replaySchedulerWeights(broken);
  const priorityCase = results.find((r) => r.caseId === 'priority-ordering');
  assert.equal(priorityCase.success, false, 'zero priority weight should break the priority-ordering invariant');
});

test('scheduler-weight candidate: BENCHMARK rejects a worse candidate through the unmodified PolicyRegistry gate', () => {
  const registry = new PolicyRegistry({ kind: 'scheduler-weights', weights: DEFAULT_SCHEDULER_WEIGHTS });
  const worseWeights = { ...DEFAULT_SCHEDULER_WEIGHTS, riskPenaltyCritical: 5 }; // weaker than riskPenaltyHigh: breaks risk-ordering
  const v = registry.registerCandidate({ kind: 'scheduler-weights', weights: worseWeights });
  registry.advanceStage(v, 'SHADOW');
  registry.advanceStage(v, 'BENCHMARK');

  const { incumbentScores, candidateScores } = buildSchedulerWeightDomainScores({ candidateWeights: worseWeights });
  const result = registry.promoteThroughGate({ version: v, targetDomain: SCHEDULER_WEIGHTS_TASK_CLASS, incumbentScores, candidateScores });

  assert.equal(result.verdict, 'REJECT');
  assert.equal(registry.getVersion(v).stage, 'BENCHMARK');
  assert.equal(registry.getActivePolicy().isFallback, true, 'incumbent/fallback still has live authority');
});

test('scheduler-weight candidate: shadow -> canary -> promoted end to end through the unmodified PolicyRegistry stage machine', () => {
  const registry = new PolicyRegistry({ kind: 'scheduler-weights', weights: DEFAULT_SCHEDULER_WEIGHTS });

  // A candidate that fixes a real gap in the incumbent: incumbent treats "critical" risk the same
  // as "high" (a weaker-than-ideal starting default), candidate differentiates them more sharply,
  // which the priority/unlock/failure invariants also still hold under.
  const candidateWeights = { ...DEFAULT_SCHEDULER_WEIGHTS, riskPenaltyCritical: 60 };
  assert.ok(replaySchedulerWeights(candidateWeights).every((r) => r.success), 'candidate must clear offline replay first');

  const v = registry.registerCandidate({ kind: 'scheduler-weights', weights: candidateWeights });
  assert.equal(registry.getVersion(v).stage, 'OFFLINE_REPLAY');
  assert.equal(registry.getActivePolicy().isFallback, true, 'OFFLINE_REPLAY candidate has no live authority');

  registry.advanceStage(v, 'SHADOW');
  assert.equal(registry.getActivePolicy().isFallback, true, 'SHADOW candidate has no live authority');

  registry.advanceStage(v, 'BENCHMARK');
  const { incumbentScores, candidateScores } = buildSchedulerWeightDomainScores({ candidateWeights });
  // Force a clear improvement on the target domain's primary metric so the unmodified gate promotes.
  candidateScores[SCHEDULER_WEIGHTS_TASK_CLASS].taskSuccessRate = 1;
  incumbentScores[SCHEDULER_WEIGHTS_TASK_CLASS].taskSuccessRate = 0.6;
  const gateResult = registry.promoteThroughGate({ version: v, targetDomain: SCHEDULER_WEIGHTS_TASK_CLASS, incumbentScores, candidateScores });
  assert.equal(gateResult.verdict, 'PROMOTE');
  assert.equal(registry.getVersion(v).stage, 'CANARY');
  assert.equal(registry.getActivePolicy().isFallback, true, 'CANARY candidate still has no live authority');

  const canaryResult = registry.recordCanaryResult(v, controlCanary(), controlCanary({ acceptanceRate: 0.92 }));
  assert.equal(canaryResult.verdict, 'CONTINUE');
  assert.equal(registry.getVersion(v).stage, 'PROMOTION_GATE');
  assert.equal(registry.getActivePolicy().isFallback, true, 'PROMOTION_GATE candidate still has no live authority');

  const finalized = registry.finalizePromotion(v, { approvedBy: 'operator:test' });
  assert.equal(finalized.stage, 'PRODUCTION');
  const active = registry.getActivePolicy();
  assert.equal(active.isFallback, false);
  assert.equal(active.policy.weights.riskPenaltyCritical, 60);

  // Proves the promoted candidate is a real, usable scheduler weight set: PortfolioScheduler
  // accepts it and produces different (not just theoretically different) dispatch ordering than
  // the incumbent, via the same optional `weights` wiring point every caller already has.
  const graph = new TaskGraph();
  graph.add({ key: 'risky', repository: 'r', metadata: { priority: 1 }, riskClass: 'critical' });
  const incumbentScheduler = new PortfolioScheduler({ graph, weights: DEFAULT_SCHEDULER_WEIGHTS });
  const promotedScheduler = new PortfolioScheduler({ graph, weights: active.policy.weights });
  const incumbentScore = scoreTask(graph, graph.get('risky'), { now: 0, weights: incumbentScheduler.weights }).score;
  const promotedScore = scoreTask(graph, graph.get('risky'), { now: 0, weights: promotedScheduler.weights }).score;
  assert.ok(promotedScore < incumbentScore, 'promoted candidate penalizes the critical-risk task more than the incumbent');
});

test('scheduler-weight candidate: canary regression rolls back automatically and the incumbent keeps live authority', () => {
  const registry = new PolicyRegistry({ kind: 'scheduler-weights', weights: DEFAULT_SCHEDULER_WEIGHTS });
  const candidateWeights = { ...DEFAULT_SCHEDULER_WEIGHTS, riskPenaltyCritical: 60 };
  const v = registry.registerCandidate({ kind: 'scheduler-weights', weights: candidateWeights });
  registry.advanceStage(v, 'SHADOW');
  registry.advanceStage(v, 'BENCHMARK');
  const { incumbentScores, candidateScores } = buildSchedulerWeightDomainScores({ candidateWeights });
  candidateScores[SCHEDULER_WEIGHTS_TASK_CLASS].taskSuccessRate = 1;
  incumbentScores[SCHEDULER_WEIGHTS_TASK_CLASS].taskSuccessRate = 0.6;
  registry.promoteThroughGate({ version: v, targetDomain: SCHEDULER_WEIGHTS_TASK_CLASS, incumbentScores, candidateScores });
  assert.equal(registry.getVersion(v).stage, 'CANARY');

  const canaryResult = registry.recordCanaryResult(v, controlCanary(), controlCanary({ securityIncidentCount: 1 }));
  assert.equal(canaryResult.verdict, 'ROLLBACK');
  assert.equal(registry.getVersion(v).stage, 'ROLLED_BACK');
  assert.equal(registry.getActivePolicy().isFallback, true, 'incumbent/fallback keeps live authority after canary rollback');
});
