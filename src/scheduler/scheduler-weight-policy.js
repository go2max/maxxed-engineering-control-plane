// Scheduler-weight policy candidates, versioned through the EXISTING promotion stage machine
// (src/training/policy-promotion.js's PolicyRegistry, offline replay -> shadow -> benchmark ->
// canary -> promotion gate -> production). Closes the gap noted on issue #101: PolicyRegistry and
// PolicyTrainingLoop are already generic over *any* versioned policy object -- neither is tied to
// a particular policy shape -- but until now nothing outside the outcome-derived task-class summary
// (policy-training-loop.js) had actually driven a candidate through that machinery. This module
// registers a genuinely different policy type (the scoring-weight coefficients scoreTask() in
// portfolio-scheduler.js already accepts, see DEFAULT_SCHEDULER_WEIGHTS there) through the SAME
// PolicyRegistry, proving the stage machine generalizes rather than needing its own parallel
// version of shadow/canary/promotion for scheduler policies.
//
// This module adds no new promotion/rollback authority: BENCHMARK still delegates to
// evaluatePromotionGate (promotion-gate.js) via PolicyRegistry#promoteThroughGate, CANARY still
// delegates to evaluateCanary via PolicyRegistry#recordCanaryResult, and PRODUCTION authority is
// still gated by an explicit approvedBy in PolicyRegistry#finalizePromotion. The only things this
// module supplies are (a) a deterministic offline-replay evaluator that turns a candidate weight
// set into real CaseResult/DomainScores evidence, and (b) a thin, optional wiring point
// (PortfolioScheduler's `weights` option, see portfolio-scheduler.js) a caller can feed a
// PRODUCTION-stage candidate's weights into -- deliberately not auto-loaded from any registry here,
// per this repo's primitive-wave/wiring-wave separation (docs/MULTI_AGENT_ORCHESTRATION_PLAYBOOK.md).
//
// reuse: internal -- PolicyRegistry, evaluatePromotionGate and aggregateDomainScores are all
// reused unchanged; this module is new only in the sense that scheduler-weight replay scenarios
// and their CaseResult shaping did not exist before.

import { TaskGraph } from '../core/task-graph.js';
import { DEFAULT_SCHEDULER_WEIGHTS, scoreTask } from './portfolio-scheduler.js';
import { aggregateDomainScores } from '../training/score-benchmark.js';

export const SCHEDULER_WEIGHTS_TASK_CLASS = 'scheduler-weights';

/**
 * A fixed set of deterministic offline-replay scenarios, each encoding one scheduling invariant a
 * reasonable weight set should respect (e.g. "a task blocking more downstream work should not
 * score lower than a task blocking none, all else equal"). Each scenario returns a CaseResult
 * (score-benchmark.js shape) for a given weights object: `success` is whether the candidate weight
 * set preserves that invariant. This is real (if synthetic) offline evidence -- not a live outcome
 * record -- which is exactly what the OFFLINE_REPLAY stage is for; it does not claim to be SHADOW
 * evidence (real production traffic), which stays live-outcome-derived as it is for other policies.
 */
function buildScenarios() {
  const scenarios = [];

  // Invariant 1: higher priority scores higher, all else equal.
  {
    const graph = new TaskGraph();
    graph.add({ key: 'low', repository: 'r', metadata: { priority: 1 } });
    graph.add({ key: 'high', repository: 'r', metadata: { priority: 5 } });
    scenarios.push({
      caseId: 'priority-ordering',
      check: (weights) => {
        const now = 0;
        const low = scoreTask(graph, graph.get('low'), { now, weights }).score;
        const high = scoreTask(graph, graph.get('high'), { now, weights }).score;
        return high > low;
      },
    });
  }

  // Invariant 2: a task unlocking more downstream work scores at least as high as one that unlocks
  // nothing, all else equal.
  {
    const graph = new TaskGraph();
    graph.add({ key: 'leaf', repository: 'r', metadata: { priority: 1 } });
    graph.add({ key: 'blocker', repository: 'r', metadata: { priority: 1 } });
    graph.add({ key: 'dependent-a', repository: 'r', metadata: { priority: 1 }, dependencies: ['blocker'] });
    graph.add({ key: 'dependent-b', repository: 'r', metadata: { priority: 1 }, dependencies: ['blocker'] });
    scenarios.push({
      caseId: 'unlock-ordering',
      check: (weights) => {
        const now = 0;
        const leaf = scoreTask(graph, graph.get('leaf'), { now, weights }).score;
        const blocker = scoreTask(graph, graph.get('blocker'), { now, weights }).score;
        return blocker >= leaf;
      },
    });
  }

  // Invariant 3: a critical-risk task is penalized less than or equal to nothing beyond a
  // high-risk task (critical penalty must not be weaker than high).
  {
    const graph = new TaskGraph();
    graph.add({ key: 'risky-high', repository: 'r', metadata: { priority: 1 }, riskClass: 'high' });
    graph.add({ key: 'risky-critical', repository: 'r', metadata: { priority: 1 }, riskClass: 'critical' });
    scenarios.push({
      caseId: 'risk-ordering',
      check: (weights) => {
        const now = 0;
        const high = scoreTask(graph, graph.get('risky-high'), { now, weights }).score;
        const critical = scoreTask(graph, graph.get('risky-critical'), { now, weights }).score;
        return critical <= high;
      },
    });
  }

  // Invariant 4: a task that has previously failed more times scores no higher than an otherwise
  // identical task with fewer failures.
  {
    const graph = new TaskGraph();
    graph.add({ key: 'clean', repository: 'r', metadata: { priority: 1, failureCount: 0 } });
    graph.add({ key: 'flaky', repository: 'r', metadata: { priority: 1, failureCount: 3 } });
    scenarios.push({
      caseId: 'failure-penalty-ordering',
      check: (weights) => {
        const now = 0;
        const clean = scoreTask(graph, graph.get('clean'), { now, weights }).score;
        const flaky = scoreTask(graph, graph.get('flaky'), { now, weights }).score;
        return clean >= flaky;
      },
    });
  }

  // Invariant 5: starvation (age) monotonically raises score for an otherwise-identical task.
  {
    const graph = new TaskGraph();
    graph.add({ key: 'aged', repository: 'r', metadata: { priority: 1, createdAt: 0 } });
    scenarios.push({
      caseId: 'starvation-ordering',
      check: (weights) => {
        const task = graph.get('aged');
        const fresh = scoreTask(graph, task, { now: 0, starvationMs: 30 * 60_000, weights }).score;
        const stale = scoreTask(graph, task, { now: 4 * 30 * 60_000, starvationMs: 30 * 60_000, weights }).score;
        return stale >= fresh;
      },
    });
  }

  return scenarios;
}

export const SCHEDULER_REPLAY_SCENARIOS = Object.freeze(buildScenarios());

/**
 * Run every offline-replay scenario against one weight set and return score-benchmark.js's
 * CaseResult shape per scenario (success = invariant held). Pure function.
 */
export function replaySchedulerWeights(weights, scenarios = SCHEDULER_REPLAY_SCENARIOS) {
  return scenarios.map((scenario) => ({ caseId: scenario.caseId, success: Boolean(scenario.check(weights)) }));
}

/**
 * Aggregate incumbent vs candidate weight sets into the DomainScores shape
 * PolicyRegistry#promoteThroughGate (BENCHMARK stage) already requires, keyed under
 * SCHEDULER_WEIGHTS_TASK_CLASS as the target domain -- the same DomainScores contract every other
 * policy type in this repo uses, reusing aggregateDomainScores unchanged.
 */
export function buildSchedulerWeightDomainScores({ incumbentWeights = DEFAULT_SCHEDULER_WEIGHTS, candidateWeights, scenarios = SCHEDULER_REPLAY_SCENARIOS } = {}) {
  if (!candidateWeights) throw new Error('candidateWeights is required');
  const incumbentScores = { [SCHEDULER_WEIGHTS_TASK_CLASS]: aggregateDomainScores(replaySchedulerWeights(incumbentWeights, scenarios)) };
  const candidateScores = { [SCHEDULER_WEIGHTS_TASK_CLASS]: aggregateDomainScores(replaySchedulerWeights(candidateWeights, scenarios)) };
  return { incumbentScores, candidateScores };
}
