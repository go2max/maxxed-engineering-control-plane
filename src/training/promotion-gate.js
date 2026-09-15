// Per-domain model promotion gate.
//
// Ports the *decision function* half of the evaluation/promotion architecture described in
// docs/training/EVALUATION_PROMOTION_PORT_DESIGN.md (the email-marketing
// `lib/training-system/promotion-verifier.ts` equivalent), redesigned for this repo's
// no-single-global-score, per-domain requirement:
//
//   "Do not decide 'Model B beat Model A' from one global score. Use a domain eval suite with
//   pass/fail gates. Primary metrics should be task success/correctness, regression rate,
//   hallucination/unsupported-action rate, tool-use correctness, latency, and cost. A replacement
//   model should beat the incumbent on its target domain without materially regressing the
//   safety/reliability gates." (operator directive, 2026-09-13)
//
// This module is pure decision logic: no DB, no filesystem, no network. It takes score objects
// (produced elsewhere, e.g. by scripts/evaluate-model.mjs scoring a domain benchmark from
// training/benchmarks/<domain>/) and returns an accept/reject verdict plus the evidence for it.

/**
 * @typedef {Object} DomainScores
 * @property {number} taskSuccessRate        0..1, higher is better. The domain's primary metric.
 * @property {number} regressionRate         0..1, lower is better. Cross-cutting safety metric.
 * @property {number} hallucinationRate      0..1, lower is better. Cross-cutting safety metric
 *                                            (unsupported-action rate for tool-use domains).
 * @property {number} [toolUseCorrectness]   0..1, higher is better. Reported, not gated by default.
 * @property {number} [latencyMsP50]         milliseconds, lower is better. Reported, not gated by default.
 * @property {number} [costPerTaskUsd]       USD, lower is better. Reported, not gated by default.
 */

/**
 * Default promotion policy.
 *
 * `maxSafetyRegression: 0.02` (2 percentage points, absolute) is the operator-facing default for
 * "materially regress" on the cross-cutting safety metrics. THIS DEFAULT HAS NOT BEEN SIGNED OFF
 * BY THE OPERATOR -- it is a reasonable starting point (tight enough to catch a real regression on
 * a low-hundreds-example eval set, loose enough to tolerate ordinary run-to-run noise) chosen so
 * the mechanism has something concrete to test and ship against. Do not treat it as final; get
 * explicit operator sign-off before this gate makes a real promote/reject call against it, and
 * override it per-metric via `maxRegressionByMetric` once real eval variance is characterized.
 */
export const DEFAULT_PROMOTION_POLICY = Object.freeze({
  version: 1,
  // Metric that must strictly improve on the candidate's target domain for promotion to even be
  // considered. Direction is always "higher is better" for this metric.
  domainPrimaryMetric: 'taskSuccessRate',
  // Candidate must beat incumbent on the target domain's primary metric by more than this many
  // absolute points. 0 means "strictly greater than incumbent" (a tie does not promote).
  minDomainImprovement: 0,
  // Cross-cutting metrics checked on every domain present in both score sets (not just the target
  // domain) -- a candidate that improves its target domain by degrading safety somewhere else
  // must still be rejected. Direction is always "lower is better" for these.
  safetyMetrics: ['regressionRate', 'hallucinationRate'],
  // Default max absolute regression allowed on any safety metric before it counts as "material".
  // UNCONFIRMED DEFAULT -- see module docstring. Configurable globally here, or per-metric via
  // maxRegressionByMetric below.
  maxSafetyRegression: 0.02,
  // Optional per-metric overrides of maxSafetyRegression, e.g. { hallucinationRate: 0.01 } to hold
  // hallucination to a tighter bar than generic regressionRate.
  maxRegressionByMetric: {},
});

function metricThreshold(policy, metric) {
  const override = policy.maxRegressionByMetric?.[metric];
  return typeof override === 'number' ? override : policy.maxSafetyRegression;
}

/**
 * Evaluate whether `candidateScores` should be promoted over `incumbentScores` for
 * `targetDomain`, per the operator's stated policy. Pure function -- no I/O.
 *
 * @param {Object} input
 * @param {string} input.targetDomain - one of training/manifest.json's 7 domains; the domain this
 *   candidate model is being promoted for.
 * @param {Record<string, DomainScores>} input.incumbentScores - incumbent's scores, keyed by
 *   domain. Must include at least `targetDomain`; any other domains present are treated as
 *   cross-cutting safety checks (regressions there block promotion even though they're outside
 *   the target domain).
 * @param {Record<string, DomainScores>} input.candidateScores - candidate's scores, keyed by
 *   domain, same shape as incumbentScores.
 * @param {typeof DEFAULT_PROMOTION_POLICY} [input.policy] - defaults to DEFAULT_PROMOTION_POLICY.
 * @returns {{
 *   verdict: 'PROMOTE'|'REJECT',
 *   targetDomain: string,
 *   domainImprovement: { metric: string, incumbent: number, candidate: number, delta: number, passed: boolean },
 *   safetyRegressions: Array<{ domain: string, metric: string, incumbent: number, candidate: number, delta: number, threshold: number }>,
 *   domainsEvaluated: string[],
 *   reasons: string[],
 *   policy: typeof DEFAULT_PROMOTION_POLICY,
 * }}
 */
export function evaluatePromotionGate({ targetDomain, incumbentScores, candidateScores, policy = DEFAULT_PROMOTION_POLICY }) {
  if (!targetDomain) throw new Error('targetDomain is required');
  if (!incumbentScores || typeof incumbentScores !== 'object') throw new Error('incumbentScores is required');
  if (!candidateScores || typeof candidateScores !== 'object') throw new Error('candidateScores is required');

  const reasons = [];

  const incumbentTarget = incumbentScores[targetDomain];
  const candidateTarget = candidateScores[targetDomain];
  if (!incumbentTarget || !candidateTarget) {
    return {
      verdict: 'REJECT',
      targetDomain,
      domainImprovement: null,
      safetyRegressions: [],
      domainsEvaluated: [],
      reasons: [`missing scores for target domain "${targetDomain}" (incumbent=${!!incumbentTarget}, candidate=${!!candidateTarget})`],
      policy,
    };
  }

  // 1. Target-domain primary metric must strictly improve.
  const metric = policy.domainPrimaryMetric;
  const incumbentValue = incumbentTarget[metric];
  const candidateValue = candidateTarget[metric];
  if (typeof incumbentValue !== 'number' || typeof candidateValue !== 'number') {
    throw new Error(`domain primary metric "${metric}" missing or non-numeric for domain "${targetDomain}"`);
  }
  const delta = candidateValue - incumbentValue;
  const domainPassed = delta > policy.minDomainImprovement;
  const domainImprovement = { metric, incumbent: incumbentValue, candidate: candidateValue, delta, passed: domainPassed };
  if (!domainPassed) {
    reasons.push(
      `candidate did not beat incumbent on target domain "${targetDomain}" metric "${metric}": ` +
        `incumbent=${incumbentValue}, candidate=${candidateValue}, delta=${delta.toFixed(4)}, ` +
        `required improvement > ${policy.minDomainImprovement}`
    );
  }

  // 2. Cross-cutting safety metrics must not materially regress on ANY domain present in both
  //    score sets -- not just the target domain. A candidate that helps its target domain while
  //    quietly breaking safety elsewhere must still be rejected.
  const domainsEvaluated = Object.keys(incumbentScores).filter((domain) => domain in candidateScores);
  const safetyRegressions = [];
  for (const domain of domainsEvaluated) {
    const incumbentDomain = incumbentScores[domain];
    const candidateDomain = candidateScores[domain];
    for (const safetyMetric of policy.safetyMetrics) {
      const before = incumbentDomain[safetyMetric];
      const after = candidateDomain[safetyMetric];
      if (typeof before !== 'number' || typeof after !== 'number') continue; // not scored for this domain; nothing to gate on
      const regressionDelta = after - before; // positive = got worse (lower-is-better metric)
      const threshold = metricThreshold(policy, safetyMetric);
      if (regressionDelta > threshold) {
        safetyRegressions.push({ domain, metric: safetyMetric, incumbent: before, candidate: after, delta: regressionDelta, threshold });
      }
    }
  }
  if (safetyRegressions.length > 0) {
    for (const r of safetyRegressions) {
      reasons.push(
        `material safety regression on domain "${r.domain}" metric "${r.metric}": ` +
          `incumbent=${r.incumbent}, candidate=${r.candidate}, delta=+${r.delta.toFixed(4)}, ` +
          `threshold=${r.threshold} (materially-regress default, unconfirmed by operator)`
      );
    }
  }

  const verdict = domainPassed && safetyRegressions.length === 0 ? 'PROMOTE' : 'REJECT';
  if (verdict === 'PROMOTE') reasons.push(`candidate beats incumbent on target domain "${targetDomain}" with no material safety regressions across ${domainsEvaluated.length} evaluated domain(s)`);

  return { verdict, targetDomain, domainImprovement, safetyRegressions, domainsEvaluated, reasons, policy };
}
