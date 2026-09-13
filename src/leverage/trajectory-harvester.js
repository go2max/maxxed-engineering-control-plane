import { createHash } from 'node:crypto';

function hash(value) { return createHash('sha256').update(String(value ?? '')).digest('hex'); }
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|password|authorization|cookie|privatekey/i.test(key)) { out[key] = '[REDACTED]'; continue; }
    out[key] = sanitize(item);
  }
  return out;
}

export class TrajectoryHarvester {
  constructor({ maxRecords = 50_000 } = {}) { this.maxRecords = Math.max(1, Number(maxRecords)); this.records = []; }

  record({ task, outcome, evidence = {}, repairHistory = [], model = null, timing = {}, source = 'runtime' } = {}) {
    if (!task?.key || !outcome) throw new Error('task and outcome are required');
    const record = sanitize({
      id: hash(`${task.key}:${outcome}:${evidence?.digest ?? evidence?.commitSha ?? this.records.length}`),
      taskKey: task.key, repository: task.repository ?? null, taskClass: task.taskClass ?? 'standard', objective: task.objective ?? null,
      outcome, acceptance: task.metadata?.acceptance ?? {}, executionKind: task.metadata?.execution?.kind ?? null,
      evidence, repairHistory, model: model ? { id: model.id ?? null, family: model.family ?? null, quantization: model.quantization ?? null } : null,
      timing, source
    });
    this.records.push(record); if (this.records.length > this.maxRecords) this.records.splice(0, this.records.length - this.maxRecords);
    return structuredClone(record);
  }

  trainingRows({ acceptedOnly = false } = {}) {
    return this.records.filter((row) => !acceptedOnly || row.outcome === 'ACCEPT').map((row) => ({
      id: `train-${row.id}`, category: row.taskClass, instruction: row.objective ?? row.taskKey,
      input: { repository: row.repository, acceptance: row.acceptance, priorRepairs: row.repairHistory },
      output: { outcome: row.outcome, evidence: row.evidence }, provenance: { source: row.source, taskKey: row.taskKey }, split: 'train'
    }));
  }

  preferencePairs() {
    const grouped = new Map();
    for (const row of this.records) { const key = `${row.repository}:${row.objective}`; if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(row); }
    const pairs = [];
    for (const rows of grouped.values()) {
      const chosen = rows.find((r) => r.outcome === 'ACCEPT'); const rejected = rows.find((r) => ['REJECT','TERMINATE','ESCALATE','FAILED'].includes(r.outcome));
      if (chosen && rejected) pairs.push({ prompt: chosen.objective, chosen, rejected });
    }
    return structuredClone(pairs);
  }

  snapshot() { return { version: 1, maxRecords: this.maxRecords, records: structuredClone(this.records) }; }
  restore(snapshot) { this.maxRecords = Math.max(1, Number(snapshot?.maxRecords ?? this.maxRecords)); this.records = structuredClone(snapshot?.records ?? []).slice(-this.maxRecords); }
}
