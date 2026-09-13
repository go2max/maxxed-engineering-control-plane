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
      { name: 'tests', command: 'npm', args: ['test'], env: { CI: '1', MAXXED_VALIDATION_MODE: 'local' } }
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
  assert.throws(() => compileValidationTask({ key: 'bad', repository: 'org/repo', ref: 'main', steps: [{ command: 'node', args: ['--test'] }] }), /exact 40-character ref/);
});

test('validation admission rejects mutating and package-fetch commands', () => {
  const cases = [
    { command: 'npm', args: ['publish'], pattern: /npm is limited/ },
    { command: 'npm', args: ['install'], pattern: /npm is limited/ },
    { command: 'npx', args: ['eslint', '.'], pattern: /npx is disabled/ },
    { command: 'git', args: ['push'], pattern: /git is read-only/ },
    { command: 'git', args: ['reset', '--hard'], pattern: /git is read-only/ },
    { command: 'node', args: ['-e', 'process.exit(0)'], pattern: /node is limited/ },
    { command: 'python', args: ['-c', 'print(1)'], pattern: /python is limited/ }
  ];
  for (const [index, entry] of cases.entries()) {
    assert.throws(() => compileValidationTask({ key: `unsafe-${index}`, repository: 'org/repo', ref: REF, steps: [entry] }), entry.pattern);
  }
});

test('validation admission rejects dangerous environment injection', () => {
  for (const [index, env] of [{ PATH: '/tmp/bin' }, { NODE_OPTIONS: '--require bad' }, { API_TOKEN: 'secret' }, { SERVICE_PASSWORD: 'secret' }].entries()) {
    assert.throws(() => compileValidationTask({
      key: `env-${index}`, repository: 'org/repo', ref: REF,
      steps: [{ command: 'npm', args: ['test'], env }]
    }), /env key/);
  }
});

test('validation admission bounds per-step timeout', () => {
  assert.throws(() => compileValidationTask({ key: 'tiny-timeout', repository: 'org/repo', ref: REF, steps: [{ command: 'npm', args: ['test'], timeoutMs: 999 }] }), /timeoutMs/);
  assert.throws(() => compileValidationTask({ key: 'huge-timeout', repository: 'org/repo', ref: REF, steps: [{ command: 'npm', args: ['test'], timeoutMs: 900001 }] }), /timeoutMs/);
});

test('validation admission permits bounded test runners and read-only git', () => {
  const task = compileValidationTask({
    key: 'safe-matrix', repository: 'org/repo', ref: REF,
    steps: [
      { command: 'npm', args: ['run', 'validate'] },
      { command: 'node', args: ['--test'] },
      { command: 'python3', args: ['-m', 'pytest'] },
      { command: 'git', args: ['status', '--short'] },
      { command: 'dotnet', args: ['test'] }
    ]
  });
  assert.equal(task.metadata.execution.steps.length, 5);
  assert.ok(task.requirements.capabilities.includes('python'));
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
