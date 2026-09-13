import test from 'node:test';
import assert from 'node:assert/strict';
import { ClaimAuthority } from '../src/core/claim-authority.js';
import { EngineeringOrchestrator } from '../src/core/orchestrator.js';
import { restoreRuntime, snapshotRuntime } from '../src/core/runtime-state.js';
import { TaskGraph, TaskState } from '../src/core/task-graph.js';

class RepairStateStub {
  snapshot() { return { version: 1, rows: [] }; }
  restore() {}
}

function claimedRuntime({ restartable = true, ttlMs = 10_000, now = 1_000 } = {}) {
  const graph = new TaskGraph();
  const claims = new ClaimAuthority();
  const repairs = new RepairStateStub();
  graph.add({ key: 'task-a', repository: 'org/repo', state: TaskState.READY, metadata: { restartable, mutationScopes: ['scope:shared'] } });
  const claim = claims.claim({ taskKey: 'task-a', ownerId: 'worker-1', scopes: ['repo:org/repo', 'scope:shared'], ttlMs }, now);
  graph.setState('task-a', TaskState.CLAIMED, { workerId: claim.ownerId, claimId: claim.claimId });
  return { graph, claims, repairs, claim };
}

test('runtime snapshot restores live lease authority and resource scope locks', () => {
  const source = claimedRuntime({ ttlMs: 10_000, now: 1_000 });
  const snapshot = snapshotRuntime(source);
  const graph = new TaskGraph();
  const claims = new ClaimAuthority();
  const repairs = new RepairStateStub();

  const restored = restoreRuntime(snapshot, { graph, claims, repairs, now: 5_000 });

  assert.equal(restored.activeClaims, 1);
  assert.equal(restored.expiredClaims, 0);
  assert.equal(graph.get('task-a').state, TaskState.CLAIMED);
  assert.equal(claims.validate(source.claim, 5_000), true);
  assert.equal(claims.claim({ taskKey: 'task-b', ownerId: 'worker-2', scopes: ['scope:shared'] }, 5_001), null);
});

test('expired restored lease is fenced and restartable task returns to frontier', () => {
  const source = claimedRuntime({ ttlMs: 10, now: 1_000 });
  const snapshot = snapshotRuntime(source);
  const graph = new TaskGraph();
  const claims = new ClaimAuthority();
  const repairs = new RepairStateStub();

  const restored = restoreRuntime(snapshot, { graph, claims, repairs, now: 1_010 });

  assert.equal(restored.activeClaims, 0);
  assert.equal(restored.expiredClaims, 1);
  assert.equal(graph.get('task-a').state, TaskState.READY);
  assert.equal(claims.validate(source.claim, 1_010), false);
  const replacement = claims.claim({ taskKey: 'task-a', ownerId: 'worker-2', scopes: ['repo:org/repo', 'scope:shared'] }, 1_011);
  assert.ok(replacement);
  assert.ok(replacement.generation > source.claim.generation);
});

test('expired restored lease leaves non-restartable task blocked', () => {
  const source = claimedRuntime({ restartable: false, ttlMs: 10, now: 1_000 });
  const snapshot = snapshotRuntime(source);
  const graph = new TaskGraph();
  const claims = new ClaimAuthority();
  const repairs = new RepairStateStub();

  restoreRuntime(snapshot, { graph, claims, repairs, now: 1_010 });

  assert.equal(graph.get('task-a').state, TaskState.BLOCKED);
  assert.match(graph.get('task-a').lineage.at(-1).evidence.reason, /non-restartable/);
});

test('dispatch reconciles an expired lease before reassigning the task', () => {
  const graph = new TaskGraph();
  const claims = new ClaimAuthority();
  graph.add({ key: 'task-a', repository: 'org/repo', state: TaskState.READY });
  const scheduler = {
    plan(workers) {
      if (!graph.isExecutable('task-a')) return [];
      return [{ taskKey: 'task-a', workerId: workers[0].workerId, repository: 'org/repo' }];
    }
  };
  const orchestrator = new EngineeringOrchestrator({ graph, claims, scheduler, verifier: {}, repairs: {} });

  const first = orchestrator.dispatch([{ workerId: 'worker-1' }], { now: 1_000 });
  assert.equal(first.length, 1);
  assert.equal(graph.get('task-a').state, TaskState.CLAIMED);

  const second = orchestrator.dispatch([{ workerId: 'worker-2' }], { now: 31_001 });

  assert.equal(second.length, 1);
  assert.equal(second[0].workerId, 'worker-2');
  assert.ok(second[0].claim.generation > first[0].claim.generation);
  assert.equal(claims.validate(first[0].claim, 31_001), false);
  assert.equal(graph.get('task-a').state, TaskState.CLAIMED);
});

test('v1 generation-only claim snapshots remain restorable', () => {
  const claims = new ClaimAuthority();
  claims.restore({ version: 1, generations: [{ taskKey: 'task-a', generation: 7 }] });
  const claim = claims.claim({ taskKey: 'task-a', ownerId: 'worker-1' }, 1_000);
  assert.equal(claim.generation, 8);
});
