// Aggregates per-case benchmark results into the DomainScores shape consumed by
// src/training/promotion-gate.js. Pure logic, no I/O, no model calls -- this is the piece that
// turns "here's what the model produced for each benchmark case" into the six primary metrics the
// operator specified (task success/correctness, regression rate, hallucination/unsupported-action
// rate, tool-use correctness, latency, cost).
//
// A case result is produced by whatever actually runs the model against
// training/benchmarks/<domain>/cases.jsonl (out of scope here -- see
// docs/training/EVALUATION_PROMOTION_PORT_DESIGN.md's scripts/evaluate-model.mjs follow-up).

/**
 * @typedef {Object} CaseResult
 * @property {string} caseId
 * @property {boolean} success - did the output satisfy the case's checks (task success/correctness).
 * @property {boolean} [hallucinated] - did the output assert/act on something unsupported by the
 *   given input/tools (e.g. claimed a tool call succeeded when it didn't, invented a file/fact).
 * @property {boolean} [toolUseCorrect] - only meaningful for cases with tool_calls_expected; null/
 *   undefined for cases that don't exercise tool use.
 * @property {number} [latencyMs]
 * @property {number} [costUsd]
 */

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  const idx = Math.min(sortedValues.length - 1, Math.floor(p * sortedValues.length));
  return sortedValues[idx];
}

/**
 * Aggregate a run's per-case results into a single domain's DomainScores.
 *
 * @param {CaseResult[]} results
 * @param {Object} [options]
 * @param {Set<string>|string[]} [options.baselinePassedCaseIds] - case ids the incumbent passed on
 *   a prior run of the same benchmark. Used to compute regressionRate: the fraction of
 *   previously-passing cases that this run failed. Without a baseline, regressionRate is reported
 *   as 0 (nothing to regress against yet) -- callers should treat that as "not yet measured", not
 *   as a clean bill of health, until a baseline exists.
 * @returns {{ taskSuccessRate: number, regressionRate: number, hallucinationRate: number,
 *   toolUseCorrectness: number|null, latencyMsP50: number|null, costPerTaskUsd: number|null,
 *   caseCount: number, regressedCaseIds: string[] }}
 */
export function aggregateDomainScores(results, options = {}) {
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error('aggregateDomainScores requires at least one case result');
  }
  const baseline = new Set(options.baselinePassedCaseIds ?? []);

  const caseCount = results.length;
  const successCount = results.filter((r) => r.success).length;
  const hallucinatedCount = results.filter((r) => r.hallucinated === true).length;

  const toolCases = results.filter((r) => typeof r.toolUseCorrect === 'boolean');
  const toolUseCorrectness = toolCases.length > 0 ? toolCases.filter((r) => r.toolUseCorrect).length / toolCases.length : null;

  const latencies = results.map((r) => r.latencyMs).filter((v) => typeof v === 'number').sort((a, b) => a - b);
  const latencyMsP50 = percentile(latencies, 0.5);

  const costs = results.map((r) => r.costUsd).filter((v) => typeof v === 'number');
  const costPerTaskUsd = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : null;

  const regressedCaseIds = results.filter((r) => baseline.has(r.caseId) && !r.success).map((r) => r.caseId);
  const regressionRate = baseline.size > 0 ? regressedCaseIds.length / baseline.size : 0;

  return {
    taskSuccessRate: successCount / caseCount,
    regressionRate,
    hallucinationRate: hallucinatedCount / caseCount,
    toolUseCorrectness,
    latencyMsP50,
    costPerTaskUsd,
    caseCount,
    regressedCaseIds,
  };
}
