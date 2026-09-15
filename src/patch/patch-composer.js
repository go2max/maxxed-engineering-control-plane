import { contentHash, validatePatchBundle } from './patch-bundle.js';
import { buildPatchConflictGraph } from './conflict-graph.js';
import { digest } from '../leverage/solution-cas.js';
import { SemanticConflictDetector } from './semantic-conflict-detector.js';
import { HotSymbolLock } from './hot-symbol-lock.js';

function normalizeFiles(files = {}) {
  if (files instanceof Map) return new Map([...files.entries()].map(([key, value]) => [String(key), String(value)]));
  return new Map(Object.entries(files).map(([key, value]) => [String(key), String(value)]));
}

function serializableFiles(files) {
  return Object.fromEntries([...files.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function deriveBaseFiles(baseFiles, bundles) {
  const working = normalizeFiles(baseFiles);
  for (const bundle of bundles) {
    for (const write of bundle.writes) {
      if (write.beforeContent == null) continue;
      if (working.has(write.path) && working.get(write.path) !== write.beforeContent) {
        const error = new Error(`conflicting base content for ${write.path}`);
        error.path = write.path;
        error.shardKey = bundle.shardKey;
        throw error;
      }
      working.set(write.path, write.beforeContent);
    }
  }
  return working;
}

export class PatchComposer {
  constructor({ semanticConflictDetector = new SemanticConflictDetector(), hotSymbolLock = new HotSymbolLock() } = {}) {
    this.semanticConflictDetector = semanticConflictDetector;
    this.hotSymbolLock = hotSymbolLock;
  }

  compose({ baseSha, baseFiles = {}, bundles = [], parentTaskKey = null, now = Date.now() } = {}) {
    if (!/^[0-9a-f]{40}$/i.test(String(baseSha ?? ''))) throw new Error('composer requires exact 40-character baseSha');
    const valid = bundles.map(validatePatchBundle);
    if (!valid.length) throw new Error('composer requires at least one patch bundle');
    for (const bundle of valid) if (bundle.baseSha !== String(baseSha).toLowerCase()) throw new Error(`stale patch base SHA: ${bundle.shardKey}`);
    const graph = buildPatchConflictGraph(valid);
    if (graph.conflicts.length) {
      const error = new Error(`patch conflicts detected: ${graph.conflicts.map((row) => `${row.left}<->${row.right}:${row.reasons.join('+')}`).join(', ')}`);
      error.conflicts = graph.conflicts;
      throw error;
    }

    // Boundary-based (file/symbol) overlap is clean, but two shards can still interact through a
    // shared capability, contract, invariant or caller/callee edge across a changed signature.
    // Any worker evidence carrying a `semantics` payload gets checked here, before we ever apply
    // a single write.
    const semanticShards = valid.map((bundle) => ({ key: bundle.shardKey, scope: bundle.scope, semantics: bundle.evidence?.semantics ?? {} }));
    const semanticReport = this.semanticConflictDetector.analyze(semanticShards);
    if (semanticReport.blocksComposition) {
      const summary = [
        ...semanticReport.pairwise.map((row) => `${row.left}<->${row.right}:${row.reasons.join('+')}`),
        ...semanticReport.multiShard.map((row) => `${row.dimension}[${row.participants.join(',')}]`)
      ].join(', ');
      const error = new Error(`semantic patch conflicts detected: ${summary}`);
      error.semanticConflicts = semanticReport;
      throw error;
    }

    const byKey = new Map(valid.map((bundle) => [bundle.shardKey ?? bundle.taskKey, bundle]));
    const original = deriveBaseFiles(baseFiles, valid);
    const working = new Map(original);
    const applied = [];
    const hotSymbolAcquisitions = [];

    try {
    for (const key of graph.order) {
      const bundle = byKey.get(key);
      // Serialize access to hot files/symbols: a shard that touches an identifier currently
      // held by another in-flight composition is rejected rather than silently interleaved.
      // Cold identifiers (the overwhelming majority) never pay this cost.
      const lock = this.hotSymbolLock.acquire(key, bundle);
      hotSymbolAcquisitions.push({ shardKey: key, ...lock });
      if (!lock.acquired) {
        const error = new Error(`hot symbol contention during composition: ${key} blocked by shard(s) holding ${lock.blockedBy.join(', ')}`);
        error.hotSymbolContention = lock;
        throw error;
      }
      for (const write of bundle.writes) {
        const exists = working.has(write.path);
        const current = exists ? working.get(write.path) : null;
        const currentHash = exists ? contentHash(current) : null;
        if (write.beforeHash !== currentHash) {
          const error = new Error(`before-hash mismatch for ${write.path} in shard ${key}`);
          error.expected = write.beforeHash;
          error.actual = currentHash;
          error.shardKey = key;
          error.path = write.path;
          throw error;
        }
        if (write.delete) working.delete(write.path);
        else {
          if (contentHash(write.content) !== write.afterHash) throw new Error(`after-hash verification failed for ${write.path} in shard ${key}`);
          working.set(write.path, write.content);
        }
      }
      applied.push({ shardKey: key, bundleDigest: bundle.bundleDigest, workerId: bundle.workerId, generation: bundle.generation, checks: structuredClone(bundle.checks) });
    }
    } finally {
      for (const key of graph.order) this.hotSymbolLock.release(key);
    }

    const changedPaths = [...new Set([...original.keys(), ...working.keys()])].filter((file) => original.get(file) !== working.get(file)).sort();
    const writes = changedPaths.map((file) => ({
      path: file,
      beforeContent: original.has(file) ? original.get(file) : null,
      beforeHash: original.has(file) ? contentHash(original.get(file)) : null,
      afterHash: working.has(file) ? contentHash(working.get(file)) : null,
      delete: !working.has(file),
      content: working.has(file) ? working.get(file) : null
    }));
    const manifestCore = {
      version: 1,
      parentTaskKey,
      baseSha: String(baseSha).toLowerCase(),
      bundleDigests: applied.map((row) => row.bundleDigest),
      shardOrder: graph.order,
      writes,
      createdAt: Number(now)
    };
    return {
      ...manifestCore,
      compositionDigest: digest(manifestCore),
      files: serializableFiles(working),
      applied,
      conflictGraph: graph,
      semanticConflictReport: semanticReport,
      hotSymbolAcquisitions,
      requiresParentVerification: true,
      accepted: false
    };
  }
}
