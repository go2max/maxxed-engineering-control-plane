import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGraph, TaskState } from '../src/core/task-graph.js';
import { PortfolioScheduler, scoreTask } from '../src/scheduler/portfolio-scheduler.js';

function worker(workerId, capabilities, freeSlots = 1, cpuPct = 0) {
  return { workerId, capabilities, capacity: { freeSlots, freeMemoryMb: 8192 }, pressure: { cpuPct }, metadata: { os: 'linux', arch: 'x64' } };
}

test('scheduler prioritizes dependency unlock leverage and obeys repository lane caps', () => {
  const graph = new TaskGraph();
  graph.add({ key: 'root', repository: 'a', metadata: { priority: 1, createdAt: 0 } });
  graph.add({ key: 'dependent', repository: 'a', dependencies: ['root'] });
  graph.add({ key: 'other', repository: 'a', metadata: { priority: 100, createdAt: 0 } });
  const scheduler = new PortfolioScheduler({ graph, repoLaneLimit: 1, totalLaneLimit: 4 });
  const plan = scheduler.plan([worker('w1', [])], { now: 10_000 });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].taskKey, 'other');
});

test('scheduler matches task capabilities and spreads across worker slots', () => {
  const graph = new TaskGraph();
  graph.add({ key: 'browser', repository: 'web', requirements: { capabilities: ['browser'] }, metadata: { priority: 5 } });
  graph.add({ key: 'node', repository: 'api', requirements: { capabilities: ['node'] }, metadata: { priority: 4 } });
  const scheduler = new PortfolioScheduler({ graph, repoLaneLimit: 2, totalLaneLimit: 4 });
  const plan = scheduler.plan([worker('small', ['node']), worker('browser-host', ['node', 'browser'], 2)]);
  assert.equal(plan.find((entry) => entry.taskKey === 'browser').workerId, 'browser-host');
  assert.equal(plan.length, 2);
});

test('starvation contributes deterministic score and accepted dependencies unlock work', () => {
  const graph = new TaskGraph();
  graph.add({ key: 'dep' });
  graph.add({ key: 'waiting', dependencies: ['dep'], metadata: { priority: 0, createdAt: 0 } });
  assert.equal(graph.frontier().some((task) => task.key === 'waiting'), false);
  graph.setState('dep', TaskState.ACCEPTED);
  const task = graph.get('waiting');
  const scored = scoreTask(graph, task, { now: 60 * 60_000, starvationMs: 30 * 60_000 });
  assert.equal(scored.starvationSteps, 2);
  assert.equal(graph.frontier().some((candidate) => candidate.key === 'waiting'), true);
});
