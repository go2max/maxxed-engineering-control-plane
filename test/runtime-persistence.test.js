import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGraph, TaskState } from '../src/core/task-graph.js';
import { ClaimAuthority } from '../src/core/claim-authority.js';
import { RepairController } from '../src/verification/repair-controller.js';
import { snapshotRuntime, restoreRuntime } from '../src/core/runtime-state.js';
import { Verdict } from '../src/verification/verifier.js';

test('restart invalidates active claim and safely returns restartable task to ready', () => {
  const graph = new TaskGraph();
  const claims = new ClaimAuthority();
  const repairs = new RepairController();
  graph.add({ key: 't1', repository: 'repo', metadata: { restartable: true } });
  const stale = claims.claim({ taskKey: 't1', ownerId: 'w1', scopes: ['repo:repo'] }, 1000);
  graph.setState('t1', TaskState.CLAIMED);
  const snapshot = snapshotRuntime({ graph, claims, repairs });

  const graph2 = new TaskGraph();
  const claims2 = new ClaimAuthority();
  const repairs2 = new RepairController();
  const result = restoreRuntime(snapshot, { graph: graph2, claims: claims2, repairs: repairs2, now: 2000 });
  assert.equal(result.activeClaims, 0);
  assert.equal(graph2.get('t1').state, TaskState.READY);
  assert.equal(claims2.validate(stale, 2001), false);
  const fresh = claims2.claim({ taskKey: 't1', ownerId: 'w2', scopes: ['repo:repo'] }, 2001);
  assert.ok(fresh.generation > stale.generation);
});

test('non-restartable claimed task blocks after restart', () => {
  const graph = new TaskGraph(); const claims = new ClaimAuthority(); const repairs = new RepairController();
  graph.add({ key: 't1', metadata: { restartable: false } });
  claims.claim({ taskKey: 't1', ownerId: 'w1' }, 1000);
  graph.setState('t1', TaskState.CLAIMED);
  const snapshot = snapshotRuntime({ graph, claims, repairs });
  const graph2 = new TaskGraph(); const claims2 = new ClaimAuthority(); const repairs2 = new RepairController();
  restoreRuntime(snapshot, { graph: graph2, claims: claims2, repairs: repairs2, now: 2000 });
  assert.equal(graph2.get('t1').state, TaskState.BLOCKED);
});

test('repair budget and breaker state survive restart', () => {
  const graph = new TaskGraph(); const claims = new ClaimAuthority(); const repairs = new RepairController({ breakerThreshold: 2 });
  graph.add({ key: 't1' });
  repairs.decide('t1', { verdict: Verdict.REPAIR, failed: ['tests'], reason: 'failed' });
  repairs.decide('t1', { verdict: Verdict.REPAIR, failed: ['tests'], reason: 'failed' });
  const snapshot = snapshotRuntime({ graph, claims, repairs });
  const graph2 = new TaskGraph(); const claims2 = new ClaimAuthority(); const repairs2 = new RepairController();
  restoreRuntime(snapshot, { graph: graph2, claims: claims2, repairs: repairs2 });
  assert.equal(repairs2.get('t1').breakerOpen, true);
});
