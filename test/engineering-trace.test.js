import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngineeringSpan, EngineeringTraceLedger, TraceDisposition, TraceProvenance } from '../src/telemetry/engineering-trace.js';

test('engineering span preserves four clocks and exact millisecond durations', () => {
  const span = createEngineeringSpan({ name: 'agent.run', queuedAt: 1000, startedAt: 1300, firstOutputAt: 1600, completedAt: 2300, lane: 'coding', provenance: TraceProvenance.OBSERVED });
  assert.equal(span.durations.queueMs, 300);
  assert.equal(span.durations.timeToFirstOutputMs, 300);
  assert.equal(span.durations.executionMs, 1000);
  assert.equal(span.durations.totalMs, 1300);
  assert.match(span.traceId, /^[0-9a-f]{32}$/);
  assert.match(span.spanId, /^[0-9a-f]{16}$/);
});

test('ledger preserves attempts, provenance, disposition and trace hierarchy', () => {
  const ledger = new EngineeringTraceLedger();
  const root = ledger.record({ name: 'task', startedAt: 1, completedAt: 2, taskKey: 't1' });
  const child = ledger.record({ name: 'test', traceId: root.traceId, parentSpanId: root.spanId, startedAt: 2, completedAt: 4, attempt: 2, taskKey: 't1', provenance: TraceProvenance.DERIVED, disposition: TraceDisposition.RECOVERY });
  assert.equal(child.traceId, root.traceId);
  assert.equal(child.parentSpanId, root.spanId);
  assert.equal(child.attempt, 2);
  assert.equal(ledger.list({ traceId: root.traceId }).length, 2);
  const restored = new EngineeringTraceLedger();
  restored.restore(ledger.snapshot());
  assert.equal(restored.list({ taskKey: 't1' }).length, 2);
});
