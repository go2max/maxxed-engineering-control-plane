import crypto from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function safeKey(key) { if (!/^[0-9a-f]{64}$/i.test(String(key ?? ''))) throw new Error('artifact store key must be sha256'); return String(key).toLowerCase(); }

export class FileArtifactStore {
  constructor({ root, maxBytes = 20 * 1024 * 1024 * 1024, maxEntryBytes = 512 * 1024 * 1024 } = {}) {
    if (!root) throw new Error('artifact store root is required');
    this.root = path.resolve(root); this.maxBytes = Number(maxBytes); this.maxEntryBytes = Number(maxEntryBytes);
  }

  async put(value, { metadata = {} } = {}) {
    const payload = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value), 'utf8');
    if (payload.length > this.maxEntryBytes) throw new Error(`artifact exceeds max entry size: ${payload.length}`);
    const contentSha256 = sha256(payload); const key = contentSha256;
    await mkdir(this.root, { recursive: true });
    const target = path.join(this.root, `${key}.artifact`); const metaTarget = path.join(this.root, `${key}.json`);
    try { await stat(target); }
    catch {
      const temp = path.join(this.root, `.${key}.${process.pid}.${Date.now()}.tmp`);
      await writeFile(temp, payload, { flag: 'wx' }); await rename(temp, target);
    }
    const manifest = { version: 1, key, contentSha256, bytes: payload.length, metadata: structuredClone(metadata), storedAt: Date.now() };
    const metaTemp = path.join(this.root, `.${key}.${process.pid}.${Date.now()}.json.tmp`);
    await writeFile(metaTemp, JSON.stringify(manifest), 'utf8'); await rename(metaTemp, metaTarget);
    await this.prune();
    return structuredClone(manifest);
  }

  async get(key, { parseJson = true } = {}) {
    const id = safeKey(key); const target = path.join(this.root, `${id}.artifact`); const metaTarget = path.join(this.root, `${id}.json`);
    let payload; let manifest;
    try { payload = await readFile(target); manifest = JSON.parse(await readFile(metaTarget, 'utf8')); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
    const actual = sha256(payload);
    if (actual !== id || manifest.contentSha256 !== id || Number(manifest.bytes) !== payload.length) throw new Error(`artifact corruption detected: ${id}`);
    return { manifest: structuredClone(manifest), value: parseJson ? JSON.parse(payload.toString('utf8')) : payload };
  }

  async delete(key) {
    const id = safeKey(key); await Promise.allSettled([rm(path.join(this.root, `${id}.artifact`)), rm(path.join(this.root, `${id}.json`))]);
  }

  async stats() {
    await mkdir(this.root, { recursive: true }); const rows = await readdir(this.root, { withFileTypes: true });
    let bytes = 0; let entries = 0;
    for (const row of rows) if (row.isFile() && row.name.endsWith('.artifact')) { const info = await stat(path.join(this.root, row.name)); bytes += info.size; entries += 1; }
    return { entries, bytes, maxBytes: this.maxBytes, utilization: this.maxBytes > 0 ? bytes / this.maxBytes : null };
  }

  async prune() {
    const rows = [];
    await mkdir(this.root, { recursive: true });
    for (const entry of await readdir(this.root, { withFileTypes: true })) if (entry.isFile() && entry.name.endsWith('.artifact')) {
      const file = path.join(this.root, entry.name); const info = await stat(file); rows.push({ key: entry.name.slice(0, -9), file, size: info.size, mtimeMs: info.mtimeMs });
    }
    let total = rows.reduce((sum, row) => sum + row.size, 0);
    for (const row of rows.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (total <= this.maxBytes) break;
      await this.delete(row.key); total -= row.size;
    }
    return { bytes: total, evicted: rows.filter((row) => row.size).length };
  }
}
