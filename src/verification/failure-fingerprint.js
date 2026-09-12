import { createHash } from 'node:crypto';
import { FailureClass } from './verifier.js';

function normalizeText(value) {
  return String(value ?? '')
    .replace(/0x[0-9a-f]+/gi, '<hex>')
    .replace(/\b\d{4,}\b/g, '<n>')
    .replace(/[A-F0-9]{7,40}/gi, '<sha>')
    .replace(/\\/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

export function fingerprintFailure(failure = {}) {
  const canonical = JSON.stringify({
    class: failure.class ?? 'UNKNOWN',
    check: failure.check ?? null,
    code: failure.code ?? null,
    message: normalizeText(failure.message),
    stderr: normalizeText(failure.stderr)
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function buildRepairPlan(failure = {}) {
  const base = { fingerprint: fingerprintFailure(failure), failureClass: failure.class ?? 'UNKNOWN', automatic: true, steps: [] };
  switch (failure.class) {
    case FailureClass.TEST_FAILURE:
      return { ...base, steps: ['isolate-failing-tests', 'inspect-recent-diff', 'apply-bounded-code-repair', 'rerun-targeted-tests', 'rerun-required-acceptance'] };
    case FailureClass.BUILD_FAILURE:
      return { ...base, steps: ['capture-build-diagnostics', 'classify-toolchain-vs-code', 'apply-bounded-build-repair', 'rerun-build', 'rerun-required-acceptance'] };
    case FailureClass.INFRASTRUCTURE_FAILURE:
      return { ...base, steps: ['verify-worker-health', 'release-or-fence-stale-claim', 'reschedule-on-compatible-worker'], retryDifferentWorker: true };
    case FailureClass.SECURITY_FAILURE:
    case FailureClass.POLICY_FAILURE:
      return { ...base, automatic: false, steps: ['quarantine-result', 'preserve-evidence', 'require-policy-review'] };
    case FailureClass.EXTERNAL_STATE_UNCERTAIN:
      return { ...base, automatic: false, requiresReconciliation: true, steps: ['read-authoritative-external-state', 'compare-intended-vs-observed', 'record-reconciliation-evidence', 'resume-only-after-state-known'] };
    default:
      return { ...base, automatic: false, steps: ['preserve-evidence', 'escalate-unclassified-failure'] };
  }
}

export class FailureFingerprintRegistry {
  #records = new Map();

  record(taskKey, failure, now = Date.now()) {
    const fingerprint = fingerprintFailure(failure);
    const current = this.#records.get(fingerprint) ?? { fingerprint, count: 0, firstSeenAt: now, lastSeenAt: now, tasks: [] };
    current.count += 1;
    current.lastSeenAt = now;
    if (!current.tasks.includes(taskKey)) current.tasks.push(taskKey);
    this.#records.set(fingerprint, current);
    return structuredClone(current);
  }

  get(fingerprint) { const value = this.#records.get(fingerprint); return value ? structuredClone(value) : null; }
  list() { return [...this.#records.values()].map((value) => structuredClone(value)); }
}
