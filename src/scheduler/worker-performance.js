function key(workerId, taskClass, language) { return `${workerId}\u0000${taskClass ?? 'standard'}\u0000${language ?? 'any'}`; }

export class WorkerPerformanceLedger {
  constructor({ decay = 0.9 } = {}) { this.decay = Math.max(0, Math.min(1, Number(decay))); this.rows = new Map(); }

  record({ workerId, taskClass = 'standard', language = 'any', accepted, durationMs, failureClass = null, now = Date.now() } = {}) {
    if (!workerId) throw new Error('workerId is required');
    const id = key(workerId, taskClass, language); const current = this.rows.get(id) ?? { workerId, taskClass, language, runs: 0, accepted: 0, failed: 0, ewmaDurationMs: null, ewmaAcceptance: null, lastFailureClass: null, updatedAt: now };
    current.runs += 1; accepted ? current.accepted += 1 : current.failed += 1;
    const outcome = accepted ? 1 : 0;
    current.ewmaAcceptance = current.ewmaAcceptance == null ? outcome : this.decay * current.ewmaAcceptance + (1 - this.decay) * outcome;
    if (Number.isFinite(durationMs)) current.ewmaDurationMs = current.ewmaDurationMs == null ? Number(durationMs) : this.decay * current.ewmaDurationMs + (1 - this.decay) * Number(durationMs);
    if (!accepted && failureClass) current.lastFailureClass = failureClass;
    current.updatedAt = Number(now); this.rows.set(id, current); return this.stats(workerId, taskClass, language);
  }

  stats(workerId, taskClass = 'standard', language = 'any') {
    const row = this.rows.get(key(workerId, taskClass, language));
    if (!row) return { workerId, taskClass, language, runs: 0, acceptanceRate: null, ewmaAcceptance: null, predictedDurationMs: null, specializationScore: 0 };
    const acceptanceRate = row.runs ? row.accepted / row.runs : null;
    const confidence = Math.min(1, row.runs / 10);
    const specializationScore = ((row.ewmaAcceptance ?? acceptanceRate ?? 0.5) - 0.5) * 40 * confidence + (row.ewmaDurationMs ? Math.max(-10, Math.min(10, 5_000 / row.ewmaDurationMs)) : 0);
    return { ...structuredClone(row), acceptanceRate, predictedDurationMs: row.ewmaDurationMs, specializationScore };
  }

  rank(workerIds, taskClass = 'standard', language = 'any') { return workerIds.map((workerId) => this.stats(workerId, taskClass, language)).sort((a, b) => b.specializationScore - a.specializationScore || (a.predictedDurationMs ?? Infinity) - (b.predictedDurationMs ?? Infinity) || a.workerId.localeCompare(b.workerId)); }
  snapshot() { return { version: 1, decay: this.decay, rows: [...this.rows.values()].map((row) => structuredClone(row)) }; }
  restore(snapshot) { if (snapshot && snapshot.version !== 1) throw new Error('unsupported worker performance snapshot'); this.decay = Number(snapshot?.decay ?? this.decay); this.rows = new Map((snapshot?.rows ?? []).map((row) => [key(row.workerId, row.taskClass, row.language), structuredClone(row)])); }
}
