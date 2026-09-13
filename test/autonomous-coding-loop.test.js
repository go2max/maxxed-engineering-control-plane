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
  const fabric = {
    enqueue: async (task) => task,
    fleet: async () => ({ tasks: terminal })
  };
  const runtime = new ControlPlaneRuntime({ workerProvider: async () => [worker('w1', 1)], fabricExecutionClient: fabric, throughputOptions: { baselineConcurrency: 1, targetMultiplier: 2 } });
  runtime.ingest(compileCodingTask({ key: 'code-1', repository: 'r1', repoPath: '/repo1', objective: 'one', acceptance: { requiredChecks: ['unit'] } }));
  const loop = new AutonomousCodingLoop({ runtime, fabricClient: fabric, now: () => 1000 });
  const first = await loop.tick();
  const fabricTask = first.submitted[0];
  const controlTask = runtime.graph.get('code-1');
  const claimLineage = controlTask.lineage.at(-1).evidence;
  const claim = runtime.claims.list()[0];
  terminal = [{
    taskId: fabricTask.fabricTaskId,
    state: 'SUCCEEDED',
    preferredWorkerId: 'w1',
    updatedAt: 1001,
    payload: { controlPlaneTaskKey: 'code-1', controlPlaneClaim: claim },
    result: { checks: { unit: { ok: true } }, branchName: 'maxxed/agent/code-1-g1', commitSha: 'abc123', pushed: true, summary: 'done', evidence: [] }
  }];
  assert.equal(Boolean(claimLineage.claimId), true);
  const reconciled = await runtime.reconcileFabric(1001);
  assert.equal(reconciled[0].action, 'ACCEPT');
  assert.equal(reconciled[0].branchName, 'maxxed/agent/code-1-g1');
  assert.equal(runtime.graph.get('code-1').state, 'ACCEPTED');
});
