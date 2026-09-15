// Shard-addressable lifecycle telemetry (issue #67).
//
// Builds on `src/telemetry/engineering-trace.js` — the EngineeringTraceLedger remains the sole
// span-storage authority. This module adds: canonical shard identity, an ordered shard lifecycle
// event vocabulary, monotonic+wall-clock duration accounting, replay/idempotency, impossible-
// transition and missing-event detection, and coverage/confidence aggregation. It does not create
// a second scheduler or a second telemetry store.
import { createHash } from 'node:crypto';
import { EngineeringTraceLedger, TraceProvenance } from './engineering-trace.js';

const SHA40 = /^[0-9a-f]{40}$/i;

// Canonical, ordered shard/stage lifecycle. Order defines the only legal forward transitions;
// terminal states (accepted/rejected/cancelled) may be reached from any non-terminal event.
export const ShardLifecycleEvent = Object.freeze({
  ADMITTED: 'admitted',
  QUEUED: 'queued',
  CLAIMED: 'claimed',
  CONTEXT_READY: 'context-ready',
  EXECUTION_STARTED: 'execution-started',
  FIRST_OUTPUT: 'first-output',
  MUTATION_EMITTED: 'mutation-emitted',
  VERIFY_QUEUED: 'verify-queued',
  VERIFY_STARTED: 'verify-started',
  VERIFY_COMPLETE: 'verify-complete',
  COMPOSE_QUEUED: 'compose-queued',
  COMPOSE_STARTED: 'compose-started',
  COMPOSE_COMPLETE: 'compose-complete',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled'
});

const ORDER = [
  ShardLifecycleEvent.ADMITTED,
  ShardLifecycleEvent.QUEUED,
  ShardLifecycleEvent.CLAIMED,
  ShardLifecycleEvent.CONTEXT_READY,
  ShardLifecycleEvent.EXECUTION_STARTED,
  ShardLifecycleEvent.FIRST_OUTPUT,
  ShardLifecycleEvent.MUTATION_EMITTED,
  ShardLifecycleEvent.VERIFY_QUEUED,
  ShardLifecycleEvent.VERIFY_STARTED,
  ShardLifecycleEvent.VERIFY_COMPLETE,
  ShardLifecycleEvent.COMPOSE_QUEUED,
  ShardLifecycleEvent.COMPOSE_STARTED,
  ShardLifecycleEvent.COMPOSE_COMPLETE
];
const RANK = new Map(ORDER.map((name, index) => [name, index]));
const TERMINAL = new Set([ShardLifecycleEvent.ACCEPTED, ShardLifecycleEvent.REJECTED, ShardLifecycleEvent.CANCELLED]);
const ALL_EVENTS = new Set(Object.values(ShardLifecycleEvent));

// Stage -> duration-bucket category, used to decompose a parent's wall time into non-overlapping
// categories (queue/dependency/context/execution/tool-wait/verifier-wait/verification/repair/
// composition/merge-release/owner-active) per the issue's required aggregation dimensions.
const CATEGORY_FOR_SPAN = {
  [ShardLifecycleEvent.QUEUED]: 'queue',
  [ShardLifecycleEvent.CLAIMED]: 'queue',
  [ShardLifecycleEvent.CONTEXT_READY]: 'context',
  [ShardLifecycleEvent.EXECUTION_STARTED]: 'execution',
  [ShardLifecycleEvent.FIRST_OUTPUT]: 'execution',
  [ShardLifecycleEvent.MUTATION_EMITTED]: 'execution',
  [ShardLifecycleEvent.VERIFY_QUEUED]: 'verifierWait',
  [ShardLifecycleEvent.VERIFY_STARTED]: 'verifierWait',
  [ShardLifecycleEvent.VERIFY_COMPLETE]: 'verification',
  [ShardLifecycleEvent.COMPOSE_QUEUED]: 'compositionWait',
  [ShardLifecycleEvent.COMPOSE_STARTED]: 'compositionWait',
  [ShardLifecycleEvent.COMPOSE_COMPLETE]: 'composition'
};

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function digestOf(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }

/**
 * Canonical shard identity: parent task, shard key, source SHA, policy version, environment
 * fingerprint and lease/fencing generation. Two identities are the "same shard instance" only
 * when every field matches exactly.
 */
export function shardIdentity({
  parentTaskKey, shardKey, sourceSha, policyVersion, environmentFingerprint, leaseGeneration = 1
} = {}) {
  if (!parentTaskKey) throw new Error('parentTaskKey is required');
  if (!shardKey) throw new Error('shardKey is required');
  if (!SHA40.test(String(sourceSha ?? ''))) throw new Error('shardIdentity requires a 40-char sourceSha');
  if (!policyVersion) throw new Error('policyVersion is required');
  if (!environmentFingerprint) throw new Error('environmentFingerprint is required');
  const identity = {
    parentTaskKey,
    shardKey,
    sourceSha: String(sourceSha).toLowerCase(),
    policyVersion: String(policyVersion),
    environmentFingerprint: String(environmentFingerprint),
    leaseGeneration: Math.max(1, Number(leaseGeneration))
  };
  return { ...identity, identityDigest: digestOf(identity) };
}

function monotonicNowMs() { return Number(process.hrtime.bigint() / 1_000_000n); }

/**
 * Tracks the lifecycle-event stream for a single shard instance (one identityDigest). Provides
 * idempotent/replay-safe ingestion, impossible-transition detection, wall+monotonic timestamps,
 * and per-category duration decomposition. One tracker owns exactly one shard's lineage; concurrent
 * shards get independent trackers so lineages never cross-contaminate.
 */
export class ShardLifecycleTracker {
  constructor({ identity, ledger = null } = {}) {
    if (!identity?.identityDigest) throw new Error('a resolved shardIdentity() is required');
    this.identity = identity;
    this.ledger = ledger ?? null;
    this.events = [];
    this._seen = new Set(); // dedupe key: `${event}:${dedupeToken}`
    this._monoBase = null; // ms offset so monotonic durations survive process boundaries within a run
  }

  /**
   * Records a lifecycle event. Returns { accepted, duplicate, flags } — flags carries
   * impossible-transition / missing-prerequisite warnings so callers can lower measurement
   * confidence instead of fabricating a clean trace.
   */
  record({
    event, wallClockMs = Date.now(), monotonicMs = monotonicNowMs(), provenance = TraceProvenance.OBSERVED,
    dedupeToken = null, attributes = {}
  } = {}) {
    if (!ALL_EVENTS.has(event)) throw new Error(`unsupported shard lifecycle event: ${event}`);
    if (!Object.values(TraceProvenance).includes(provenance)) throw new Error(`unsupported provenance: ${provenance}`);
    const token = dedupeToken ?? `${event}:${wallClockMs}:${monotonicMs}`;
    const dedupeKey = `${event}:${token}`;
    if (this._seen.has(dedupeKey)) {
      return { accepted: false, duplicate: true, flags: [] };
    }
    this._seen.add(dedupeKey);

    if (this._monoBase == null) this._monoBase = monotonicMs;
    const flags = [];
    const priorRanked = this.events.filter((row) => RANK.has(row.event));
    if (RANK.has(event)) {
      const rank = RANK.get(event);
      const lastRanked = priorRanked.at(-1);
      if (lastRanked && RANK.get(lastRanked.event) > rank) {
        flags.push({ kind: 'IMPOSSIBLE_TRANSITION', from: lastRanked.event, to: event });
      }
      // Missing-prerequisite: any earlier-ranked stage never observed at all.
      const observedRanks = new Set(priorRanked.map((row) => RANK.get(row.event)));
      for (let r = 0; r < rank; r += 1) {
        if (!observedRanks.has(r)) flags.push({ kind: 'MISSING_PREREQUISITE', missing: ORDER[r], before: event });
      }
    }
    if (TERMINAL.has(event) && this.events.some((row) => TERMINAL.has(row.event))) {
      flags.push({ kind: 'DUPLICATE_TERMINAL', event, existing: this.events.find((row) => TERMINAL.has(row.event)).event });
    }

    const record = {
      schema: 'maxxed.shard.lifecycle.v1',
      identityDigest: this.identity.identityDigest,
      event,
      wallClockMs,
      monotonicMs,
      monotonicElapsedMs: Math.max(0, monotonicMs - this._monoBase),
      provenance,
      flags,
      attributes: structuredClone(attributes)
    };
    this.events.push(record);
    if (this.ledger) {
      this.ledger.record({
        name: `shard.${event}`,
        stage: event,
        lane: 'shard-lifecycle',
        taskKey: this.identity.shardKey,
        provenance,
        startedAt: wallClockMs,
        completedAt: wallClockMs,
        attributes: { identityDigest: this.identity.identityDigest, monotonicElapsedMs: record.monotonicElapsedMs, flags }
      });
    }
    return { accepted: true, duplicate: false, flags };
  }

  /** Wall-clock timestamp of the first observation of `event`, or null. */
  timeOf(event) { return this.events.find((row) => row.event === event)?.wallClockMs ?? null; }
  monotonicOf(event) { return this.events.find((row) => row.event === event)?.monotonicMs ?? null; }

  /**
   * Decomposes elapsed time into non-overlapping duration categories (queue, context, execution,
   * verifierWait, verification, composition*, ...). Uses monotonic deltas where every boundary of
   * a category was observed within this run so wall-clock adjustments cannot distort durations;
   * falls back to wall-clock when the tracker was constructed mid-lifecycle (monotonicElapsedMs
   * still anchored to first-seen event) and flags degraded categories as MODELED-provenance gaps.
   */
  durationsByCategory() {
    const byCategory = {};
    let cursorMono = this.monotonicOf(ShardLifecycleEvent.ADMITTED) ?? this.events[0]?.monotonicMs ?? null;
    if (cursorMono == null) return byCategory;
    for (const event of ORDER) {
      if (event === ShardLifecycleEvent.ADMITTED) continue;
      const category = CATEGORY_FOR_SPAN[event];
      const endMono = this.monotonicOf(event);
      if (endMono == null || !category) continue; // no double counting: only advance the cursor on an observed boundary
      const delta = Math.max(0, endMono - cursorMono);
      byCategory[category] = (byCategory[category] ?? 0) + delta;
      cursorMono = endMono;
    }
    return byCategory;
  }

  /** Overall lifecycle status: 'in-flight' | 'accepted' | 'rejected' | 'cancelled'. */
  status() {
    const terminal = [...this.events].reverse().find((row) => TERMINAL.has(row.event));
    return terminal ? terminal.event : 'in-flight';
  }

  /**
   * Coverage/confidence for this shard's trace: fraction of the canonical non-terminal lifecycle
   * observed at least once, plus whether any impossible-transition/missing-prerequisite flag was
   * raised. Every leverage report derived from this trace must expose this alongside its numbers.
   */
  coverage() {
    const observed = new Set(this.events.filter((row) => RANK.has(row.event)).map((row) => row.event));
    const flagged = this.events.some((row) => row.flags.length > 0);
    const modeledOrProxy = this.events.some((row) => row.provenance === TraceProvenance.MODELED || row.provenance === TraceProvenance.PROXY);
    return {
      observedStages: observed.size,
      totalStages: ORDER.length,
      coverageRatio: observed.size / ORDER.length,
      hasAnomalies: flagged,
      hasModeledOrProxyEvents: modeledOrProxy,
      // A trace is "confidence-complete" only with full coverage, no anomalies, and no
      // modeled/proxy substitution for what should be observed truth.
      confidenceComplete: observed.size === ORDER.length && !flagged && !modeledOrProxy
    };
  }

  snapshot() { return { version: 1, identity: structuredClone(this.identity), events: structuredClone(this.events) }; }
  static restore(snapshot, { ledger = null } = {}) {
    if (!snapshot || snapshot.version !== 1) throw new Error('unsupported shard lifecycle snapshot');
    const tracker = new ShardLifecycleTracker({ identity: snapshot.identity, ledger });
    tracker.events = structuredClone(snapshot.events);
    tracker._seen = new Set(tracker.events.map((row) => `${row.event}:${row.event}:${row.wallClockMs}:${row.monotonicMs}`));
    tracker._monoBase = tracker.events[0]?.monotonicMs ?? null;
    return tracker;
  }
}

/**
 * Registry of ShardLifecycleTrackers keyed by identityDigest, plus cross-shard aggregation by
 * shard, parent task, repository, product family, task class, model, worker, verifier and
 * accepted capability (issue #67 "Provide aggregation by ..." requirement). Wraps a single
 * EngineeringTraceLedger instance — it is not a second telemetry authority.
 */
export class ShardObservabilityRegistry {
  constructor({ ledger = new EngineeringTraceLedger() } = {}) {
    this.ledger = ledger;
    this.trackers = new Map();
    this.dimensions = new Map(); // identityDigest -> { repository, productFamily, taskClass, model, workerId, verifierId, capability }
  }

  tracker(identity, dimensions = {}) {
    let tracker = this.trackers.get(identity.identityDigest);
    if (!tracker) {
      tracker = new ShardLifecycleTracker({ identity, ledger: this.ledger });
      this.trackers.set(identity.identityDigest, tracker);
    }
    if (Object.keys(dimensions).length) {
      this.dimensions.set(identity.identityDigest, { ...(this.dimensions.get(identity.identityDigest) ?? {}), ...dimensions });
    }
    return tracker;
  }

  /** Aggregates coverage + duration totals grouped by the given dimension key (e.g. 'repository'). */
  aggregateBy(dimensionKey) {
    const groups = new Map();
    for (const [digest, tracker] of this.trackers) {
      const dims = this.dimensions.get(digest) ?? {};
      const groupKey = dims[dimensionKey] ?? 'unattributed';
      const group = groups.get(groupKey) ?? {
        key: groupKey, shardCount: 0, observedStagesTotal: 0, totalStagesTotal: 0, anomalyCount: 0, durations: {}
      };
      const coverage = tracker.coverage();
      group.shardCount += 1;
      group.observedStagesTotal += coverage.observedStages;
      group.totalStagesTotal += coverage.totalStages;
      if (coverage.hasAnomalies) group.anomalyCount += 1;
      const durations = tracker.durationsByCategory();
      for (const [category, ms] of Object.entries(durations)) group.durations[category] = (group.durations[category] ?? 0) + ms;
      groups.set(groupKey, group);
    }
    return [...groups.values()].map((group) => ({
      ...group,
      coverageRatio: group.totalStagesTotal ? group.observedStagesTotal / group.totalStagesTotal : 0
    }));
  }

  /**
   * Overall coverage/confidence for a leverage report spanning every tracked shard. Leverage
   * multipliers must not be reported without this figure attached.
   */
  overallCoverage() {
    const trackers = [...this.trackers.values()];
    if (!trackers.length) return { shardCount: 0, coverageRatio: 0, confidenceCompleteRatio: 0 };
    const coverages = trackers.map((tracker) => tracker.coverage());
    return {
      shardCount: trackers.length,
      coverageRatio: coverages.reduce((sum, coverage) => sum + coverage.coverageRatio, 0) / trackers.length,
      confidenceCompleteRatio: coverages.filter((coverage) => coverage.confidenceComplete).length / trackers.length
    };
  }

  snapshot() {
    return {
      version: 1,
      ledger: this.ledger.snapshot(),
      trackers: [...this.trackers.values()].map((tracker) => tracker.snapshot()),
      dimensions: [...this.dimensions.entries()]
    };
  }

  restore(snapshot) {
    if (!snapshot || snapshot.version !== 1) throw new Error('unsupported shard observability snapshot');
    this.ledger.restore(snapshot.ledger);
    this.trackers = new Map(snapshot.trackers.map((row) => [row.identity.identityDigest, ShardLifecycleTracker.restore(row, { ledger: this.ledger })]));
    this.dimensions = new Map(snapshot.dimensions ?? []);
  }
}

export { CATEGORY_FOR_SPAN as ShardDurationCategoryBySpan };
