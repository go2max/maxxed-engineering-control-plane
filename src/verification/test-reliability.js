export class TestReliabilityLedger {
  constructor({ flakyWindow = 12, minRuns = 4, flakyFailureRateMin = 0.1, flakyFailureRateMax = 0.9 } = {}) {
    this.flakyWindow = Math.max(4, Number(flakyWindow)); this.minRuns = Math.max(2, Number(minRuns)); this.flakyFailureRateMin = Number(flakyFailureRateMin); this.flakyFailureRateMax = Number(flakyFailureRateMax); this.tests = new Map();
  }

  record({ testId, passed, sourceSha, durationMs = null, failureFingerprint = null, safetyCritical = false, now = Date.now() } = {}) {
    if (!testId || !/^[0-9a-f]{40}$/i.test(String(sourceSha ?? ''))) throw new Error('testId and exact sourceSha are required');
    const row = this.tests.get(testId) ?? { testId, safetyCritical: Boolean(safetyCritical), runs: [] };
    row.safetyCritical ||= Boolean(safetyCritical);
    row.runs.push({ passed: Boolean(passed), sourceSha: String(sourceSha).toLowerCase(), durationMs: Number.isFinite(durationMs) ? Number(durationMs) : null, failureFingerprint, at: Number(now) });
    row.runs = row.runs.slice(-this.flakyWindow);
    this.tests.set(testId, row); return this.classify(testId);
  }

  classify(testId) {
    const row = this.tests.get(testId); if (!row) return { testId, classification: 'UNKNOWN', quarantineEligible: false, runs: 0 };
    const runs = row.runs; const failures = runs.filter((run) => !run.passed); const failureRate = runs.length ? failures.length / runs.length : 0;
    const sameShaMixed = new Map();
    for (const run of runs) { if (!sameShaMixed.has(run.sourceSha)) sameShaMixed.set(run.sourceSha, new Set()); sameShaMixed.get(run.sourceSha).add(run.passed); }
    const mixedOnUnchangedSource = [...sameShaMixed.values()].some((outcomes) => outcomes.size > 1);
    let classification = 'STABLE';
    if (runs.length < this.minRuns) classification = 'INSUFFICIENT_EVIDENCE';
    else if (mixedOnUnchangedSource && failureRate >= this.flakyFailureRateMin && failureRate <= this.flakyFailureRateMax) classification = 'FLAKY';
    else if (failureRate === 1) classification = 'CONSISTENT_FAILURE';
    const quarantineEligible = classification === 'FLAKY' && !row.safetyCritical;
    return { testId, classification, quarantineEligible, safetyCritical: row.safetyCritical, runs: runs.length, failures: failures.length, failureRate, mixedOnUnchangedSource };
  }

  quarantineCandidates() { return [...this.tests.keys()].map((id) => this.classify(id)).filter((row) => row.quarantineEligible); }
  snapshot() { return { version: 1, tests: [...this.tests.values()].map((row) => structuredClone(row)) }; }
  restore(snapshot) { if (snapshot && snapshot.version !== 1) throw new Error('unsupported reliability snapshot'); this.tests = new Map((snapshot?.tests ?? []).map((row) => [row.testId, structuredClone(row)])); }
}
