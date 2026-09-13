import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function snapshotRuntime({ graph, claims, repairs }) {
  return {
    version: 1,
    capturedAt: Date.now(),
    graph: graph.snapshot(),
    claims: claims.snapshot(),
    repairs: repairs.snapshot()
  };
}

export function restoreRuntime(snapshot, { graph, claims, repairs, now = Date.now() }) {
  if (!snapshot || snapshot.version !== 1) throw new Error('unsupported runtime snapshot');
  claims.restore(snapshot.claims);
  const expiredClaims = claims.sweepExpired(now);
  const activeClaimTaskKeys = new Set(claims.list().map((claim) => claim.taskKey));
  const expiredClaimTaskKeys = new Set(expiredClaims.map((claim) => claim.taskKey));
  repairs.restore(snapshot.repairs);
  graph.restore(snapshot.graph, now, { activeClaimTaskKeys, expiredClaimTaskKeys });
  return {
    restoredAt: now,
    taskCount: graph.list().length,
    activeClaims: claims.list().length,
    expiredClaims: expiredClaims.length
  };
}

export class RuntimeStateStore {
  constructor(filePath) { this.filePath = path.resolve(filePath); }

  async load() {
    try { return JSON.parse(await readFile(this.filePath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async save(snapshot) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(snapshot)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temp, this.filePath);
  }
}
