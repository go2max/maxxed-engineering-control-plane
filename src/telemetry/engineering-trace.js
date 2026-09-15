import { randomBytes } from 'node:crypto';

export const TraceProvenance = Object.freeze({ OBSERVED: 'OBSERVED', DERIVED: 'DERIVED', PROXY: 'PROXY', MODELED: 'MODELED' });
export const TraceDisposition = Object.freeze({ PRODUCTIVE: 'PRODUCTIVE', OVERHEAD: 'NECESSARY_OVERHEAD', WAITING: 'WAITING', FAILED: 'FAILED', DUPLICATE: 'DUPLICATE', SUPERSEDED: 'SUPERSEDED', REVERTED: 'REVERTED', IDLE: 'IDLE', RECOVERY: 'RECOVERY' });

const hex = (bytes) => randomBytes(bytes).toString('hex');
const time = (value, field) => {
  if (value == null) return null;
  const ms = typeof value === 'number' ? value : new Date(value).getTime();
  if (!Number.isFinite(ms)) throw new Error(`invalid ${field}`);
  return ms;
};
const duration = (a, b) => a == null || b == null ? null : Math.max(0, b - a);

export function createTraceContext(input = {}) {
  return {
    traceId: input.traceId ?? hex(16),
    spanId: input.spanId ?? hex(8),
    parentSpanId: input.parentSpanId ?? null
  };
}

export function createEngineeringSpan(input = {}) {
  if (!input.name) throw new Error('span name is required');
  const context = createTraceContext(input);
  const queuedAt = time(input.queuedAt, 'queuedAt');
  const startedAt = time(input.startedAt ?? input.queuedAt, 'startedAt');
  const firstOutputAt = time(input.firstOutputAt, 'firstOutputAt');
  const completedAt = time(input.completedAt, 'completedAt');
  const provenance = input.provenance ?? TraceProvenance.OBSERVED;
  if (!Object.values(TraceProvenance).includes(provenance)) throw new Error(`unsupported provenance: ${provenance}`);
  const disposition = input.disposition ?? TraceDisposition.PRODUCTIVE;
  if (!Object.values(TraceDisposition).includes(disposition)) throw new Error(`unsupported disposition: ${disposition}`);
  return {
    schema: 'maxxed.engineering.trace.v1',
    ...context,
    name: input.name,
    lane: input.lane ?? 'unclassified',
    stage: input.stage ?? input.name,
    attempt: Math.max(1, Number(input.attempt ?? 1)),
    outcome: input.outcome ?? null,
    provenance,
    disposition,
    repository: input.repository ?? null,
    taskKey: input.taskKey ?? input.taskId ?? null,
    issueId: input.issueId ?? null,
    branch: input.branch ?? null,
    commitSha: input.commitSha ?? null,
    prNumber: input.prNumber ?? null,
    workerId: input.workerId ?? null,
    machineId: input.machineId ?? null,
    agentId: input.agentId ?? null,
    agentType: input.agentType ?? null,
    model: input.model ?? null,
    provider: input.provider ?? null,
    hardware: structuredClone(input.hardware ?? null),
    usage: structuredClone(input.usage ?? null),
    costUsd: input.costUsd == null ? null : Number(input.costUsd),
    queuedAt,
    startedAt,
    firstOutputAt,
    completedAt,
    durations: {
      queueMs: duration(queuedAt, startedAt),
      executionMs: duration(startedAt, completedAt),
      timeToFirstOutputMs: duration(startedAt, firstOutputAt),
      totalMs: duration(queuedAt ?? startedAt, completedAt)
    },
    attributes: structuredClone(input.attributes ?? {})
  };
}

export class EngineeringTraceLedger {
  constructor({ maxSpans = 100_000 } = {}) { this.maxSpans = maxSpans; this.spans = []; }
  record(input) {
    const span = input?.schema === 'maxxed.engineering.trace.v1' ? structuredClone(input) : createEngineeringSpan(input);
    this.spans.push(span);
    if (this.spans.length > this.maxSpans) this.spans.splice(0, this.spans.length - this.maxSpans);
    return structuredClone(span);
  }
  list({ traceId = null, taskKey = null, after = 0 } = {}) {
    return this.spans.filter((span) => (!traceId || span.traceId === traceId) && (!taskKey || span.taskKey === taskKey) && Number(span.completedAt ?? span.startedAt ?? 0) >= after).map((span) => structuredClone(span));
  }
  snapshot() { return { version: 1, maxSpans: this.maxSpans, spans: structuredClone(this.spans) }; }
  restore(snapshot) {
    if (!snapshot || snapshot.version !== 1) throw new Error('unsupported engineering trace snapshot');
    this.maxSpans = Number(snapshot.maxSpans ?? this.maxSpans);
    this.spans = structuredClone(snapshot.spans ?? []);
  }
}
