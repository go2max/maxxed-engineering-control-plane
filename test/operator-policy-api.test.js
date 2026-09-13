import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlPlaneRuntime } from '../src/service/control-plane-runtime.js';

function runtime() { return new ControlPlaneRuntime({ workerProvider: async () => [] }); }

test('bounded operator commands update scheduler policy', () => {
  const value = runtime();
  value.operatorCommand({ action: 'freeze-repository', input: { repository: 'r1', reason: 'release' } });
  value.operatorCommand({ action: 'set-repository-lane-limit', input: { repository: 'r1', limit: 1 } });
  value.operatorCommand({ action: 'set-priority-override', input: { taskKey: 't1', adjustment: 10, reason: 'incident' } });
  const status = value.status();
  assert.equal(status.scheduler.repositoryLaneLimits.r1, 1);
  assert.equal(status.scheduler.policy.frozenRepositories[0].repository, 'r1');
  assert.equal(status.scheduler.policy.priorityOverrides[0].taskKey, 't1');
});

test('unsupported commands and invalid lane limits fail closed', () => {
  const value = runtime();
  assert.throws(() => value.operatorCommand({ action: 'shell', input: { command: 'rm -rf /' } }), /unsupported operator command/);
  assert.throws(() => value.operatorCommand({ action: 'set-repository-lane-limit', input: { repository: 'r1', limit: 1000 } }), /0..64/);
});

test('duplicate operator command ids return original result without second side effect', () => {
  const value = runtime();
  const first = value.operatorCommand(
    { action: 'freeze-repository', input: { repository: 'r1', reason: 'maintenance' } },
    { commandId: 'cmd-freeze-1', now: 100 }
  );
  const firstSequence = value.journal.sequence;
  const second = value.operatorCommand(
    { action: 'freeze-repository', input: { repository: 'r1', reason: 'maintenance' } },
    { commandId: 'cmd-freeze-1', now: 200 }
  );
  assert.deepEqual(second, first);
  assert.equal(value.journal.sequence, firstSequence);
  assert.equal(value.status().scheduler.policy.frozenRepositories.length, 1);
});

test('operator command id cannot be reused with a different payload', () => {
  const value = runtime();
  value.operatorCommand(
    { action: 'set-repository-lane-limit', input: { repository: 'r1', limit: 1 } },
    { commandId: 'cmd-lane-1' }
  );
  assert.throws(
    () => value.operatorCommand(
      { action: 'set-repository-lane-limit', input: { repository: 'r1', limit: 2 } },
      { commandId: 'cmd-lane-1' }
    ),
    /idempotency key reused with different request/
  );
  assert.equal(value.status().scheduler.repositoryLaneLimits.r1, 1);
});

test('operator command deduplication survives snapshot restore', () => {
  const first = runtime();
  const original = first.operatorCommand(
    { action: 'pause-dispatch' },
    { commandId: 'cmd-pause-1', now: 100 }
  );
  const snapshot = first.snapshot();

  const second = runtime();
  second.restore(snapshot, 1000);
  const beforeReplaySequence = second.journal.sequence;
  const replay = second.operatorCommand(
    { action: 'pause-dispatch' },
    { commandId: 'cmd-pause-1', now: 1100 }
  );
  assert.deepEqual(replay, original);
  assert.equal(second.journal.sequence, beforeReplaySequence);
  assert.equal(second.status().paused, true);
});

test('scheduler policy and lane overrides survive snapshot restore', () => {
  const first = runtime();
  first.operatorCommand({ action: 'pause-dispatch' });
  first.operatorCommand({ action: 'drain-repository', input: { repository: 'r2', reason: 'maintenance' } });
  first.operatorCommand({ action: 'set-repository-lane-limit', input: { repository: 'r2', limit: 0 } });
  first.operatorCommand({ action: 'set-priority-override', input: { taskKey: 'x', adjustment: 15, reason: 'sla' } });
  const snapshot = first.snapshot();

  const second = runtime();
  second.restore(snapshot, 1000);
  const status = second.status();
  assert.equal(status.paused, true);
  assert.equal(status.scheduler.repositoryLaneLimits.r2, 0);
  assert.equal(status.scheduler.policy.drainingRepositories[0].repository, 'r2');
  assert.equal(status.scheduler.policy.priorityOverrides[0].adjustment, 15);
});
