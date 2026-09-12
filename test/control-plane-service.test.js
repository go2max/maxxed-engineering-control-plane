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

test('pause prevents dispatch until resumed', async () => {
  const runtime = new ControlPlaneRuntime({ workerProvider: async () => [{ workerId: 'w1', state: 'AVAILABLE', capabilities: [], capacity: { freeSlots: 1 }, pressure: {}, metadata: {} }] });
  runtime.ingest({ key: 't1' });
  runtime.pause();
  assert.deepEqual(await runtime.dispatch(), []);
  runtime.resume();
  assert.equal((await runtime.dispatch()).length, 1);
});
