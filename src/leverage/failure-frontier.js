// Failure-frontier persistence + action-loop detection (issue #103).
//
// Distinct from `RepairMemory` (src/leverage/repair-memory.js): RepairMemory is a
// cross-task, cross-run lookup table keyed by *error fingerprint* -> a previously
// *accepted* repair plan, used to short-circuit future unrelated tasks that hit the
// same class of error. It knows nothing about a single worker's in-progress
// exploration.
//
// FailureFrontier is per-task-run scratch state for a *live* worker: the confirmed
// facts, rejected hypotheses, commands already tried, error fingerprints already
// seen, constraints discovered, successful intermediate outputs, and unresolved
// hypotheses still open when the worker died, stalled, or was replaced. Resuming
// from a frontier means a replacement worker does not re-derive facts or re-try
// dead ends the previous worker already proved out -- it is a superset of what
// `ExecutionCheckpointStore` (src/leverage/execution-checkpoint.js) tracks (which is
// step/edit/validation progress, not the reasoning trail behind it). The two are
// complementary and both are written per taskKey; this module does not replace
// either.
//
// Deliberately deferred (see PR body): wiring FailureFrontierStore/LoopFingerprintDetector
// into the live worker-replacement dispatch path. This module is additive and self-contained.

import { digest } from './solution-cas.js';

const FRONTIER_LIST_FIELDS = [
  'facts',
  'rejectedHypotheses',
  'commandsAttempted',
  'errorFingerprints',
  'inspectedFilesOrSymbols',
  'constraints',
  'successfulIntermediateOutputs',
  'unresolvedHypotheses'
];

function normalizedList(value) {
  return Array.isArray(value) ? structuredClone(value) : [];
}

function mergeUnique(base, additions) {
  const seen = new Set(base.map((item) => JSON.stringify(item)));
  const merged = [...base];
  for (const item of additions) {
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }
  return merged;
}

// Persists the failure frontier for a task across worker replacements. Like
// ExecutionCheckpointStore, writes are fenced by a monotonic generation per taskKey
// so a stale/replaced worker cannot clobber progress recorded after it was superseded.
export class FailureFrontierStore {
  constructor({ maxEntries = 5_000 } = {}) {
    this.maxEntries = Math.max(1, Number(maxEntries));
    this.frontiers = new Map();
  }

  // Merge-updates the frontier for taskKey. List fields are unioned (deduplicated)
  // with whatever is already persisted rather than overwritten, so a resumed worker
  // never loses facts/rejections recorded by an earlier generation. `resolvedHypotheses`
  // (an array of hypothesis values to drop from unresolvedHypotheses) lets a worker
  // mark hypotheses it has now resolved one way or the other.
  update(taskKey, delta = {}, { generation = 1, now = Date.now() } = {}) {
    if (!taskKey) throw new Error('taskKey is required');
    const existing = this.frontiers.get(taskKey);
    if (existing && Number(generation) < Number(existing.generation)) {
      const error = new Error('stale frontier generation rejected by lease fencing');
      error.code = 'STALE_GENERATION';
      error.currentGeneration = existing.generation;
      throw error;
    }

    const base = existing
      ? Object.fromEntries(FRONTIER_LIST_FIELDS.map((field) => [field, normalizedList(existing[field])]))
      : Object.fromEntries(FRONTIER_LIST_FIELDS.map((field) => [field, []]));

    const merged = {};
    for (const field of FRONTIER_LIST_FIELDS) {
      merged[field] = mergeUnique(base[field], normalizedList(delta[field]));
    }

    if (Array.isArray(delta.resolvedHypotheses) && delta.resolvedHypotheses.length) {
      const resolvedKeys = new Set(delta.resolvedHypotheses.map((item) => JSON.stringify(item)));
      merged.unresolvedHypotheses = merged.unresolvedHypotheses.filter((item) => !resolvedKeys.has(JSON.stringify(item)));
    }

    const row = {
      taskKey,
      generation: Number(generation),
      ...merged,
      workerId: delta.workerId ?? existing?.workerId ?? null,
      updatedAt: now
    };
    this.frontiers.set(taskKey, row);
    while (this.frontiers.size > this.maxEntries) this.frontiers.delete(this.frontiers.keys().next().value);
    return structuredClone(row);
  }

  // Returns the persisted frontier so a replacement worker can resume without
  // repeating already-proven dead ends. Fenced the same way as
  // ExecutionCheckpointStore.resume(): a frontier recorded under a generation older
  // than the resuming worker's own lease generation is rejected.
  resumeFrom(taskKey, { minGeneration = 0 } = {}) {
    const row = this.frontiers.get(taskKey);
    if (!row) return null;
    if (Number(row.generation) < Number(minGeneration)) {
      const error = new Error('frontier generation predates required lease fencing');
      error.code = 'STALE_GENERATION';
      error.currentGeneration = row.generation;
      throw error;
    }
    return structuredClone(row);
  }

  peek(taskKey) {
    const row = this.frontiers.get(taskKey);
    return row ? structuredClone(row) : null;
  }

  clear(taskKey) { return this.frontiers.delete(taskKey); }

  snapshot() {
    return { version: 1, maxEntries: this.maxEntries, frontiers: [...this.frontiers.values()].map((row) => structuredClone(row)) };
  }

  restore(snapshot) {
    this.maxEntries = Math.max(1, Number(snapshot?.maxEntries ?? this.maxEntries));
    this.frontiers = new Map((snapshot?.frontiers ?? []).map((row) => [row.taskKey, structuredClone(row)]));
  }
}

// Fingerprints a worker "action" (a command/state/error tuple) and detects when the
// same fingerprint repeats `threshold` times within a task, signalling a deterministic
// action loop the worker should terminate/escalate on rather than keep retrying.
export class LoopFingerprintDetector {
  constructor({ threshold = 3 } = {}) {
    this.threshold = Math.max(2, Number(threshold));
    this.counts = new Map(); // taskKey -> Map(fingerprint -> count)
  }

  static fingerprint({ command, state = null, error = null } = {}) {
    if (!command) throw new Error('command is required');
    return digest({ command, state, error });
  }

  // Records one occurrence of an action for taskKey and returns
  // { fingerprint, count, looping }, where `looping` is true once the same
  // fingerprint has recurred `threshold` or more times for that task.
  record(taskKey, action = {}) {
    if (!taskKey) throw new Error('taskKey is required');
    const fingerprint = LoopFingerprintDetector.fingerprint(action);
    const perTask = this.counts.get(taskKey) ?? new Map();
    const count = (perTask.get(fingerprint) ?? 0) + 1;
    perTask.set(fingerprint, count);
    this.counts.set(taskKey, perTask);
    return { fingerprint, count, looping: count >= this.threshold };
  }

  countFor(taskKey, fingerprint) {
    return this.counts.get(taskKey)?.get(fingerprint) ?? 0;
  }

  reset(taskKey) { return this.counts.delete(taskKey); }

  snapshot() {
    return {
      version: 1,
      threshold: this.threshold,
      counts: [...this.counts.entries()].map(([taskKey, perTask]) => [taskKey, [...perTask.entries()]])
    };
  }

  restore(snapshot) {
    this.threshold = Math.max(2, Number(snapshot?.threshold ?? this.threshold));
    this.counts = new Map((snapshot?.counts ?? []).map(([taskKey, entries]) => [taskKey, new Map(entries)]));
  }
}
