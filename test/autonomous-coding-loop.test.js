import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlPlaneRuntime } from '../src/service/control-plane-runtime.js';
import { AutonomousCodingLoop } from '../src/service/autonomous-coding-loop.js';
import { compileCodingTask } from '../src/agents/coding-task.js';

function worker(id = 'w1', slots = 4) {
  return {
    workerId: id,
    state: 'AVAILABLE',
    capabilities: ['coding-agent', 'git', 'node'],
    capacity: { freeSlots: slots, freeMemoryMb: 8192 },
    pressure: { cpuPct: 10, memoryPct: 20 },
    metadata: {
      os: 'linux', arch: 'x64',
      localModels: [{ id: `${id}-coder`, endpoint: `http://${id}.local:8080`, capabilities: ['coding'], contextWindow: 32768, maxOutputTokens: 4096 }]
    }
  };
}

test('loop submits coding tasks and leaves non-coding tasks untouched', async () => {
  const enqueued = [];
  const fabric = { enqueue: async (task) => { enqueued.push(task); return task; }, fleet: async () => ({ tasks: [] }) };
  const runtime = new ControlPlaneRuntime({ workerProvider: async () => [worker()], fabricExecutionClient: fabric, throughputOptions: { baselineConcurrency: 1, targetMultiplier: 2, maxConcurrency: 4 } });
  runtime.ingest(compileCodingTask({ key: 'code-1', repository: 'r1', repoPath: '/repo1', objective: 'one' }));
  runtime.ingest(compileCodingTask({ key: 'code-2', repository: 'r2', repoPath: '/repo2', objective: 'two' }));
  runtime.ingest({ key: 'other', repository: 'r3', objective: 'not for coding executor', state: 'READY' });
  const loop = new AutonomousCodingLoop({ runtime, fabricClient: fabric, now: () => 1000 });
  const result = await loop.tick();
  assert.equal(result.submitted.length, 2);
  assert.equal(enqueued.length, 2);
  assert.equal(runtime.graph.get('other').state, 'READY');
  assert.equal(result.throughput.desiredConcurrency, 2);
});

test('dispatchToFabric never claims unrelated executor types', async () => {
  const enqueued = [];
  const fabric = { enqueue: async (task) => { enqueued.push(task); return task; }, fleet: async () => ({ tasks: [] }) };
  const runtime = new ControlPlaneRuntime({ workerProvider: async () => [worker()], fabricExecutionClient: fabric, throughputOptions: { baselineConcurrency: 1, targetMultiplier: 2 } });
  runtime.ingest(compileCodingTask({ key: 'code-1', repository: 'r1', repoPath: '/repo1', objective: 'one' }));
  runtime.ingest({ key: 'other', repository: 'r2', objective: 'other executor', state: 'READY' });
  const submitted = await runtime.dispatchToFabric(1000);
  assert.equal(submitted.length, 1);
  assert.equal(enqueued.length, 1);
  assert.equal(runtime.graph.get('other').state, 'READY');
});

test('temporary lane limit is restored when scheduler dispatch throws', async () => {
  const runtime = new ControlPlaneRuntime({ workerProvider: async () => [worker()], throughputOptions: { baselineConcurrency: 1, targetMultiplier: 2 } });
  runtime.scheduler.totalLaneLimit = 9;
  runtime.orchestrator.dispatch = () => { throw new Error('synthetic dispatch failure'); };
  await assert.rejects(() => runtime.dispatch(1000), /synthetic dispatch failure/);
  assert.equal(runtime.scheduler.totalLaneLimit, 9);
});

test('fabric success reconciles through acceptance and records branch evidence', async () => {
  let terminal = [];
  const fabric = { enqueue: async (task) => task, fleet: async () => ({ tasks: terminal }) };
  const runtime = new ControlPlaneRuntime({ workerProvider: async () => [worker('w1', 1)], fabricExecutionClient: fabric, throughputOptions: { baselineConcurrency: 1, targetMultiplier: 2 } });
  runtime.ingest(compileCodingTask({ key: 'code-1', repository: 'r1', repoPath: '/repo1', objective: 'one', acceptance: { requiredChecks: ['unit'] } }));
  const loop = new AutonomousCodingLoop({ runtime, fabricClient: fabric, now: () => 1000 });
  const first = await loop.tick();
  const fabricTask = first.submitted[0];
  const controlTask = runtime.graph.get('code-1');
  const claimLineage = controlTask.lineage.at(-1).evidence;
  const claim = runtime.claims.list()[0];
  terminal = [{ taskId: fabricTask.fabricTaskId, state: 'SUCCEEDED', preferredWorkerId: 'w1', updatedAt: 1001, payload: { controlPlaneTaskKey: 'code-1', controlPlaneClaim: claim }, result: { checks: { unit: { ok: true } }, branchName: 'maxxed/agent/code-1-g1', commitSha: 'abc123', pushed: true, summary: 'done', evidence: [] } }];
  assert.equal(Boolean(claimLineage.claimId), true);
  const reconciled = await runtime.reconcileFabric(1001);
  assert.equal(reconciled[0].action, 'ACCEPT');
  assert.equal(reconciled[0].branchName, 'maxxed/agent/code-1-g1');
  assert.equal(runtime.graph.get('code-1').state, 'ACCEPTED');
});

test('accepted coding repair automatically accepts parent with repair evidence', async () => {
  let terminal = [];
  const fabric = { enqueue: async (task) => task, fleet: async () => ({ tasks: terminal }) };
  const runtime = new ControlPlaneRuntime({ workerProvider: async () => [worker('w1', 1)], fabricExecutionClient: fabric, throughputOptions: { baselineConcurrency: 1, targetMultiplier: 2 } });
  runtime.ingest(compileCodingTask({ key: 'code-repair', repository: 'r1', repoPath: '/repo1', objective: 'fix unit', acceptance: { requiredChecks: ['unit'] }, testCommands: [{ name: 'unit', command: 'npm', args: ['test'] }] }));

  const firstDispatch = await runtime.dispatchToFabric(1000);
  const originalClaim = runtime.claims.list()[0];
  terminal = [{ taskId: firstDispatch[0].fabricTask.taskId, state: 'SUCCEEDED', preferredWorkerId: 'w1', updatedAt: 1001, payload: { controlPlaneTaskKey: 'code-repair', controlPlaneClaim: originalClaim }, result: { checks: { unit: { ok: false, class: 'TEST_FAILURE' } }, branchName: 'maxxed/agent/code-repair-g1', commitSha: 'bad111', pushed: true, evidence: [] } }];
  const failed = await runtime.reconcileFabric(1001);
  assert.equal(failed[0].action, 'RETRY_REPAIR');
  assert.equal(runtime.graph.get('code-repair').state, 'BLOCKED');
  const repair = runtime.graph.list().find((task) => task.metadata?.repairOf === 'code-repair');
  assert.ok(repair);
  assert.equal(repair.metadata.closesParentOnAccept, true);
  assert.equal(repair.metadata.execution.ref, 'bad111');

  terminal = [];
  const repairDispatch = await runtime.dispatchToFabric(1002);
  const repairClaim = runtime.claims.list().find((claim) => claim.taskKey === repair.key);
  terminal = [{ taskId: repairDispatch[0].fabricTask.taskId, state: 'SUCCEEDED', preferredWorkerId: 'w1', updatedAt: 1003, payload: { controlPlaneTaskKey: repair.key, controlPlaneClaim: repairClaim }, result: { checks: { unit: { ok: true } }, branchName: 'maxxed/agent/code-repair-repair-1-g1', commitSha: 'good222', pushed: true, evidence: [] } }];
  const repaired = await runtime.reconcileFabric(1003);
  assert.equal(repaired[0].action, 'ACCEPT');
  assert.equal(repaired[0].parentTaskKey, 'code-repair');
  assert.equal(repaired[0].parentState, 'ACCEPTED');
  const parent = runtime.graph.get('code-repair');
  assert.equal(parent.state, 'ACCEPTED');
  const accepted = parent.lineage.at(-1).evidence.evidenceBundle.payload.evidence.artifacts;
  assert.equal(accepted.commitSha, 'good222');
  assert.equal(accepted.branchName, 'maxxed/agent/code-repair-repair-1-g1');
});
