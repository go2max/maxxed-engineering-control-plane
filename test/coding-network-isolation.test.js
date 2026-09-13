import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCodingTask, fabricTaskFromDispatch } from '../src/agents/coding-task.js';

function dispatch() {
  return {
    workerId: 'worker-safe',
    claim: { claimId: 'claim-1', taskKey: 'code-1', generation: 3 },
    modelSelection: { model: { id: 'local-coder', endpoint: 'http://127.0.0.1:8080' } }
  };
}

test('coding tasks require network-isolated execution by default', () => {
  const task = compileCodingTask({ key: 'code-1', repository: 'org/repo', objective: 'change code' });
  assert.equal(task.metadata.execution.repositoryExecution.networkMode, 'none');
  assert.ok(task.requirements.capabilities.includes('network-isolated-exec'));
});

test('fabric payload preserves the isolation contract', () => {
  const task = compileCodingTask({ key: 'code-1', repository: 'org/repo', objective: 'change code' });
  const fabric = fabricTaskFromDispatch(task, dispatch());
  assert.equal(fabric.payload.repositoryExecution.networkMode, 'none');
  assert.ok(fabric.requirements.capabilities.includes('network-isolated-exec'));
});

test('networked repository execution fails closed without explicit override', () => {
  assert.throws(() => compileCodingTask({
    key: 'unsafe', repository: 'org/repo', objective: 'needs external integration',
    repositoryExecution: { networkMode: 'host' }
  }), /explicit allowNetworkedRepositoryExecution/);
});

test('explicit networked execution is visible and does not claim isolation capability', () => {
  const task = compileCodingTask({
    key: 'trusted', repository: 'org/repo', objective: 'run approved network integration',
    repositoryExecution: { networkMode: 'host' }, allowNetworkedRepositoryExecution: true
  });
  assert.equal(task.metadata.execution.repositoryExecution.networkMode, 'host');
  assert.equal(task.requirements.capabilities.includes('network-isolated-exec'), false);
});

test('unknown repository network modes are rejected', () => {
  assert.throws(() => compileCodingTask({
    key: 'bad', repository: 'org/repo', objective: 'bad mode', repositoryExecution: { networkMode: 'proxy' }
  }), /must be none or host/);
});
