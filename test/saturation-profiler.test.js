import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SaturationProfiler,
  SaturationStage,
  ScopedCircuitBreaker,
  forecastTrend,
  measureEventLoopLagMs,
  recommendScalingAction
} from '../src/leverage/saturation-profiler.js';

test('measureEventLoopLagMs resolves a non-negative real lag reading', async () => {
  const lag = await measureEventLoopLagMs(5);
  assert.equal(typeof lag, 'number');
  assert.ok(lag >= 0);
});

test('forecastTrend on empty/singleton history is defined but non-committal', () => {
  assert.deepEqual(forecastTrend([]), { ewma: 0, slopePerMs: 0, projected: 0, confidence: 0 });
  const single = forecastTrend([{ at: 1000, value: 10 }]);
  assert.equal(single.ewma, 10);
  assert.equal(single.confidence, 0);
});

test('forecastTrend detects a rising trend and projects forward', () => {
  const now = Date.UTC(2026, 8, 15, 0, 0, 0);
  const samples = [];
  for (let i = 0; i < 10; i++) samples.push({ at: now + i * 10_000, value: 10 + i * 10 });
  const forecast = forecastTrend(samples, { horizonMs: 60_000 });
  assert.ok(forecast.slopePerMs > 0, 'slope should be positive for a rising series');
  assert.ok(forecast.projected > forecast.ewma, 'projection should extend the rising trend forward');
  assert.equal(forecast.confidence, 1);
});

test('SaturationProfiler attributes saturation to the worst real signal', () => {
  const profiler = new SaturationProfiler({ windowSize: 10 });
  const now = Date.UTC(2026, 8, 15, 0, 0, 0);
  profiler.sample({ now, eventLoopLagMs: 5, verifierBacklog: 20, repairBreakerOpenRatio: 0, workers: [{ capacity: { totalSlots: 4, freeSlots: 3 } }] });
  const report = profiler.attribute(now);
  assert.equal(report.bottleneck, SaturationStage.VERIFICATION);
  assert.equal(report.severity, 'critical');
});

test('SaturationProfiler worker-capacity attribution uses free-slot ratio (lower = worse)', () => {
  const profiler = new SaturationProfiler({ windowSize: 10 });
  const now = Date.UTC(2026, 8, 15, 0, 0, 0);
  profiler.sample({ now, eventLoopLagMs: 1, verifierBacklog: 0, repairBreakerOpenRatio: 0, workers: [{ capacity: { totalSlots: 10, freeSlots: 0 } }] });
  const report = profiler.attribute(now);
  assert.equal(report.bottleneck, SaturationStage.WORKER_CAPACITY);
  assert.equal(report.severity, 'critical');
});

test('SaturationProfiler predicts a near-term bottleneck before it is critical', () => {
  const profiler = new SaturationProfiler({ windowSize: 20, horizonMs: 60_000 });
  const now = Date.UTC(2026, 8, 15, 0, 0, 0);
  // Verifier backlog climbing steadily: warn threshold is 4, critical is 8. Current value stays
  // below critical, but the trend should cross it within the forecast horizon.
  for (let i = 0; i < 10; i++) {
    profiler.sample({ now: now + i * 10_000, verifierBacklog: 1 + i * 0.6 });
  }
  const prediction = profiler.predictBottleneck(now + 9 * 10_000);
  assert.equal(prediction.predicted, true);
  assert.equal(prediction.stage, SaturationStage.VERIFICATION);
});

test('SaturationProfiler reports no bottleneck when all real signals are healthy', () => {
  const profiler = new SaturationProfiler();
  const now = Date.UTC(2026, 8, 15, 0, 0, 0);
  profiler.sample({ now, eventLoopLagMs: 1, verifierBacklog: 0, repairBreakerOpenRatio: 0, workers: [{ capacity: { totalSlots: 4, freeSlots: 4 } }] });
  const report = profiler.attribute(now);
  assert.equal(report.severity, 'normal');
  const prediction = profiler.predictBottleneck(now);
  assert.equal(prediction.predicted, false);
});

test('SaturationProfiler snapshot/restore round-trips real recorded history', () => {
  const profiler = new SaturationProfiler({ windowSize: 5 });
  const now = Date.UTC(2026, 8, 15, 0, 0, 0);
  profiler.sample({ now, eventLoopLagMs: 12, verifierBacklog: 2 });
  const snapshot = profiler.snapshot();
  const restored = new SaturationProfiler();
  restored.restore(snapshot);
  assert.deepEqual(restored.historyFor(SaturationStage.EVENT_LOOP), profiler.historyFor(SaturationStage.EVENT_LOOP));
  assert.deepEqual(restored.historyFor(SaturationStage.VERIFICATION), profiler.historyFor(SaturationStage.VERIFICATION));
  assert.throws(() => restored.restore({ version: 99 }));
});

test('SaturationProfiler window trims to the configured size', () => {
  const profiler = new SaturationProfiler({ windowSize: 3 });
  const now = Date.UTC(2026, 8, 15, 0, 0, 0);
  for (let i = 0; i < 10; i++) profiler.sample({ now: now + i * 1000, eventLoopLagMs: i });
  assert.equal(profiler.historyFor(SaturationStage.EVENT_LOOP).length, 3);
  assert.equal(profiler.historyFor(SaturationStage.EVENT_LOOP).at(-1).value, 9);
});

test('recommendScalingAction holds when nothing is saturated', () => {
  const rec = recommendScalingAction({ bottleneckReport: { bottleneck: null, severity: 'normal' } });
  assert.equal(rec.action, 'hold');
  assert.equal(rec.proposedDelta, 0);
});

test('recommendScalingAction recommends scale-out for worker-capacity saturation without calling any provisioning action', () => {
  const rec = recommendScalingAction({ bottleneckReport: { bottleneck: SaturationStage.WORKER_CAPACITY, severity: 'critical' }, currentWorkerCount: 4, maxWorkerCount: 16 });
  assert.equal(rec.action, 'scale-out-workers');
  assert.ok(rec.proposedDelta > 0);
  assert.equal(rec.urgent, true);
  assert.equal(typeof rec.action, 'string'); // a recommendation string, not a side-effecting call
});

test('recommendScalingAction respects the max-worker ceiling', () => {
  const rec = recommendScalingAction({ bottleneckReport: { bottleneck: SaturationStage.WORKER_CAPACITY, severity: 'critical' }, currentWorkerCount: 16, maxWorkerCount: 16 });
  assert.equal(rec.action, 'at-max-capacity');
  assert.equal(rec.proposedDelta, 0);
});

test('recommendScalingAction recommends verifier scale-out and repair throttling for those domains', () => {
  const verification = recommendScalingAction({ bottleneckReport: { bottleneck: SaturationStage.VERIFICATION, severity: 'warn' } });
  assert.equal(verification.action, 'scale-out-verifiers');
  const repair = recommendScalingAction({ bottleneckReport: { bottleneck: SaturationStage.REPAIR, severity: 'critical' } });
  assert.equal(repair.action, 'throttle-implementation-admission');
  const eventLoop = recommendScalingAction({ bottleneckReport: { bottleneck: SaturationStage.EVENT_LOOP, severity: 'warn' } });
  assert.equal(eventLoop.action, 'shed-synchronous-work');
});

test('ScopedCircuitBreaker trips independently per failure domain', () => {
  const breaker = new ScopedCircuitBreaker({ failureThreshold: 3, windowMs: 60_000, cooldownMs: 10_000 });
  const now = Date.UTC(2026, 8, 15, 0, 0, 0);
  breaker.recordFailure('verifier-pool-a', now);
  breaker.recordFailure('verifier-pool-a', now + 100);
  breaker.recordFailure('verifier-pool-a', now + 200);
  assert.equal(breaker.allow('verifier-pool-a', now + 200), false);
  // An unrelated domain must remain unaffected -- this is the "scoped, not global" requirement.
  assert.equal(breaker.allow('model-pool-b', now + 200), true);
});

test('ScopedCircuitBreaker moves to HALF_OPEN after cooldown and re-closes on success', () => {
  const breaker = new ScopedCircuitBreaker({ failureThreshold: 2, windowMs: 60_000, cooldownMs: 1000 });
  const now = Date.UTC(2026, 8, 15, 0, 0, 0);
  breaker.recordFailure('domain-x', now);
  breaker.recordFailure('domain-x', now + 10);
  assert.equal(breaker.status('domain-x', now + 10).state, 'OPEN');
  assert.equal(breaker.allow('domain-x', now + 2000), true);
  assert.equal(breaker.status('domain-x', now + 2000).state, 'HALF_OPEN');
  breaker.recordSuccess('domain-x', now + 2000);
  assert.equal(breaker.status('domain-x', now + 2000).state, 'CLOSED');
});

test('ScopedCircuitBreaker failures outside the window do not count toward the threshold', () => {
  const breaker = new ScopedCircuitBreaker({ failureThreshold: 2, windowMs: 1000, cooldownMs: 500 });
  const now = Date.UTC(2026, 8, 15, 0, 0, 0);
  breaker.recordFailure('domain-y', now);
  breaker.recordFailure('domain-y', now + 5000); // outside the 1000ms window relative to itself's tracking
  const status = breaker.status('domain-y', now + 5000);
  assert.equal(status.failuresInWindow, 1);
  assert.equal(status.state, 'CLOSED');
});

test('ScopedCircuitBreaker snapshot/restore round-trips domain state', () => {
  const breaker = new ScopedCircuitBreaker({ failureThreshold: 2 });
  const now = Date.UTC(2026, 8, 15, 0, 0, 0);
  breaker.recordFailure('domain-z', now);
  breaker.recordFailure('domain-z', now + 10);
  const snapshot = breaker.snapshot();
  const restored = new ScopedCircuitBreaker();
  restored.restore(snapshot);
  assert.equal(restored.status('domain-z', now + 10).state, 'OPEN');
  assert.throws(() => restored.restore({ version: 99 }));
});
