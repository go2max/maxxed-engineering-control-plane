import { Verdict } from './verifier.js';

export const RepairAction = Object.freeze({ ACCEPT: 'ACCEPT', RETRY_REPAIR: 'RETRY_REPAIR', TERMINATE: 'TERMINATE', ESCALATE: 'ESCALATE' });

export class RepairController {
  constructor({ maxAttempts = 3, breakerThreshold = 3 } = {}) {
    this.maxAttempts = maxAttempts;
    this.breakerThreshold = breakerThreshold;
    this.history = new Map();
  }

  decide(taskKey, verification) {
    const history = this.history.get(taskKey) ?? { attempts: 0, consecutiveSameFailure: 0, lastFingerprint: null, breakerOpen: false };
    if (history.breakerOpen) return { action: RepairAction.TERMINATE, reason: 'circuit breaker open', history: structuredClone(history) };
    if (verification.verdict === Verdict.ACCEPT) {
      this.history.set(taskKey, { ...history, consecutiveSameFailure: 0, lastFingerprint: null });
      return { action: RepairAction.ACCEPT, reason: verification.reason, history: this.get(taskKey) };
    }
    if (verification.verdict === Verdict.ESCALATE) return { action: RepairAction.ESCALATE, reason: verification.reason, history: structuredClone(history) };
    if (verification.verdict === Verdict.REJECT) return { action: RepairAction.TERMINATE, reason: verification.reason, history: structuredClone(history) };

    history.attempts += 1;
    const fingerprint = [...(verification.failed ?? [])].sort().join('|') || verification.reason || 'unknown';
    history.consecutiveSameFailure = history.lastFingerprint === fingerprint ? history.consecutiveSameFailure + 1 : 1;
    history.lastFingerprint = fingerprint;
    if (history.attempts >= this.maxAttempts || history.consecutiveSameFailure >= this.breakerThreshold) {
      history.breakerOpen = true;
      this.history.set(taskKey, history);
      return { action: RepairAction.TERMINATE, reason: 'repair budget exhausted', history: structuredClone(history) };
    }
    this.history.set(taskKey, history);
    return { action: RepairAction.RETRY_REPAIR, reason: verification.reason, history: structuredClone(history) };
  }

  get(taskKey) { const history = this.history.get(taskKey); return history ? structuredClone(history) : null; }
  reset(taskKey) { return this.history.delete(taskKey); }
  snapshot() { return { version: 1, maxAttempts: this.maxAttempts, breakerThreshold: this.breakerThreshold, history: [...this.history.entries()].map(([taskKey, value]) => ({ taskKey, value: structuredClone(value) })) }; }
  restore(snapshot) {
    if (!snapshot || snapshot.version !== 1) throw new Error('unsupported repair controller snapshot');
    this.maxAttempts = Number(snapshot.maxAttempts ?? this.maxAttempts);
    this.breakerThreshold = Number(snapshot.breakerThreshold ?? this.breakerThreshold);
    this.history.clear();
    for (const record of snapshot.history ?? []) this.history.set(record.taskKey, structuredClone(record.value));
  }
}
