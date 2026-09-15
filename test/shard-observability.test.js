import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shardIdentity, ShardLifecycleTracker, ShardLifecycleEvent, ShardObservabilityRegistry
} from '../src/telemetry/shard-observability.js';
import { TraceProvenance } from '../src/telemetry/engineering-trace.js';

const SHA = 'a'.repeat(40);

function identity(overrides = {}) {
  return shardIdentity({
    parentTaskKey: 'parent-1', shardKey: 'parent-1:shard:1', sourceSha: SHA,
    policyVersion: 'policy-v1', environmentFingerprint: 'env-v1', leaseGeneration: 1, ...overrides
  });
}

test('deterministic millisecond duration accounting', () => {
  const tracker = new ShardLifecycleTracker({ identity: identity() });
  tracker.record({ event: ShardLifecycleEvent.ADMITTED, wallClockMs: 0, monotonicMs: 0 });
  tracker.record({ event: ShardLifecycleEvent.QUEUED, wallClockMs: 10, monotonicMs: 10 });
  tracker.record({ event: ShardLifecycleEvent.CLAIMED, wallClockMs: 25, monotonicMs: 25 });
  const durations = tracker.durationsByCategory();
  assert.equal(durations.queue, 25);
});

test('monotonic duration unaffected by wall-clock adjustment', () => {
  const tracker = new ShardLifecycleTracker({ identity: identity() });
  tracker.record({ event: ShardLifecycleEvent.ADMITTED, wallClockMs: 1_000_000, monotonicMs: 0 });
  // Wall clock jumps backwards (NTP correction) but monotonic keeps advancing normally.
  tracker.record({ event: ShardLifecycleEvent.QUEUED, wallClockMs: 500_000, monotonicMs: 50 });
  tracker.record({ event: ShardLifecycleEvent.CLAIMED, wallClockMs: 600_000, monotonicMs: 80 });
  const durations = tracker.durationsByCategory();
  assert.equal(durations.queue, 80);
});

test('duplicate/replayed lifecycle event idempotency', () => {
  const tracker = new ShardLifecycleTracker({ identity: identity() });
  const first = tracker.record({ event: ShardLifecycleEvent.ADMITTED, wallClockMs: 0, monotonicMs: 0, dedupeToken: 'admit-1' });
  const replay = tracker.record({ event: ShardLifecycleEvent.ADMITTED, wallClockMs: 0, monotonicMs: 0, dedupeToken: 'admit-1' });
  assert.equal(first.accepted, true);
  assert.equal(replay.accepted, false);
  assert.equal(replay.duplicate, true);
  assert.equal(tracker.events.length, 1);
});

test('impossible stage order rejected/flagged', () => {
  const tracker = new ShardLifecycleTracker({ identity: identity() });
  tracker.record({ event: ShardLifecycleEvent.EXECUTION_STARTED, wallClockMs: 0, monotonicMs: 0 });
  const result = tracker.record({ event: ShardLifecycleEvent.ADMITTED, wallClockMs: 10, monotonicMs: 10 });
  assert.equal(result.accepted, true); // recorded, but flagged rather than silently accepted as clean
  assert.ok(result.flags.some((flag) => flag.kind === 'IMPOSSIBLE_TRANSITION'));
  assert.equal(tracker.coverage().hasAnomalies, true);
});

test('missing stages lower measurement coverage', () => {
  const tracker = new ShardLifecycleTracker({ identity: identity() });
  tracker.record({ event: ShardLifecycleEvent.ADMITTED, wallClockMs: 0, monotonicMs: 0 });
  tracker.record({ event: ShardLifecycleEvent.ACCEPTED, wallClockMs: 5, monotonicMs: 5 });
  const coverage = tracker.coverage();
  assert.ok(coverage.coverageRatio < 1);
  assert.equal(coverage.confidenceComplete, false);
});

test('full clean lifecycle is confidence-complete with no anomalies', () => {
  const tracker = new ShardLifecycleTracker({ identity: identity() });
  const order = [
    ShardLifecycleEvent.ADMITTED, ShardLifecycleEvent.QUEUED, ShardLifecycleEvent.CLAIMED,
    ShardLifecycleEvent.CONTEXT_READY, ShardLifecycleEvent.EXECUTION_STARTED, ShardLifecycleEvent.FIRST_OUTPUT,
    ShardLifecycleEvent.MUTATION_EMITTED, ShardLifecycleEvent.VERIFY_QUEUED, ShardLifecycleEvent.VERIFY_STARTED,
    ShardLifecycleEvent.VERIFY_COMPLETE, ShardLifecycleEvent.COMPOSE_QUEUED, ShardLifecycleEvent.COMPOSE_STARTED,
    ShardLifecycleEvent.COMPOSE_COMPLETE
  ];
  order.forEach((event, index) => tracker.record({ event, wallClockMs: index * 10, monotonicMs: index * 10 }));
  tracker.record({ event: ShardLifecycleEvent.ACCEPTED, wallClockMs: 200, monotonicMs: 200 });
  const coverage = tracker.coverage();
  assert.equal(coverage.coverageRatio, 1);
  assert.equal(coverage.hasAnomalies, false);
  assert.equal(coverage.confidenceComplete, true);
});

test('exact source/artifact identity preserved on every event', () => {
  const shardId = identity();
  const tracker = new ShardLifecycleTracker({ identity: shardId });
  tracker.record({ event: ShardLifecycleEvent.ADMITTED, wallClockMs: 0, monotonicMs: 0 });
  assert.equal(tracker.events[0].identityDigest, shardId.identityDigest);
  assert.throws(() => shardIdentity({ parentTaskKey: 'p', shardKey: 's', sourceSha: 'not-a-sha', policyVersion: 'v1', environmentFingerprint: 'e1' }));
});

test('parent duration decomposes into non-overlapping stage categories', () => {
  const tracker = new ShardLifecycleTracker({ identity: identity() });
  tracker.record({ event: ShardLifecycleEvent.ADMITTED, wallClockMs: 0, monotonicMs: 0 });
  tracker.record({ event: ShardLifecycleEvent.QUEUED, wallClockMs: 10, monotonicMs: 10 });
  tracker.record({ event: ShardLifecycleEvent.CLAIMED, wallClockMs: 20, monotonicMs: 20 });
  tracker.record({ event: ShardLifecycleEvent.CONTEXT_READY, wallClockMs: 30, monotonicMs: 30 });
  tracker.record({ event: ShardLifecycleEvent.EXECUTION_STARTED, wallClockMs: 50, monotonicMs: 50 });
  tracker.record({ event: ShardLifecycleEvent.VERIFY_COMPLETE, wallClockMs: 90, monotonicMs: 90 });
  const durations = tracker.durationsByCategory();
  const total = Object.values(durations).reduce((sum, ms) => sum + ms, 0);
  assert.equal(total, 90); // sums exactly to elapsed time, no double counting
});

test('concurrent shards retain independent trace lineage', () => {
  const registry = new ShardObservabilityRegistry();
  const idA = identity({ shardKey: 'parent-1:shard:A' });
  const idB = identity({ shardKey: 'parent-1:shard:B' });
  const trackerA = registry.tracker(idA, { repository: 'org/repo' });
  const trackerB = registry.tracker(idB, { repository: 'org/repo' });
  trackerA.record({ event: ShardLifecycleEvent.ADMITTED, wallClockMs: 0, monotonicMs: 0 });
  trackerB.record({ event: ShardLifecycleEvent.ADMITTED, wallClockMs: 0, monotonicMs: 0 });
  trackerA.record({ event: ShardLifecycleEvent.QUEUED, wallClockMs: 5, monotonicMs: 5 });
  assert.equal(trackerA.events.length, 2);
  assert.equal(trackerB.events.length, 1);
  assert.notEqual(idA.identityDigest, idB.identityDigest);
  const byRepository = registry.aggregateBy('repository');
  assert.equal(byRepository.length, 1);
  assert.equal(byRepository[0].shardCount, 2);
});

test('modeled/proxy provenance is never silently reported as observed truth', () => {
  const tracker = new ShardLifecycleTracker({ identity: identity() });
  tracker.record({ event: ShardLifecycleEvent.ADMITTED, wallClockMs: 0, monotonicMs: 0, provenance: TraceProvenance.MODELED });
  assert.equal(tracker.coverage().hasModeledOrProxyEvents, true);
  assert.equal(tracker.coverage().confidenceComplete, false);
});

test('leverage report exposes observed-vs-modeled coverage across the whole registry', () => {
  const registry = new ShardObservabilityRegistry();
  const tracker = registry.tracker(identity());
  tracker.record({ event: ShardLifecycleEvent.ADMITTED, wallClockMs: 0, monotonicMs: 0 });
  const overall = registry.overallCoverage();
  assert.equal(overall.shardCount, 1);
  assert.ok(overall.coverageRatio > 0 && overall.coverageRatio < 1);
});
