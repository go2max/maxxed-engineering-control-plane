import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGraph } from '../src/core/task-graph.js';
import { PortfolioScheduler, adaptiveLaneCapacity } from '../src/scheduler/portfolio-scheduler.js';

const worker = (workerId, freeSlots, cpuPct, state = 'AVAILABLE') => ({ workerId, state, capabilities: ['node'], capacity: { freeSlots, freeMemoryMb: 8192 }, pressure: { cpuPct }, metadata: { os: 'linux', arch: 'x64' } });

test('adaptive lane capacity contracts under pressure and excludes degraded hosts', () => {
  assert.equal(adaptiveLaneCapacity([worker('a', 4, 10), worker('b', 4, 75), worker('c', 4, 10, 'DEGRADED')], 20), 6);
  assert.equal(adaptiveLaneCapacity([worker('a', 4, 96)], 20), 0);
});

test('scheduler reports repository WIP backpressure', () => {
  const graph = new TaskGraph();
  graph.add({ key: 'a', repository: 'repo' });
  graph.add({ key: 'b', repository: 'repo' });
  const scheduler = new PortfolioScheduler({ graph, repoLaneLimit: 1, totalLaneLimit: 4 });
  const report = scheduler.planWithReport([worker('w', 4, 10)]);
  assert.equal(report.dispatches.length, 1);
  assert.equal(report.backpressure.find((item) => item.taskKey !== report.dispatches[0].taskKey).reason, 'repository-wip-limit');
});

test('scheduler reports no eligible worker and global capacity pressure', () => {
  const graph = new TaskGraph();
  graph.add({ key: 'gpu', repository: 'gpu', requirements: { capabilities: ['gpu'] } });
  const noWorker = new PortfolioScheduler({ graph }).planWithReport([worker('w', 2, 10)]);
  assert.equal(noWorker.backpressure[0].reason, 'no-eligible-worker');

  const graph2 = new TaskGraph();
  graph2.add({ key: 'a', repository: 'a' });
  const noCapacity = new PortfolioScheduler({ graph: graph2 }).planWithReport([worker('w', 2, 96)]);
  assert.equal(noCapacity.adaptiveLimit, 0);
  assert.equal(noCapacity.backpressure[0].reason, 'global-lane-capacity');
});
