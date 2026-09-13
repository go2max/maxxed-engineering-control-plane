import test from 'node:test';
import assert from 'node:assert/strict';
import { EventJournal } from '../src/core/event-journal.js';
import { ControlPlaneRuntime } from '../src/service/control-plane-runtime.js';

test('idempotency key returns original result and rejects request drift', () => {
  const journal = new EventJournal();
  let calls = 0;
  const first = journal.once('k1', { value: 1 }, () => ({ sequence: ++calls }));
  const second = journal.once('k1', { value: 1 }, () => ({ sequence: ++calls }));
  assert.deepEqual(first, second);
  assert.equal(calls, 1);
  assert.throws(() => journal.once('k1', { value: 2 }, () => ({ sequence: ++calls })), /different request/);
});

test('journal snapshot restores ordered audit sequence and idempotency', () => {
  const first = new EventJournal();
  first.append('a', { x: 1 }, 10);
  first.once('key', { q: 1 }, () => ({ ok: true }));
  const snapshot = first.snapshot();
  const second = new EventJournal();
  second.restore(snapshot);
  assert.equal(second.list()[0].sequence, 1);
  assert.deepEqual(second.once('key', { q: 1 }, () => ({ ok: false })), { ok: true });
});

test('runtime exposes readiness and persists journal across restart', () => {
  const runtime = new ControlPlaneRuntime();
  runtime.ingest({ key: 't1' }, { idempotencyKey: 'task-1', now: 100 });
  assert.equal(runtime.readiness().ready, true);
  const snapshot = runtime.snapshot();
  const restored = new ControlPlaneRuntime();
  restored.restore(snapshot, 200);
  assert.equal(restored.readiness().restoredAt, 200);
  assert.equal(restored.journal.list().some((entry) => entry.type === 'runtime.restored'), true);
  assert.equal(restored.graph.get('t1').key, 't1');
});
