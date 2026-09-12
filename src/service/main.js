import os from 'node:os';
import path from 'node:path';
import { ControlPlaneRuntime } from './control-plane-runtime.js';
import { createFabricWorkerProvider } from './fabric-worker-provider.js';
import { createControlPlaneServer } from './http-server.js';
import { RuntimeStateStore } from '../core/runtime-state.js';

const host = process.env.MAXXED_CONTROL_HOST ?? '127.0.0.1';
const port = Number(process.env.MAXXED_CONTROL_PORT ?? 7790);
const adminToken = process.env.MAXXED_CONTROL_ADMIN_TOKEN ?? '';
if (!adminToken) throw new Error('MAXXED_CONTROL_ADMIN_TOKEN is required');

const statePath = process.env.MAXXED_CONTROL_STATE_PATH ?? path.join(os.homedir(), '.maxxed-control-plane', 'state.json');
const persistMs = Number(process.env.MAXXED_CONTROL_PERSIST_MS ?? 1000);
const fabricUrl = process.env.MAXXED_FABRIC_URL ?? 'http://127.0.0.1:7788';
const fabricAdminToken = process.env.MAXXED_FABRIC_ADMIN_TOKEN ?? '';
const workerProvider = createFabricWorkerProvider({ baseUrl: fabricUrl, adminToken: fabricAdminToken });
const runtime = new ControlPlaneRuntime({ workerProvider });
const store = new RuntimeStateStore(statePath);
const restored = await store.load();
if (restored) runtime.restore(restored);

const server = createControlPlaneServer({ runtime, adminToken });
let saving = false;
const persist = async () => {
  if (saving) return;
  saving = true;
  try { await store.save(runtime.snapshot()); }
  catch (error) { console.error(JSON.stringify({ event: 'control-plane-persistence-failed', error: error.message })); }
  finally { saving = false; }
};
const timer = setInterval(() => void persist(), persistMs);
timer.unref();

server.listen(port, host, () => console.log(`maxxed engineering control plane listening on http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    clearInterval(timer);
    runtime.pause();
    await persist();
    server.close(() => process.exit(0));
  });
}
