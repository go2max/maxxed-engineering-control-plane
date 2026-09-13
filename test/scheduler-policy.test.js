import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGraph } from '../src/core/task-graph.js';
import { PortfolioScheduler } from '../src/scheduler/portfolio-scheduler.js';
import { SchedulerPolicy, rebalanceRecommendations } from '../src/scheduler/scheduler-policy.js';

const worker = { workerId: 'w1', state: 'AVAILABLE', capabilities: [], capacity: { freeSlots: 4, freeMemoryMb: 8192 }, pressure: { cpuPct: 10 }, metadata: { os: 'linux', arch: 'x64' } };

test('deadline urgency can move near-deadline task ahead', () => {
  const graph = new TaskGraph();
  graph.add({ key: 'later', repository: 'r1', metadata: { priority: 3 } });
  graph.add({ key: 'urgent', repository: 'r2', metadata: { priority: 0, deadlineAt: 30 * 60_000 } });
  const policy = new SchedulerPolicy();
  const scheduler = new PortfolioScheduler({ graph, totalLaneLimit: 1, policy });
  const [dispatch] = scheduler.plan([worker], { now: 0 });
  assert.equal(dispatch.taskKey, 'urgent');
  assert.equal(dispatch.explanation.deadlineUrgency, 35);
});

test('freeze and drain block new work without mutating task truth', () => {
  const graph = new TaskGraph();
  graph.add({ key: 'a', repository: 'r1' });
  graph.add({ key: 'b', repository: 'r2' });
  const policy = new SchedulerPolicy();
  policy.freezeRepository('r1', 'release-freeze');
  policy.drainRepository('r2', 'maintenance');
  const report = new PortfolioScheduler({ graph, policy }).planWithReport([worker]);
  assert.equal(report.dispatches.length, 0);
  assert.deepEqual(report.backpressure.map((item) => item.reason).sort(), ['repository-draining', 'repository-frozen']);
});

test('priority overrides are bounded and auditable', () => {
  const policy = new SchedulerPolicy({ maxPriorityAdjustment: 20 });
  assert.throws(() => policy.setPriorityOverride({ taskKey: 'x', adjustment: 21, reason: 'too much' }), /within/);
  assert.throws(() => policy.setPriorityOverride({ taskKey: 'x', adjustment: 10 }), /reason/);
  policy.setPriorityOverride({ taskKey: 'x', adjustment: 10, reason: 'customer incident', expiresAt: 1000 });
  assert.equal(policy.evaluate({ key: 'x', metadata: {} }, 500).priorityAdjustment, 10);
  assert.equal(policy.evaluate({ key: 'x', metadata: {} }, 1000).priorityAdjustment, 0);
});

test('rebalancing identifies concentration and stranded free capacity', () => {
  const recommendations = rebalanceRecommendations({
    workers: [worker],
    activeClaims: [
      { repository: 'r1' }, { repository: 'r1' }, { repository: 'r1' }, { repository: 'r2' }
    ],
    backpressure: [{ reason: 'repository-wip-limit', repository: 'r1' }]
  });
  assert.ok(recommendations.some((item) => item.action === 'redistribute-free-capacity'));
  assert.ok(recommendations.some((item) => item.action === 'reduce-repository-concentration'));
});
