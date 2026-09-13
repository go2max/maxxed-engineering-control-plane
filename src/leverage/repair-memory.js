import { digest } from './solution-cas.js';

export class RepairMemory {
  constructor({ maxPerFingerprint = 8 } = {}) { this.maxPerFingerprint = Math.max(1, Number(maxPerFingerprint)); this.byFingerprint = new Map(); }

  remember({ fingerprint, taskClass = 'standard', repairPlan, patchSummary = null, commitSha = null, accepted = true, metadata = {}, now = Date.now() } = {}) {
    if (!fingerprint) throw new Error('fingerprint is required');
    const row = { id: digest({ fingerprint, taskClass, repairPlan, patchSummary, commitSha }), fingerprint, taskClass, repairPlan: structuredClone(repairPlan), patchSummary, commitSha, accepted: Boolean(accepted), metadata: structuredClone(metadata), createdAt: now, hits: 0 };
    const rows = this.byFingerprint.get(fingerprint) ?? []; rows.push(row); rows.sort((a,b) => Number(b.accepted) - Number(a.accepted) || b.createdAt - a.createdAt); this.byFingerprint.set(fingerprint, rows.slice(0, this.maxPerFingerprint));
    return structuredClone(row);
  }

  recall(fingerprint, { acceptedOnly = true, limit = 3 } = {}) {
    const rows = (this.byFingerprint.get(fingerprint) ?? []).filter((r) => !acceptedOnly || r.accepted).slice(0, limit);
    for (const row of rows) row.hits += 1;
    return structuredClone(rows);
  }

  snapshot() { return { version: 1, maxPerFingerprint: this.maxPerFingerprint, rows: [...this.byFingerprint.entries()].map(([fingerprint, rows]) => [fingerprint, structuredClone(rows)]) }; }
  restore(snapshot) { this.maxPerFingerprint = Math.max(1, Number(snapshot?.maxPerFingerprint ?? this.maxPerFingerprint)); this.byFingerprint = new Map(structuredClone(snapshot?.rows ?? [])); }
}
