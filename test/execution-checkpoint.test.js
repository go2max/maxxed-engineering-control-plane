import test from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionCheckpointStore } from '../src/leverage/execution-checkpoint.js';

test('worker dies after partial implementation: compatible worker resumes without rediscovery', () => {
  const store = new ExecutionCheckpointStore();
  store.save('task-1', {
    sourceSha: 'deadbeef',
    completedSteps: ['read repo map', 'located target file'],
    filesInspected: ['src/foo.js'],
    nextActions: ['apply patch']
  }, { generation: 1 });
  const resumed = store.resume('task-1', { minGeneration: 1 });
  assert.ok(resumed);
  assert.deepEqual(resumed.completedSteps, ['read repo map', 'located target file']);
  assert.equal(resumed.nextActions[0], 'apply patch');
});

test('stale worker resumes after reassignment: fencing rejects an older generation save', () => {
  const store = new ExecutionCheckpointStore();
  store.save('task-1', { completedSteps: ['step-1'] }, { generation: 2 });
  assert.throws(() => store.save('task-1', { completedSteps: ['step-1-stale'] }, { generation: 1 }), /stale checkpoint generation/);
});

test('resume enforces a minimum generation floor to reject stale reassigned checkpoints', () => {
  const store = new ExecutionCheckpointStore();
  store.save('task-1', { completedSteps: ['step-1'] }, { generation: 1 });
  assert.throws(() => store.resume('task-1', { minGeneration: 2 }), /predates required lease fencing/);
});

test('newer generation overwrites an older checkpoint for the same task', () => {
  const store = new ExecutionCheckpointStore();
  store.save('task-1', { completedSteps: ['a'] }, { generation: 1 });
  const updated = store.save('task-1', { completedSteps: ['a', 'b'] }, { generation: 2 });
  assert.deepEqual(updated.completedSteps, ['a', 'b']);
  assert.equal(store.peek('task-1').generation, 2);
});

test('missing checkpoint resumes as null (no compatible checkpoint to reuse)', () => {
  const store = new ExecutionCheckpointStore();
  assert.equal(store.resume('unknown-task'), null);
});

test('snapshot/restore round-trips checkpoints', () => {
  const store = new ExecutionCheckpointStore();
  store.save('task-1', { completedSteps: ['a'] }, { generation: 1 });
  const restored = new ExecutionCheckpointStore();
  restored.restore(store.snapshot());
  assert.equal(restored.peek('task-1').completedSteps.length, 1);
});
