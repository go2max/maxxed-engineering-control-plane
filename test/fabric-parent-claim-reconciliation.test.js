import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlPlaneRuntime } from '../src/service/control-plane-runtime.js';
import { AutonomousCodingLoop } from '../src/service/autonomous-coding-loop.js';
import { TaskState } from '../src/core/task-graph.js';

function delegatedRuntime({ claimAt = 0, claimTtlMs = 30_000, fabricState = 'LEASED', fabricWorkerId = 'worker-1', fabricLeaseExpiresAt = 40_000 } = {}) {
  let fleet;
  const fabricExecutionClient = { fleet: async () => structuredClone(fleet) };
  const runtime = new ControlPlaneRuntime({ fabricExecutionClient, fabricParentClaimTtlMs: 30_000 });
  runtime.graph.add({ key: 'task-a', repository: 'org/repo', state: TaskState.READY, metadata: { restartable: true } });
  const claim = runtime.claims.claim({ taskKey: 'task-a', ownerId: 'worker-1', scopes: ['repo:org/repo'], ttlMs: claimTtlMs }, claimAt);
  runtime.graph.setState('task-a', TaskState.CLAIMED, { workerId: claim.ownerId, claimId: claim.claimId });
  fleet = {
    tasks: [{
      taskId: claim.claimId,
      state: fabricState,
      updatedAt: claimAt,
      payload: { controlPlaneTaskKey: 'task-a', controlPlaneClaim: claim }
    }],
    leases: fabricState === 'LEASED' ? [{
      taskId: claim.claimId,
      workerId: fabricWorkerId,
      sessionId: `${fabricWorkerId}-session`,
      leaseId: 'fabric-lease',
      generation: 1,
      issuedAt: claimAt,
      expiresAt: fabricLeaseExpiresAt
    }] : []
  };
  return { runtime, claim, setFleet: (next) => { fleet = next; }, getFleet: () => fleet };
}

test('active fabric lease renews the current parent control-plane claim for long work', async () => {
  const { runtime, claim } = delegatedRuntime();

  await runtime.reconcileFabric(29_000);

  assert.equal(runtime.claims.validate(claim, 50_000), true);
  assert.equal(runtime.graph.get('task-a').state, TaskState.CLAIMED);
  assert.equal(runtime.status().fabric.leaseReconciliation.renewed, 1);
});

test('fabric worker reassignment may renew the same logical parent attempt', async () => {
  const { runtime, claim } = delegatedRuntime({ fabricWorkerId: 'worker-2' });

  await runtime.reconcileFabric(29_000);

  assert.equal(runtime.claims.validate(claim, 50_000), true);
  const event = runtime.journal.list().find((row) => row.type === 'fabric.parent-claims.renewed');
  assert.equal(event.payload.claims[0].fabricWorkerId, 'worker-2');
  assert.equal(runtime.claims.list()[0].ownerId, 'worker-1');
});

test('heartbeat or task presence without an active fabric lease does not renew parent authority', async () => {
  const { runtime, claim, getFleet, setFleet } = delegatedRuntime();
  const fleet = getFleet();
  setFleet({ ...fleet, leases: [] });

  await runtime.reconcileFabric(29_000);

  assert.equal(runtime.claims.validate(claim, 30_001), false);
  assert.equal(runtime.status().fabric.leaseReconciliation.renewed, 0);
});

test('already-expired parent claim is never resurrected and delegated task fails closed', async () => {
  const { runtime, claim } = delegatedRuntime({ claimTtlMs: 10, fabricLeaseExpiresAt: 50_000 });

  await runtime.reconcileFabric(11);
  const recovered = runtime.recoverExpired(11);

  assert.equal(runtime.claims.validate(claim, 11), false);
  assert.equal(runtime.claims.list().length, 0);
  assert.equal(recovered.length, 0);
  assert.equal(runtime.graph.get('task-a').state, TaskState.BLOCKED);
  assert.match(runtime.graph.get('task-a').lineage.at(-1).evidence.reason, /outlived parent claim/);
});

test('autonomous loop observes fabric authority before running expired-claim recovery', async () => {
  const order = [];
  const runtime = {
    paused: false,
    journal: { append() {} },
    async reconcileFabric() { order.push('reconcile'); return []; },
    recoverExpired() { order.push('recover'); return []; },
    graph: { list: () => [] },
    verificationLedger: { entries: [] },
    workerProvider: async () => [],
    reconcileModels() {},
    throughput: { target: () => ({ allowedConcurrency: 1 }) },
    readiness: () => ({ ready: true }),
    scheduler: { totalLaneLimit: 1 },
    orchestrator: { dispatch: () => [] }
  };
  const loop = new AutonomousCodingLoop({ runtime, fabricClient: { enqueue: async () => ({}) }, now: () => 10 });

  await loop.tick();

  assert.deepEqual(order.slice(0, 2), ['reconcile', 'recover']);
});
