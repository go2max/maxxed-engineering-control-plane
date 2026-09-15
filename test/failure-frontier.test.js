import test from 'node:test';
import assert from 'node:assert/strict';
import { FailureFrontierStore, LoopFingerprintDetector } from '../src/leverage/failure-frontier.js';

// --- Replay scenario: worker replacement resumes without repeating dead ends ---

test('worker replacement resumes from persisted frontier without repeating already-proven dead ends', () => {
  const store = new FailureFrontierStore();
  store.update('task-1', {
    facts: ['server binds to PORT env var'],
    rejectedHypotheses: ['issue is a race condition in startup'],
    commandsAttempted: ['npm test -- --grep boot'],
    errorFingerprints: ['ECONNREFUSED@boot'],
    inspectedFilesOrSymbols: ['src/service/http-server.js:createServer'],
    constraints: ['must not change public API of createServer'],
    unresolvedHypotheses: ['port is already in use by a stale process']
  }, { generation: 1, workerId: 'worker-a' });

  // worker-a dies; worker-b (a new generation) resumes.
  const resumed = store.resumeFrom('task-1', { minGeneration: 1 });
  assert.ok(resumed);
  assert.deepEqual(resumed.rejectedHypotheses, ['issue is a race condition in startup']);
  assert.deepEqual(resumed.unresolvedHypotheses, ['port is already in use by a stale process']);

  // worker-b builds on the frontier: it resolves the open hypothesis and adds a new fact,
  // without re-attempting the already-rejected one or the already-tried command.
  const updated = store.update('task-1', {
    facts: ['stale process was holding the port'],
    commandsAttempted: ['lsof -i :PORT'],
    resolvedHypotheses: ['port is already in use by a stale process']
  }, { generation: 2, workerId: 'worker-b' });

  assert.deepEqual(updated.facts, ['server binds to PORT env var', 'stale process was holding the port']);
  assert.deepEqual(updated.commandsAttempted, ['npm test -- --grep boot', 'lsof -i :PORT']);
  assert.deepEqual(updated.unresolvedHypotheses, []);
  // proven dead end is still on record for anything downstream to consult.
  assert.deepEqual(updated.rejectedHypotheses, ['issue is a race condition in startup']);
});

test('duplicate facts/hypotheses/commands are not re-added on repeated updates', () => {
  const store = new FailureFrontierStore();
  store.update('task-1', { facts: ['a'], commandsAttempted: ['cmd-1'] }, { generation: 1 });
  const updated = store.update('task-1', { facts: ['a', 'b'], commandsAttempted: ['cmd-1'] }, { generation: 1 });
  assert.deepEqual(updated.facts, ['a', 'b']);
  assert.deepEqual(updated.commandsAttempted, ['cmd-1']);
});

test('stale generation write is rejected by lease fencing', () => {
  const store = new FailureFrontierStore();
  store.update('task-1', { facts: ['a'] }, { generation: 2 });
  assert.throws(() => store.update('task-1', { facts: ['b'] }, { generation: 1 }), /stale frontier generation/);
});

test('resumeFrom enforces a minimum generation floor', () => {
  const store = new FailureFrontierStore();
  store.update('task-1', { facts: ['a'] }, { generation: 1 });
  assert.throws(() => store.resumeFrom('task-1', { minGeneration: 2 }), /predates required lease fencing/);
});

test('missing frontier resumes as null (no frontier to reuse)', () => {
  const store = new FailureFrontierStore();
  assert.equal(store.resumeFrom('unknown-task'), null);
});

test('snapshot/restore round-trips frontiers', () => {
  const store = new FailureFrontierStore();
  store.update('task-1', { facts: ['a'], constraints: ['must not break API'] }, { generation: 1 });
  const restored = new FailureFrontierStore();
  restored.restore(store.snapshot());
  assert.deepEqual(restored.peek('task-1').facts, ['a']);
  assert.deepEqual(restored.peek('task-1').constraints, ['must not break API']);
});

// --- Loop detection ---

test('loop detector catches a deterministic repeated-failure cycle at the policy threshold', () => {
  const detector = new LoopFingerprintDetector({ threshold: 3 });
  const action = { command: 'npm test', state: 'dirty-worktree', error: 'ECONNREFUSED' };

  const first = detector.record('task-1', action);
  assert.equal(first.count, 1);
  assert.equal(first.looping, false);

  const second = detector.record('task-1', action);
  assert.equal(second.count, 2);
  assert.equal(second.looping, false);

  const third = detector.record('task-1', action);
  assert.equal(third.count, 3);
  assert.equal(third.looping, true);
});

test('loop detector does not flag distinct actions as a loop', () => {
  const detector = new LoopFingerprintDetector({ threshold: 3 });
  const a = detector.record('task-1', { command: 'npm test', error: 'A' });
  const b = detector.record('task-1', { command: 'npm build', error: 'B' });
  assert.equal(a.looping, false);
  assert.equal(b.looping, false);
  assert.notEqual(a.fingerprint, b.fingerprint);
});

test('loop counts are isolated per taskKey', () => {
  const detector = new LoopFingerprintDetector({ threshold: 2 });
  const action = { command: 'npm test', error: 'X' };
  detector.record('task-1', action);
  const other = detector.record('task-2', action);
  assert.equal(other.count, 1);
  assert.equal(other.looping, false);
});

test('reset clears loop counts for a task', () => {
  const detector = new LoopFingerprintDetector({ threshold: 2 });
  const action = { command: 'npm test', error: 'X' };
  detector.record('task-1', action);
  detector.reset('task-1');
  const after = detector.record('task-1', action);
  assert.equal(after.count, 1);
});

test('snapshot/restore round-trips loop detector state and threshold', () => {
  const detector = new LoopFingerprintDetector({ threshold: 4 });
  const action = { command: 'npm test', error: 'X' };
  detector.record('task-1', action);
  detector.record('task-1', action);
  const restored = new LoopFingerprintDetector();
  restored.restore(detector.snapshot());
  assert.equal(restored.threshold, 4);
  const next = restored.record('task-1', action);
  assert.equal(next.count, 3);
});

test('command is required to fingerprint an action', () => {
  const detector = new LoopFingerprintDetector();
  assert.throws(() => detector.record('task-1', {}), /command is required/);
});
