import { digest } from '../leverage/solution-cas.js';

/**
 * Periodically forces a full-suite (challenge) validation run even when affected-only
 * verification (ImpactTestSelector) selected a narrower targeted set, so impact-graph blind
 * spots (an impacted test the graph failed to identify) get caught before they compound.
 */
export class ChallengeSuiteScheduler {
  constructor({ everyNTargeted = 8, minIntervalMs = 30 * 60 * 1000, injectedOmissionRate = 0 } = {}) {
    this.everyNTargeted = Math.max(1, Number(everyNTargeted));
    this.minIntervalMs = Math.max(0, Number(minIntervalMs));
    this.injectedOmissionRate = Math.min(1, Math.max(0, Number(injectedOmissionRate)));
    this.byScope = new Map();
  }

  #row(scopeKey) {
    if (!this.byScope.has(scopeKey)) this.byScope.set(scopeKey, { targetedRunsSinceChallenge: 0, lastChallengeAt: null, findings: [] });
    return this.byScope.get(scopeKey);
  }

  /**
   * Decide whether this verification pass should run the full suite ("challenge") instead of
   * (or in addition to) the affected-only selection.
   */
  shouldChallenge({ scopeKey = 'default', selectionMode = 'targeted', now = Date.now() } = {}) {
    if (selectionMode === 'full') return { challenge: false, reason: 'already-full' };
    const row = this.#row(scopeKey);
    const dueByCount = row.targetedRunsSinceChallenge + 1 >= this.everyNTargeted;
    const dueByTime = row.lastChallengeAt == null || (Number(now) - row.lastChallengeAt) >= this.minIntervalMs;
    if (dueByCount && dueByTime) return { challenge: true, reason: 'periodic-challenge-due' };
    return { challenge: false, reason: 'not-due', targetedRunsSinceChallenge: row.targetedRunsSinceChallenge };
  }

  /**
   * Record that a verification pass ran, and (for challenge passes) reconcile the full-suite
   * result against what affected-only selection would have chosen, surfacing any test the
   * impact graph omitted (a "blind spot") as a finding to feed back into the impact graph /
   * learning store.
   */
  record({ scopeKey = 'default', wasChallenge, targetedTests = [], fullSuiteResult = null, now = Date.now() } = {}) {
    const row = this.#row(scopeKey);
    if (wasChallenge) {
      row.lastChallengeAt = Number(now);
      row.targetedRunsSinceChallenge = 0;
      const omitted = fullSuiteResult
        ? (fullSuiteResult.failedTests ?? []).filter((testId) => !targetedTests.includes(testId))
        : [];
      const finding = {
        at: Number(now),
        digest: digest({ scopeKey, targetedTests, omitted }),
        omittedFailingTests: omitted,
        blindSpotDetected: omitted.length > 0
      };
      row.findings.push(finding);
      row.findings = row.findings.slice(-200);
      return finding;
    }
    row.targetedRunsSinceChallenge += 1;
    return { at: Number(now), digest: null, omittedFailingTests: [], blindSpotDetected: false };
  }

  blindSpots(scopeKey = 'default') {
    return (this.byScope.get(scopeKey)?.findings ?? []).filter((row) => row.blindSpotDetected);
  }

  snapshot() {
    return { version: 1, scopes: [...this.byScope.entries()].map(([scopeKey, row]) => [scopeKey, structuredClone(row)]) };
  }

  restore(snapshot) {
    if (snapshot && snapshot.version !== 1) throw new Error('unsupported challenge-suite snapshot');
    this.byScope = new Map((snapshot?.scopes ?? []).map(([scopeKey, row]) => [scopeKey, structuredClone(row)]));
  }
}
