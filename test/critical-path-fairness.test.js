import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGraph } from '../src/core/task-graph.js';
import { PortfolioScheduler, scoreTask } from '../src/scheduler/portfolio-scheduler.js';
import { criticalPathScore } from '../src/scheduler/critical-path.js';

const worker = { workerId: 'w', state: 'AVAILABLE', capabilities: [], capacity: { freeSlots: 4, freeMemoryMb: 8192 }, pressure: { cpuPct: 10 }, metadata: { os: 'linux', arch: 'x64' } };

test('critical path depth gives upstream work additional score', () => {
  const graph = new TaskGraph();
  graph.add({ key: 'root', repository: 'r1' });
  graph.add({ key: 'mid', dependencies: ['root'] });
  graph.add({ key: 'leaf', dependencies: ['mid'] });
  graph.add({ key: 'isolated', repository: 'r2' });
  assert.equal(criticalPathScore(graph, 'root').depth, 2);
  assert.ok(scoreTask(graph, graph.get('root')).score > scoreTask(graph, graph.get('isolated')).score);
});

test('active portfolio concentration applies fairness penalty', () => {
  const graph = new TaskGraph();
  graph.add({ key: 'same-product', repository: 'r1', product: 'p1' });
  graph.add({ key: 'other-product', repository: 'r2', product: 'p2' });
  const activeClaims = [
    { repository: 'r1', product: 'p1' },
    { repository: 'r1', product: 'p1' },
    { repository: 'r1', product: 'p1' }
  ];
  const same = scoreTask(graph, graph.get('same-product'), { activeClaims });
  const other = scoreTask(graph, graph.get('other-product'), { activeClaims });
  assert.ok(same.fairness.total > 0);
  assert.ok(other.score > same.score);
});

test('scheduler selects critical-path work before equally prioritized isolated work', () => {
  const graph = new TaskGraph();
  graph.add({ key: 'critical', repository: 'critical' });
  graph.add({ key: 'dependent', dependencies: ['critical'] });
  graph.add({ key: 'isolated', repository: 'isolated' });
  const scheduler = new PortfolioScheduler({ graph, totalLaneLimit: 1 });
  const plan = scheduler.plan([worker]);
  assert.equal(plan[0].taskKey, 'critical');
});
