import crypto from 'node:crypto';
import path from 'node:path';
import { digest } from '../leverage/solution-cas.js';

const SHA40 = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;

export function contentHash(content) {
  return crypto.createHash('sha256').update(Buffer.from(String(content), 'utf8')).digest('hex');
}

function safePath(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('patch path is required');
  const normalized = value.replaceAll('\\', '/');
  if (path.posix.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) throw new Error(`patch path escapes repository: ${value}`);
  return normalized.replace(/^\.\//, '');
}

function normalizeWrite(write) {
  const file = safePath(write?.path);
  const deleted = write?.delete === true;
  if (deleted && write.content != null) throw new Error(`deleted patch write cannot include content: ${file}`);
  if (!deleted && typeof write?.content !== 'string') throw new Error(`patch write content is required: ${file}`);
  const beforeContent = write.beforeContent == null ? null : String(write.beforeContent);
  let beforeHash = write.beforeHash == null ? null : String(write.beforeHash).toLowerCase();
  if (beforeHash != null && !SHA256.test(beforeHash)) throw new Error(`invalid beforeHash for ${file}`);
  if (beforeContent != null) {
    const computedBefore = contentHash(beforeContent);
    if (beforeHash != null && beforeHash !== computedBefore) throw new Error(`beforeHash mismatch for ${file}`);
    beforeHash = computedBefore;
  }
  const afterHash = deleted ? null : contentHash(write.content);
  if (write.afterHash != null && String(write.afterHash).toLowerCase() !== afterHash) throw new Error(`afterHash mismatch for ${file}`);
  return {
    path: file,
    beforeContent,
    beforeHash,
    afterHash,
    delete: deleted,
    content: deleted ? null : String(write.content),
    symbols: [...new Set((write.symbols ?? []).map(String))].sort(),
    metadata: structuredClone(write.metadata ?? {})
  };
}

function normalizeScope(scope = {}, writes = []) {
  const files = [...new Set([...(scope.files ?? []), ...writes.map((write) => write.path)].map(safePath))].sort();
  return {
    files,
    symbols: [...new Set((scope.symbols ?? []).map(String))].sort(),
    resources: [...new Set((scope.resources ?? []).map(String))].sort(),
    component: scope.component == null ? null : String(scope.component)
  };
}

export function createPatchBundle(input = {}) {
  const baseSha = String(input.baseSha ?? '').toLowerCase();
  if (!SHA40.test(baseSha)) throw new Error('patch bundle requires exact 40-character baseSha');
  if (!input.taskKey) throw new Error('patch bundle taskKey is required');
  if (!input.workerId) throw new Error('patch bundle workerId is required');
  if (!Number.isInteger(Number(input.generation)) || Number(input.generation) < 1) throw new Error('patch bundle generation must be a positive integer');
  const writes = (input.writes ?? []).map(normalizeWrite).sort((a, b) => a.path.localeCompare(b.path));
  if (!writes.length) throw new Error('patch bundle must contain at least one write');
  const duplicatePath = writes.find((write, index) => index > 0 && writes[index - 1].path === write.path);
  if (duplicatePath) throw new Error(`duplicate patch write path: ${duplicatePath.path}`);
  const core = {
    version: 1,
    taskKey: String(input.taskKey),
    parentTaskKey: input.parentTaskKey == null ? null : String(input.parentTaskKey),
    shardKey: input.shardKey == null ? String(input.taskKey) : String(input.shardKey),
    repository: input.repository == null ? null : String(input.repository),
    baseSha,
    workerId: String(input.workerId),
    generation: Number(input.generation),
    transformId: input.transformId == null ? null : String(input.transformId),
    dependsOn: [...new Set((input.dependsOn ?? []).map(String))].sort(),
    scope: null,
    writes,
    checks: structuredClone(input.checks ?? []),
    evidence: structuredClone(input.evidence ?? {}),
    createdAt: Number(input.createdAt ?? Date.now())
  };
  core.scope = normalizeScope(input.scope, writes);
  const bundleDigest = digest(core);
  return { ...core, bundleDigest };
}

export function validatePatchBundle(bundle) {
  const rebuilt = createPatchBundle(bundle);
  if (bundle.bundleDigest && bundle.bundleDigest !== rebuilt.bundleDigest) throw new Error('patch bundle digest mismatch');
  return rebuilt;
}

export class PatchBundleStore {
  constructor({ maxEntries = 50_000 } = {}) {
    this.maxEntries = Math.max(1, Number(maxEntries));
    this.entries = new Map();
  }

  put(bundle) {
    const valid = validatePatchBundle(bundle);
    const existing = this.entries.get(valid.bundleDigest);
    if (existing) return structuredClone(existing);
    this.entries.set(valid.bundleDigest, valid);
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
    return structuredClone(valid);
  }

  get(bundleDigest) {
    const row = this.entries.get(bundleDigest);
    return row ? structuredClone(row) : null;
  }

  snapshot() {
    return { version: 1, maxEntries: this.maxEntries, entries: [...this.entries.values()].map((row) => structuredClone(row)) };
  }

  restore(snapshot) {
    this.maxEntries = Math.max(1, Number(snapshot?.maxEntries ?? this.maxEntries));
    this.entries = new Map();
    for (const row of snapshot?.entries ?? []) {
      const valid = validatePatchBundle(row);
      this.entries.set(valid.bundleDigest, valid);
    }
  }
}
