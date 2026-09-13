import { createHash } from 'node:crypto';
import { defaultSecretScanner } from '../security/secret-scanner.js';

function hash(value) { return createHash('sha256').update(String(value ?? '')).digest('hex'); }
function normalizeText(value) { return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' '); }
function semanticSignature(row) { return hash(`${row.repository ?? ''}|${row.taskClass ?? ''}|${normalizeText(row.objective)}|${normalizeText(JSON.stringify(row.acceptance ?? {}))}`); }

export class TrajectoryHarvester {
  constructor({ maxRecords = 50_000, scanner = defaultSecretScanner } = {}) {
    this.maxRecords = Math.max(1, Number(maxRecords));
    this.records = [];
    this.revocations = new Map();
    this.scanner = scanner;
  }

  record({ task, outcome, evidence = {}, repairHistory = [], model = null, timing = {}, source = 'runtime', sourceRefs = [] } = {}) {
    if (!task?.key || !outcome) throw new Error('task and outcome are required');
    const raw = {
      schemaVersion: 2,
      id: hash(`${task.key}:${outcome}:${evidence?.digest ?? evidence?.commitSha ?? this.records.length}`),
      taskKey: task.key, repository: task.repository ?? null, taskClass: task.taskClass ?? 'standard', objective: task.objective ?? null,
      outcome, acceptance: task.metadata?.acceptance ?? {}, executionKind: task.metadata?.execution?.kind ?? null,
      evidence, repairHistory, model: model ? { id: model.id ?? null, family: model.family ?? null, quantization: model.quantization ?? null } : null,
      timing, source, sourceRefs: [...new Set(sourceRefs.map(String))].sort(), revoked: false, revokedReason: null
    };
    const sanitized = this.scanner.sanitize(raw);
    const record = { ...sanitized.value, redactionFindings: sanitized.findings, semanticSignature: semanticSignature(sanitized.value) };
    this.records.push(record);
    if (this.records.length > this.maxRecords) this.records.splice(0, this.records.length - this.maxRecords);
    return structuredClone(record);
  }

  revokeSource(sourceRef, reason = 'source-revoked', now = Date.now()) {
    const ref = String(sourceRef);
    const row = { sourceRef: ref, reason: String(reason), at: Number(now) };
    this.revocations.set(ref, row);
    let affected = 0;
    for (const record of this.records) {
      if ((record.sourceRefs ?? []).includes(ref)) { record.revoked = true; record.revokedReason = row.reason; affected += 1; }
    }
    return { ...row, affected };
  }

  nearDuplicates({ includeRevoked = false } = {}) {
    const grouped = new Map();
    for (const row of this.records) {
      if (!includeRevoked && row.revoked) continue;
      if (!grouped.has(row.semanticSignature)) grouped.set(row.semanticSignature, []);
      grouped.get(row.semanticSignature).push(row.id);
    }
    return [...grouped.entries()].filter(([, ids]) => ids.length > 1).map(([semanticSignature, ids]) => ({ semanticSignature, ids: [...ids] }));
  }

  trainingRows({ acceptedOnly = false, split = 'train', excludeSignatures = new Set() } = {}) {
    return this.records
      .filter((row) => !row.revoked && (!acceptedOnly || row.outcome === 'ACCEPT') && !excludeSignatures.has(row.semanticSignature))
      .map((row) => ({
        id: `train-${row.id}`, schemaVersion: 2, category: row.taskClass, instruction: row.objective ?? row.taskKey,
        input: { repository: row.repository, acceptance: row.acceptance, priorRepairs: row.repairHistory },
        output: { outcome: row.outcome, evidence: row.evidence },
        provenance: { source: row.source, taskKey: row.taskKey, sourceRefs: row.sourceRefs, semanticSignature: row.semanticSignature }, split
      }));
  }

  heldOutEvalRows({ ratio = 0.15 } = {}) {
    const active = this.records.filter((row) => !row.revoked).sort((a, b) => a.semanticSignature.localeCompare(b.semanticSignature));
    const signatures = [...new Set(active.map((row) => row.semanticSignature))];
    const evalCount = Math.max(1, Math.floor(signatures.length * Math.max(0, Math.min(0.5, Number(ratio)))));
    const evalSignatures = new Set(signatures.slice(-evalCount));
    return active.filter((row) => evalSignatures.has(row.semanticSignature)).map((row) => ({
      id: `eval-${row.id}`, schemaVersion: 2, category: row.taskClass, instruction: row.objective ?? row.taskKey,
      input: { repository: row.repository, acceptance: row.acceptance, priorRepairs: row.repairHistory },
      expected: { outcome: row.outcome, evidence: row.evidence }, provenance: { source: row.source, taskKey: row.taskKey, sourceRefs: row.sourceRefs, semanticSignature: row.semanticSignature }, split: 'eval'
    }));
  }

  preferencePairs() {
    const grouped = new Map();
    for (const row of this.records) {
      if (row.revoked) continue;
      const key = `${row.repository}:${row.semanticSignature}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }
    const pairs = [];
    for (const rows of grouped.values()) {
      const chosen = rows.find((r) => r.outcome === 'ACCEPT'); const rejected = rows.find((r) => ['REJECT','TERMINATE','ESCALATE','FAILED'].includes(r.outcome));
      if (chosen && rejected) pairs.push({ prompt: chosen.objective, chosen: structuredClone(chosen), rejected: structuredClone(rejected) });
    }
    return pairs;
  }

  manifest() {
    const active = this.records.filter((row) => !row.revoked);
    return {
      schemaVersion: 2, totalRecords: this.records.length, activeRecords: active.length, revokedRecords: this.records.length - active.length,
      acceptedRecords: active.filter((row) => row.outcome === 'ACCEPT').length,
      preferencePairs: this.preferencePairs().length, nearDuplicateGroups: this.nearDuplicates().length,
      redactionFindings: active.reduce((sum, row) => sum + (row.redactionFindings?.length ?? 0), 0)
    };
  }

  snapshot() { return { version: 2, maxRecords: this.maxRecords, records: structuredClone(this.records), revocations: [...this.revocations.values()].map((row) => structuredClone(row)) }; }
  restore(snapshot) {
    this.maxRecords = Math.max(1, Number(snapshot?.maxRecords ?? this.maxRecords));
    this.records = structuredClone(snapshot?.records ?? []).slice(-this.maxRecords);
    this.revocations = new Map((snapshot?.revocations ?? []).map((row) => [row.sourceRef, structuredClone(row)]));
    for (const [sourceRef, row] of this.revocations) for (const record of this.records) if ((record.sourceRefs ?? []).includes(sourceRef)) { record.revoked = true; record.revokedReason = row.reason; }
  }
}
