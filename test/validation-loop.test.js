import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlPlaneRuntime } from '../src/service/control-plane-runtime.js';
import { AutonomousCodingLoop } from '../src/service/autonomous-coding-loop.js';
import { compileValidationTask } from '../src/agents/validation-task.js';

const REF = 'a'.repeat(40);

function validationWorker() {
  return {
    workerId: 'validator-1', state: 'AVAILABLE',
    capabilities: ['validation-agent', 'git', 'node', 'npm'],
    capacity: { freeSlots: 2, freeMemoryMb: 4096 },
    pressure: { cpuPct: 5, memoryPct: 10 },
    metadata: { os: 'linux', arch: 'x64', localModels: [] }
  };
}

test('autonomous loop dispatches validation tasks without model routing', async () => {
  const enqueued = [];
  const fabric = { enqueue: async (task) => { enqueued.push(task); return task; }, fleet: async () => ({ tasks: [] }) };
  const runtime = new ControlPlaneRuntime({ workerProvider: async () => [validationWorker()], fabricExecutionClient: fabric, throughputOptions: { baselineConcurrency: 1, targetMultiplier: 1 } });
  runtime.ingest(compileValidationTask({ key: 'validate-main', repository: 'org/repo', ref: REF, steps: [{ name: 'tests', command: 'npm', args: ['test'] }] }));
  const loop = new AutonomousCodingLoop({ runtime, fabricClient: fabric, now: () => 1000 });
  const result = await loop.tick();
  assert.equal(result.submitted.length, 1);
  assert.equal(result.submitted[0].kind, 'validation-agent');
  assert.equal(enqueued[0].payload.kind, 'validation-agent');
  assert.equal(enqueued[0].payload.ref, REF);
  assert.equal(runtime.graph.get('validate-main').state, 'CLAIMED');
});

test('validation result reconciles through verifier and is accepted', async () => {
  let terminal = [];
  const fabric = { enqueue: async (task) => task, fleet: async () => ({ tasks: terminal }) };
  const runtime = new ControlPlaneRuntime({ workerProvider: async () => [validationWorker()], fabricExecutionClient: fabric, throughputOptions: { baselineConcurrency: 1, targetMultiplier: 1 } });
  runtime.ingest(compileValidationTask({ key: 'validate-result', repository: 'org/repo', ref: REF, steps: [{ name: 'tests', command: 'npm', args: ['test'] }] }));
  const loop = new AutonomousCodingLoop({ runtime, fabricClient: fabric, now: () => 1000 });
  const first = await loop.tick();
  const claim = runtime.claims.list()[0];
  terminal = [{
    taskId: first.submitted[0].fabricTaskId,
    state: 'SUCCEEDED', preferredWorkerId: 'validator-1', updatedAt: 1001,
    payload: { controlPlaneTaskKey: 'validate-result', controlPlaneClaim: claim },
    result: {
      ok: true, exactRef: REF, repository: 'org/repo', durationMs: 123,
      validation: [{ name: 'tests', command: 'npm', args: ['test'], ok: true, exitCode: 0, timedOut: false, stdout: 'pass', stderr: '', durationMs: 120 }]
    }
  }];
  const reconciled = await runtime.reconcileFabric(1001);
  assert.equal(reconciled[0].action, 'ACCEPT');
  const accepted = runtime.graph.get('validate-result');
  assert.equal(accepted.state, 'ACCEPTED');
  const evidence = accepted.lineage.at(-1).evidence.evidenceBundle.payload.evidence;
  assert.equal(evidence.checks.tests.ok, true);
  assert.equal(evidence.artifacts.exactRef, REF);
  assert.equal(evidence.artifacts.validation[0].name, 'tests');
});

test('validation tasks are not harvested as coding trajectories', async () => {
  const fabric = { enqueue: async (task) => task, fleet: async () => ({ tasks: [] }) };
  const runtime = new ControlPlaneRuntime({ workerProvider: async () => [validationWorker()], fabricExecutionClient: fabric, throughputOptions: { baselineConcurrency: 1, targetMultiplier: 1 } });
  runtime.ingest(compileValidationTask({ key: 'validate-no-harvest', repository: 'org/repo', ref: REF, steps: [{ name: 'tests', command: 'npm', args: ['test'] }] }));
  let acceptedHarvests = 0;
  const leverage = { recordAccepted() { acceptedHarvests += 1; }, recordOutcome() { acceptedHarvests += 1; } };
  const loop = new AutonomousCodingLoop({ runtime, fabricClient: fabric, leverage, now: () => 1000 });
  await loop.tick();
  assert.equal(acceptedHarvests, 0);
});
