import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { ControlPlaneRuntime } from '../src/service/control-plane-runtime.js';
import { createControlPlaneServer } from '../src/service/http-server.js';
import { createFabricWorkerProvider } from '../src/service/fabric-worker-provider.js';

test('fabric worker provider maps local fleet projection', async () => {
  const provider = createFabricWorkerProvider({ adminToken: 'x', fetchImpl: async () => ({ ok: true, json: async () => ({ workers: [{ workerId: 'w1', state: 'AVAILABLE', capabilities: ['node'], capacity: { freeSlots: 1 }, pressure: {}, metadata: {} }] }) }) });
  const workers = await provider();
  assert.equal(workers[0].workerId, 'w1');
  assert.deepEqual(workers[0].capabilities, ['node']);
});

test('authenticated API ingests and dispatches task while unauthorized access fails', async (t) => {
  const runtime = new ControlPlaneRuntime({ workerProvider: async () => [{ workerId: 'w1', state: 'AVAILABLE', capabilities: ['node'], capacity: { freeSlots: 1, freeMemoryMb: 4096 }, pressure: { cpuPct: 5 }, metadata: { os: 'linux', arch: 'x64' } }] });
  const server = createControlPlaneServer({ runtime, adminToken: 'secret' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const port = server.address().port;
  const root = `http://127.0.0.1:${port}`;

  const denied = await fetch(`${root}/status`);
  assert.equal(denied.status, 401);

  const headers = { authorization: 'Bearer secret', 'content-type': 'application/json' };
  const created = await fetch(`${root}/tasks`, { method: 'POST', headers, body: JSON.stringify({ key: 't1', repository: 'go2max/demo', requirements: { capabilities: ['node'] } }) });
  assert.equal(created.status, 201);
  const dispatched = await fetch(`${root}/dispatch`, { method: 'POST', headers, body: '{}' });
  const dispatchBody = await dispatched.json();
  assert.equal(dispatchBody.dispatches.length, 1);
  assert.equal(dispatchBody.dispatches[0].workerId, 'w1');

  const status = await (await fetch(`${root}/status`, { headers })).json();
  assert.equal(status.claims.active, 1);
});

test('schedule endpoint returns a read-only preview without claiming tasks', async (t) => {
  const runtime = new ControlPlaneRuntime({ workerProvider: async () => [{ workerId: 'w1', state: 'AVAILABLE', capabilities: ['node'], capacity: { freeSlots: 1, freeMemoryMb: 4096 }, pressure: { cpuPct: 5 }, metadata: { os: 'linux', arch: 'x64' } }] });
  const server = createControlPlaneServer({ runtime, adminToken: 'secret' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const port = server.address().port;
  const root = `http://127.0.0.1:${port}`;
  const headers = { authorization: 'Bearer secret', 'content-type': 'application/json' };

  await fetch(`${root}/tasks`, { method: 'POST', headers, body: JSON.stringify({ key: 't1', repository: 'go2max/demo', requirements: { capabilities: ['node'] } }) });

  const unauthorized = await fetch(`${root}/schedule`);
  assert.equal(unauthorized.status, 401);

  const preview = await (await fetch(`${root}/schedule`, { headers })).json();
  assert.equal(preview.authoritative, true);
  assert.equal(preview.dispatches.length, 1);
  assert.equal(preview.dispatches[0].taskKey, 't1');

  // Preview must not mutate state: no claim should exist yet, and a second preview call
  // must produce the same result (idempotent / side-effect free).
  const status = await (await fetch(`${root}/status`, { headers })).json();
  assert.equal(status.claims.active, 0);

  const previewAgain = await (await fetch(`${root}/schedule`, { headers })).json();
  assert.equal(previewAgain.dispatches.length, 1);
  assert.equal(previewAgain.dispatches[0].taskKey, 't1');
});

test('operator command endpoint requires idempotency identity and rejects mismatches', async (t) => {
  const runtime = new ControlPlaneRuntime({ workerProvider: async () => [] });
  const server = createControlPlaneServer({ runtime, adminToken: 'secret' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const root = `http://127.0.0.1:${server.address().port}`;
  const headers = { authorization: 'Bearer secret', 'content-type': 'application/json' };

  const missing = await fetch(`${root}/operator/command`, { method: 'POST', headers, body: JSON.stringify({ action: 'pause-dispatch' }) });
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /idempotency-key or commandId is required/);

  const mismatched = await fetch(`${root}/operator/command`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': 'header-id' },
    body: JSON.stringify({ action: 'pause-dispatch', commandId: 'body-id' })
  });
  assert.equal(mismatched.status, 400);
  assert.match((await mismatched.json()).error, /does not match/);
});

test('operator command endpoint deduplicates duplicate network delivery', async (t) => {
  const runtime = new ControlPlaneRuntime({ workerProvider: async () => [] });
  const server = createControlPlaneServer({ runtime, adminToken: 'secret' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const root = `http://127.0.0.1:${server.address().port}`;
  const headers = { authorization: 'Bearer secret', 'content-type': 'application/json', 'idempotency-key': 'cmd-1' };
  const body = JSON.stringify({ action: 'freeze-repository', input: { repository: 'r1', reason: 'maintenance' }, commandId: 'cmd-1' });

  const first = await fetch(`${root}/operator/command`, { method: 'POST', headers, body });
  assert.equal(first.status, 200);
  const sequenceAfterFirst = runtime.journal.sequence;
  const second = await fetch(`${root}/operator/command`, { method: 'POST', headers, body });
  assert.equal(second.status, 200);
  assert.equal(runtime.journal.sequence, sequenceAfterFirst);
  assert.equal(runtime.status().scheduler.policy.frozenRepositories.length, 1);
});

test('pause prevents dispatch until resumed', async () => {
  const runtime = new ControlPlaneRuntime({ workerProvider: async () => [{ workerId: 'w1', state: 'AVAILABLE', capabilities: [], capacity: { freeSlots: 1 }, pressure: {}, metadata: {} }] });
  runtime.ingest({ key: 't1' });
  runtime.pause();
  assert.deepEqual(await runtime.dispatch(), []);
  runtime.resume();
  assert.equal((await runtime.dispatch()).length, 1);
});
