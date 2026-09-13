import test from 'node:test';
import assert from 'node:assert/strict';
import { compileValidationTask, fabricValidationTaskFromDispatch } from '../src/agents/validation-task.js';
import { fabricTaskFromDispatch, isFabricExecutionTask } from '../src/agents/fabric-task.js';

const REF = 'a'.repeat(40);

test('compileValidationTask creates exact-SHA model-free validation work', () => {
  const task = compileValidationTask({
    key: 'validate-1', repository: 'org/repo', ref: REF,
    steps: [
      { name: 'syntax', command: 'node', args: ['--check', 'src/index.js'] },
      { name: 'tests', command: 'npm', args: ['test'] }
    ]
  });
  assert.equal(task.state, 'READY');
  assert.equal(task.metadata.execution.kind, 'validation-agent');
  assert.deepEqual(task.metadata.acceptance.requiredChecks, ['syntax', 'tests']);
  assert.equal(task.metadata.modelRequest, undefined);
  assert.equal(task.metadata.suppressPromotion, true);
  assert.ok(task.requirements.capabilities.includes('git'));
  assert.ok(task.requirements.capabilities.includes('node'));
  assert.ok(task.requirements.capabilities.includes('npm'));
  assert.equal(isFabricExecutionTask(task), true);
});

test('validation task requires immutable source SHA', () => {
  assert.throws(() => compileValidationTask({ key: 'bad', repository: 'org/repo', ref: 'main', steps: [{ command: 'node', args: ['--version'] }] }), /exact 40-character ref/);
});

test('validation dispatch preserves claim fencing and exact ref', () => {
  const task = compileValidationTask({ key: 'validate-2', repository: 'org/repo', ref: REF, steps: [{ name: 'tests', command: 'npm', args: ['test'] }] });
  const dispatch = { workerId: 'worker-1', claim: { claimId: 'claim-1', generation: 2, taskKey: task.key } };
  const direct = fabricValidationTaskFromDispatch(task, dispatch);
  const routed = fabricTaskFromDispatch(task, dispatch);
  assert.deepEqual(routed, direct);
  assert.equal(routed.payload.kind, 'validation-agent');
  assert.equal(routed.payload.ref, REF);
  assert.equal(routed.payload.controlPlaneClaim.generation, 2);
  assert.equal(routed.preferredWorkerId, 'worker-1');
});
