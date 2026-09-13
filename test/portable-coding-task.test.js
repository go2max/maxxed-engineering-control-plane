import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCodingTask, fabricTaskFromDispatch } from '../src/agents/coding-task.js';

test('coding task can be compiled by repository identity without host-specific repoPath', () => {
  const task = compileCodingTask({
    key: 'portable-1',
    repository: 'Maxxed-Technical-Systems/example',
    objective: 'make a portable change',
    ref: 'a'.repeat(40),
    testCommands: []
  });
  assert.equal(task.repository, 'Maxxed-Technical-Systems/example');
  assert.equal(task.metadata.execution.repoPath, undefined);
  const fabric = fabricTaskFromDispatch(task, {
    workerId: 'worker-1',
    claim: { claimId: 'claim-1', generation: 2 },
    modelSelection: { model: { id: 'local-coder', endpoint: 'http://127.0.0.1:8080' } }
  });
  assert.equal(fabric.repository, 'Maxxed-Technical-Systems/example');
  assert.equal(fabric.payload.ref, 'a'.repeat(40));
  assert.equal(fabric.payload.repoPath, undefined);
});

test('coding task rejects arbitrary repository URL as identity', () => {
  assert.throws(() => compileCodingTask({ key: 'bad', repository: 'https://example.com/x', objective: 'bad' }), /owner\/name/);
});
