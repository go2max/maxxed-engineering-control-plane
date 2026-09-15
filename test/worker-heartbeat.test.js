import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerHeartbeatMonitor } from '../src/scheduler/worker-heartbeat.js';
import { ClaimAuthority } from '../src/core/claim-authority.js';
import { TaskGraph, TaskState } from '../src/core/task-graph.js';
import { PortfolioScheduler } from '../src/scheduler/portfolio-scheduler.js';

test('worker becomes suspect only after missing its heartbeat window, not before', () => {
  const monitor = new WorkerHeartbeatMonitor({ suspectAfterMs: 1000 });
  monitor.heartbeat('worker-1', 0);
  assert.equal(monitor.isSuspect('worker-1', 500), false);
  assert.equal(monitor.isSuspect('worker-1', 1500), true);
});

test('a worker with no recorded heartbeat is not treated as suspect (additive safety, not source of truth)', () => {
  const monitor = new WorkerHeartbeatMonitor();
  assert.equal(monitor.isSuspect('unknown-worker'), false);
});

test('heartbeat suspicion withholds new dispatch but never touches an existing lease', () => {
  const graph = new TaskGraph();
  const claims = new ClaimAuthority();
  const monitor = new WorkerHeartbeatMonitor({ suspectAfterMs: 1000 });

  graph.add({ key: 'task-a', repository: 'org/repo', state: TaskState.READY });
  const claim = claims.claim({ taskKey: 'task-a', ownerId: 'worker-1', scopes: ['repo:org/repo'] }, 0);
  graph.setState('task-a', TaskState.CLAIMED, { workerId: claim.ownerId, claimId: claim.claimId });

  graph.add({ key: 'task-b', repository: 'org/repo', state: TaskState.READY });

  monitor.heartbeat('worker-1', 0);
  // worker-1 goes silent past the suspect window, but its existing claim on task-a must be
  // untouched: only ClaimAuthority TTL/fencing governs revocation.
  const now = 5000;
  assert.equal(monitor.isSuspect('worker-1', now), true);
  assert.equal(claims.validate(claim, now), true);

  const scheduler = new PortfolioScheduler({ graph, heartbeatMonitor: monitor });
  const dispatches = scheduler.plan([{ workerId: 'worker-1', state: 'AVAILABLE', capacity: { freeSlots: 1 } }], { now, activeClaims: claims.list() });
  // Suspect worker-1 must not receive the newly-ready task-b.
  assert.equal(dispatches.length, 0);
});

test('a healthy (non-suspect) worker is still eligible for new dispatch', () => {
  const graph = new TaskGraph();
  const monitor = new WorkerHeartbeatMonitor({ suspectAfterMs: 1000 });
  graph.add({ key: 'task-a', repository: 'org/repo', state: TaskState.READY });
  monitor.heartbeat('worker-1', 0);
  const scheduler = new PortfolioScheduler({ graph, heartbeatMonitor: monitor });
  const dispatches = scheduler.plan([{ workerId: 'worker-1', state: 'AVAILABLE', capacity: { freeSlots: 1 } }], { now: 100, activeClaims: [] });
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].workerId, 'worker-1');
});

test('heartbeat monitor snapshot/restore round-trips', () => {
  const monitor = new WorkerHeartbeatMonitor({ suspectAfterMs: 2000 });
  monitor.heartbeat('worker-1', 10);
  const snap = monitor.snapshot();
  const restored = new WorkerHeartbeatMonitor({ suspectAfterMs: 1 });
  restored.restore(snap);
  assert.equal(restored.suspectAfterMs, 2000);
  assert.equal(restored.lastSeen('worker-1'), 10);
});
