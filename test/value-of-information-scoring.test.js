import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGraph } from '../src/core/task-graph.js';
import { ExecutionCheckpointStore } from '../src/leverage/execution-checkpoint.js';
import {
  ServiceClass,
  scoreTaskByValueOfInformation,
  rankTasksByValueOfInformation,
  ShadowDecisionLog,
  preemptTaskToCheckpoint,
  resumePreemptedTask,
} from '../src/scheduler/value-of-information-scoring.js';

function task(key, metadata = {}, extra = {}) {
  return { key, metadata, ...extra };
}

test('VoI score rewards higher expected value per unit of resource cost', () => {
  const graph = new TaskGraph();
  const cheap = task('cheap', { productValue: 100, executionCostUnits: 1, acceptanceProbability: 1, createdAt: 0 });
  const expensive = task('expensive', { productValue: 100, executionCostUnits: 50, acceptanceProbability: 1, createdAt: 0 });
  const cheapScore = scoreTaskByValueOfInformation(graph, cheap, { now: 0 });
  const expensiveScore = scoreTaskByValueOfInformation(graph, expensive, { now: 0 });
  assert.ok(cheapScore.score > expensiveScore.score, 'cheaper task with same product value should score higher per resource unit');
});

test('probe-class tasks with high information gain can outrank a low-signal implementation task of similar cost', () => {
  const graph = new TaskGraph();
  const probe = task('probe', {
    serviceClass: ServiceClass.PROBE,
    isProbe: true,
    riskReductionValue: 500,
    informationGain: 0.9,
    executionCostUnits: 1,
    acceptanceProbability: 0.9,
    createdAt: 0,
  });
  const implementation = task('impl', {
    productValue: 10,
    executionCostUnits: 1,
    acceptanceProbability: 0.9,
    createdAt: 0,
  });
  const ranked = rankTasksByValueOfInformation(graph, [implementation, probe], { now: 0 });
  assert.equal(ranked[0].task.key, 'probe', 'cheap high-information-gain probe should be scheduled ahead of a low-value implementation task');
});

test('irreversible work is discounted relative to equally-valuable reversible work', () => {
  const graph = new TaskGraph();
  const reversible = task('reversible', { productValue: 100, executionCostUnits: 1, acceptanceProbability: 1, reversibility: 1, createdAt: 0 });
  const irreversible = task('irreversible', { productValue: 100, executionCostUnits: 1, acceptanceProbability: 1, reversibility: 0, createdAt: 0 });
  const a = scoreTaskByValueOfInformation(graph, reversible, { now: 0 });
  const b = scoreTaskByValueOfInformation(graph, irreversible, { now: 0 });
  assert.ok(a.score > b.score);
});

test('fairness/aging: a low-value task strictly gains score as it waits, without bound', () => {
  const graph = new TaskGraph();
  const lowValue = task('low', { productValue: 1, executionCostUnits: 1, acceptanceProbability: 1, createdAt: 0 });
  const starvationMs = 30 * 60_000;
  const scoreAt = (now) => scoreTaskByValueOfInformation(graph, lowValue, { now, starvationMs }).score;
  const s0 = scoreAt(0);
  const s1 = scoreAt(starvationMs);
  const s5 = scoreAt(starvationMs * 5);
  const s20 = scoreAt(starvationMs * 20);
  assert.ok(s1 > s0);
  assert.ok(s5 > s1);
  assert.ok(s20 > s5, 'aging bonus must keep growing across many starvation steps, guaranteeing no permanent starvation');
});

test('no-starvation: an aged low-value task eventually outranks a fresh high-value task', () => {
  const graph = new TaskGraph();
  const starvationMs = 30 * 60_000;
  const agedLowValue = task('aged-low', { productValue: 1, executionCostUnits: 1, acceptanceProbability: 1, createdAt: 0 });
  const freshHighValue = task('fresh-high', { productValue: 1000, executionCostUnits: 1, acceptanceProbability: 1, createdAt: starvationMs * 200 });
  // At the same "now" as freshHighValue's creation, aged-low has waited 200 starvation steps.
  const ranked = rankTasksByValueOfInformation(graph, [freshHighValue, agedLowValue], { now: starvationMs * 200, starvationMs });
  assert.equal(ranked[0].task.key, 'aged-low', 'sufficiently aged low-value work must eventually clear any fixed high-value threshold');
});

test('tasks with no VoI metadata at all still score without throwing (neutral defaults)', () => {
  const graph = new TaskGraph();
  const bare = task('bare');
  assert.doesNotThrow(() => scoreTaskByValueOfInformation(graph, bare));
});

test('ranking is deterministic and tiebreaks on task key', () => {
  const graph = new TaskGraph();
  const a = task('a', { productValue: 10, executionCostUnits: 1, createdAt: 0 });
  const b = task('b', { productValue: 10, executionCostUnits: 1, createdAt: 0 });
  const ranked = rankTasksByValueOfInformation(graph, [b, a], { now: 0 });
  assert.deepEqual(ranked.map((r) => r.task.key), ['a', 'b']);
});

test('ShadowDecisionLog records counterfactual rankings without any live dispatch authority', () => {
  const log = new ShadowDecisionLog();
  const id = log.record({
    now: 1000,
    incumbentRanking: [{ taskKey: 't1', score: 10 }, { taskKey: 't2', score: 5 }],
    voiRanking: [{ taskKey: 't2', score: 20 }, { taskKey: 't1', score: 8 }],
    context: { cycle: 1 },
  });
  assert.equal(log.entries.length, 1);
  assert.equal(log.entries[0].incumbentRanking[0].taskKey, 't1');
  assert.equal(log.entries[0].voiRanking[0].taskKey, 't2');

  log.recordOutcome(id, 't1', { accepted: true, realizedValue: 10, resourceUnitsConsumed: 2 });
  log.recordOutcome(id, 't2', { accepted: true, realizedValue: 40, resourceUnitsConsumed: 2 });

  const economics = log.compareEconomics({ topK: 2 });
  assert.equal(economics.incumbent.acceptedValue, 50);
  assert.equal(economics.voi.acceptedValue, 50);
  assert.ok(economics.voi.valuePerResource >= economics.incumbent.valuePerResource, 'VoI ranking should be at least as economical since it ranks the higher-value outcome first');
});

test('ShadowDecisionLog snapshot/restore round-trips', () => {
  const log = new ShadowDecisionLog({ maxEntries: 5 });
  log.record({ now: 1, incumbentRanking: [{ taskKey: 't1', score: 1 }], voiRanking: [{ taskKey: 't1', score: 1 }] });
  const snap = log.snapshot();
  const restored = new ShadowDecisionLog();
  restored.restore(snap);
  assert.equal(restored.entries.length, 1);
  assert.equal(restored.maxEntries, 5);
});

test('ShadowDecisionLog caps entries at maxEntries, dropping oldest first', () => {
  const log = new ShadowDecisionLog({ maxEntries: 2 });
  log.record({ now: 1, incumbentRanking: [{ taskKey: 't1', score: 1 }], voiRanking: [{ taskKey: 't1', score: 1 }] });
  log.record({ now: 2, incumbentRanking: [{ taskKey: 't2', score: 1 }], voiRanking: [{ taskKey: 't2', score: 1 }] });
  log.record({ now: 3, incumbentRanking: [{ taskKey: 't3', score: 1 }], voiRanking: [{ taskKey: 't3', score: 1 }] });
  assert.equal(log.entries.length, 2);
  assert.deepEqual(log.entries.map((e) => e.incumbentRanking[0].taskKey), ['t2', 't3']);
});

test('preemption checkpoints via the existing ExecutionCheckpointStore and resumes with a preempted flag', () => {
  const store = new ExecutionCheckpointStore();
  preemptTaskToCheckpoint(store, 'task-a', { completedSteps: ['step1'], branchRef: 'refs/heads/wip' }, { generation: 1, now: 100 });
  const resumed = resumePreemptedTask(store, 'task-a');
  assert.equal(resumed.wasPreempted, true);
  assert.equal(resumed.taskKey, 'task-a');
  assert.deepEqual(resumed.completedSteps, ['step1']);
});

test('preempted checkpoint still enforces stale-generation lease fencing from ExecutionCheckpointStore', () => {
  const store = new ExecutionCheckpointStore();
  preemptTaskToCheckpoint(store, 'task-b', {}, { generation: 5, now: 100 });
  assert.throws(() => resumePreemptedTask(store, 'task-b', { minGeneration: 6 }), (err) => err.code === 'STALE_GENERATION');
});

test('resuming a non-preempted normal checkpoint reports wasPreempted false', () => {
  const store = new ExecutionCheckpointStore();
  store.save('task-c', { completedSteps: [] }, { generation: 1 });
  const resumed = resumePreemptedTask(store, 'task-c');
  assert.equal(resumed.wasPreempted, false);
});

test('resumePreemptedTask returns null for an unknown task, same as the underlying store', () => {
  const store = new ExecutionCheckpointStore();
  assert.equal(resumePreemptedTask(store, 'unknown'), null);
});
