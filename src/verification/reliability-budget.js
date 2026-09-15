// Reliability budget: model expected chain reliability from real stage-level acceptance rates and
// flag work chains whose compounded reliability falls below policy (issue #98).
//
// This module is a *primitive*: it is additive, self-contained, and NOT wired into the live
// dispatch/scheduling loop in this PR. Wiring (deciding which chains get scored and what happens
// when a chain is flagged -- block, warn, re-route) is deferred to a follow-up PR once this
// primitive has been reviewed, per docs/MULTI_AGENT_ORCHESTRATION_PLAYBOOK.md's two-wave pattern.
//
// reuse: internal -- reads stage-level acceptance/error rates FROM existing authorities rather
// than building a second outcome-tracking system:
//   - src/training/outcome-store.js (live since #71/#82/#88): readOutcomeLog() returns real
//     accepted/rejected trajectory records, each carrying `verifierOutcomes` (per-stage pass/fail)
//     and `executor` (which model/kind ran the stage). This module aggregates those records into
//     per-stage pass rates; it does not persist any new trajectory data of its own.
//   - src/scheduler/worker-performance.js (live): WorkerPerformanceLedger already tracks a
//     per-worker/taskClass EWMA acceptance rate. Where a caller already has a ledger populated
//     from live dispatch, `stageRateFromWorkerPerformance` adapts that number into the same
//     `StageRate` shape used here, so the two authorities can be combined without duplicating
//     either one.
//
// Nothing in this file introduces a parallel place to record accept/reject outcomes -- it only
// reads and scores.

/**
 * @typedef {Object} StageRate
 * @property {string} stage
 * @property {number} total     - number of observed attempts at this stage
 * @property {number} accepted  - number of those attempts that passed/were accepted
 * @property {number} rate      - accepted / total (0 when total === 0; see `confidence`)
 * @property {number} lowerBound - Wilson-score lower confidence bound on the true acceptance rate;
 *   used (not the raw rate) when scoring chains so a stage with few observations can't masquerade
 *   as reliable.
 * @property {number} confidence - 0..1, min(1, total / minSamples)
 */

const DEFAULT_MIN_SAMPLES_FOR_FULL_CONFIDENCE = 10;
const DEFAULT_Z = 1.96; // ~95% confidence, matches Wilson-score convention used elsewhere in repo-style EWMA/statistical helpers

/**
 * Wilson score interval lower bound for a binomial proportion. Standard, well-known formula
 * (no external dependency needed for a single closed-form expression) -- chosen over a naive
 * `accepted / total` because a stage observed only 2-3 times must not be treated as reliably as
 * one observed hundreds of times; the lower bound shrinks toward 0.5 credit as `total` shrinks.
 *
 * @param {number} accepted
 * @param {number} total
 * @param {number} [z]
 * @returns {number} lower bound in [0, 1]; returns 0 when total is 0
 */
export function wilsonLowerBound(accepted, total, z = DEFAULT_Z) {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const p = accepted / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const centre = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return Math.max(0, (centre - margin) / denominator);
}

/**
 * Aggregate real stage-level acceptance rates from OutcomeStore trajectory records
 * (`src/training/outcome-store.js`'s `readOutcomeLog` / `buildTrajectoryRecord` shape).
 *
 * A "stage" is identified by `verifierOutcomes[].name` (e.g. "planner-review", "unit-tests",
 * "code-review"). Records with no verifierOutcomes contribute nothing (they carry no stage-level
 * signal); this function never fabricates a stage that wasn't actually observed.
 *
 * @param {Object[]} records - OutcomeStore records (already redacted/validated), as returned by
 *   `readOutcomeLog(logPath)`.
 * @param {Object} [options]
 * @param {number} [options.minSamplesForFullConfidence]
 * @returns {Map<string, StageRate>}
 */
export function stageAcceptanceRatesFromOutcomeStore(records, options = {}) {
  const minSamples = options.minSamplesForFullConfidence ?? DEFAULT_MIN_SAMPLES_FOR_FULL_CONFIDENCE;
  const tallies = new Map(); // stage -> { accepted, total }

  for (const record of records ?? []) {
    const outcomes = Array.isArray(record?.verifierOutcomes) ? record.verifierOutcomes : [];
    for (const outcome of outcomes) {
      if (!outcome?.name) continue;
      const tally = tallies.get(outcome.name) ?? { accepted: 0, total: 0 };
      tally.total += 1;
      if (outcome.verdict === 'pass') tally.accepted += 1;
      tallies.set(outcome.name, tally);
    }
  }

  return buildStageRateMap(tallies, minSamples);
}

/**
 * Adapt a `WorkerPerformanceLedger` (`src/scheduler/worker-performance.js`, live) stat for a given
 * worker/taskClass/language into the same `StageRate` shape used by this module, so a chain can
 * mix executor-level reliability (from the scheduler's own ledger) with verifier-stage reliability
 * (from OutcomeStore) without a second acceptance-tracking mechanism being written.
 *
 * @param {string} stageName - the label to use for this stage in the chain (caller's choice, e.g.
 *   `executor:worker-1`)
 * @param {import('../scheduler/worker-performance.js').WorkerPerformanceLedger} ledger
 * @param {string} workerId
 * @param {string} [taskClass]
 * @param {string} [language]
 * @param {Object} [options]
 * @param {number} [options.minSamplesForFullConfidence]
 * @returns {StageRate}
 */
export function stageRateFromWorkerPerformance(stageName, ledger, workerId, taskClass = 'standard', language = 'any', options = {}) {
  const minSamples = options.minSamplesForFullConfidence ?? DEFAULT_MIN_SAMPLES_FOR_FULL_CONFIDENCE;
  const stats = ledger.stats(workerId, taskClass, language);
  const total = stats.runs ?? 0;
  const accepted = Math.round((stats.acceptanceRate ?? 0) * total);
  const [rate] = buildStageRateMap(new Map([[stageName, { accepted, total }]]), minSamples).values();
  return rate;
}

function buildStageRateMap(tallies, minSamples) {
  const rates = new Map();
  for (const [stage, tally] of tallies) {
    const { accepted, total } = tally;
    rates.set(stage, {
      stage,
      total,
      accepted,
      rate: total > 0 ? accepted / total : 0,
      lowerBound: wilsonLowerBound(accepted, total),
      confidence: Math.min(1, total / minSamples),
    });
  }
  return rates;
}

/**
 * A chain: an ordered list of stage names representing a work packet's actual sequence of
 * probabilistic (LLM-mediated) transitions, e.g. `['plan', 'code', 'review', 'qa']`.
 *
 * @typedef {Object} ChainReliabilityResult
 * @property {string[]} chain
 * @property {Array<{stage: string, rate: number, lowerBound: number, confidence: number, observed: boolean}>} stages
 * @property {number} reliability      - naive product of per-stage rates (upper estimate)
 * @property {number} conservativeReliability - product of per-stage Wilson lower bounds; used for
 *   the policy comparison since it's the number that shouldn't be gamed by small sample sizes.
 * @property {number} meetsPolicy - see options.policyMinimum
 * @property {number} shortfall - max(0, policyMinimum - conservativeReliability)
 * @property {string[]} unobservedStages - stages with no data in `stageRates` at all (treated as
 *   the most conservative possible: rate 0, so they always trip the policy floor and are called
 *   out explicitly rather than silently assumed reliable)
 */

const DEFAULT_POLICY_MINIMUM = 0.7;
const DEFAULT_UNOBSERVED_STAGE_RATE = 0; // fail-closed: no data means "assume unreliable", not "assume fine"

/**
 * Model expected chain reliability by treating each stage's transition as (conservatively)
 * independent and multiplying stage-level acceptance rates, per the issue's "Model expected chain
 * reliability from stage-level acceptance/error rates" requirement. Independence is a simplifying
 * assumption (stated explicitly here, not hidden) consistent with how compounding failure risk is
 * conventionally modeled across pipeline stages when no correlation data exists; if correlation
 * data becomes available later this function's shape (return per-stage rates alongside the
 * product) leaves room to replace the product with a more precise joint estimate.
 *
 * @param {string[]} chain - ordered stage names
 * @param {Map<string, StageRate>} stageRates - from `stageAcceptanceRatesFromOutcomeStore` and/or
 *   `stageRateFromWorkerPerformance`, merged by the caller if combining sources
 * @param {Object} [options]
 * @param {number} [options.policyMinimum] - minimum acceptable conservativeReliability, default 0.7
 * @returns {ChainReliabilityResult}
 */
export function estimateChainReliability(chain, stageRates, options = {}) {
  if (!Array.isArray(chain) || chain.length === 0) throw new Error('chain must be a non-empty array of stage names');
  const policyMinimum = options.policyMinimum ?? DEFAULT_POLICY_MINIMUM;

  const unobservedStages = [];
  const stages = chain.map((stageName) => {
    const known = stageRates?.get?.(stageName);
    if (!known) {
      unobservedStages.push(stageName);
      return { stage: stageName, rate: DEFAULT_UNOBSERVED_STAGE_RATE, lowerBound: DEFAULT_UNOBSERVED_STAGE_RATE, confidence: 0, observed: false };
    }
    return { stage: stageName, rate: known.rate, lowerBound: known.lowerBound, confidence: known.confidence, observed: true };
  });

  const reliability = stages.reduce((acc, s) => acc * s.rate, 1);
  const conservativeReliability = stages.reduce((acc, s) => acc * s.lowerBound, 1);
  const meetsPolicy = conservativeReliability >= policyMinimum;

  return {
    chain: [...chain],
    stages,
    reliability,
    conservativeReliability,
    meetsPolicy,
    shortfall: Math.max(0, policyMinimum - conservativeReliability),
    unobservedStages,
  };
}

/**
 * Score a batch of named chains and return only the ones that fall below policy, sorted worst
 * first -- the issue's "Flag chains whose compounded reliability falls below policy" requirement.
 *
 * @param {Record<string, string[]>} namedChains - chain name -> ordered stage list
 * @param {Map<string, StageRate>} stageRates
 * @param {Object} [options] - forwarded to `estimateChainReliability`
 * @returns {Array<{name: string} & ChainReliabilityResult>}
 */
export function flagUnsafeChains(namedChains, stageRates, options = {}) {
  const flagged = [];
  for (const [name, chain] of Object.entries(namedChains ?? {})) {
    const result = estimateChainReliability(chain, stageRates, options);
    if (!result.meetsPolicy) flagged.push({ name, ...result });
  }
  return flagged.sort((a, b) => a.conservativeReliability - b.conservativeReliability);
}

// ---------------------------------------------------------------------------------------------
// deterministic-transform-first decision helper
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {Object} DeterministicFirstStep
 * @property {string} step - one of 'reason', 'transform', 'guard', 'reason-if-unresolved',
 *   'independent-verification'
 * @property {boolean} invoked
 * @property {boolean} [resolved] - present for steps that can resolve the work
 * @property {string} [note]
 */

/**
 * @typedef {Object} DeterministicFirstResult
 * @property {DeterministicFirstStep[]} trace - the actual sequence executed, in order
 * @property {boolean} resolved
 * @property {*} result - the resolving step's output, or undefined if unresolved
 * @property {number} avoidedModelCalls - count of probabilistic ("reason"/"reason-if-unresolved")
 *   steps that were SKIPPED because a deterministic transform/guard or the initial reasoning
 *   already resolved the work -- this is the "track avoided model calls" acceptance criterion.
 * @property {boolean} independentVerificationRan - true unless the caller explicitly opted out,
 *   since this helper must never let a deterministic shortcut skip independent verification
 *   (issue #98: "No weakening of independent verification or safety gates").
 */

/**
 * Runs the issue's preferred pattern in strict order:
 *
 *   reason -> deterministic transform/guard -> reason-if-unresolved -> independent verification
 *
 * `reason` is always attempted first (an initial LLM/human judgment call proposing what to do).
 * If a deterministic transform or guard is registered AND can settle the case, it runs next and,
 * if it resolves the work, the (probabilistic) `reasonIfUnresolved` step is skipped entirely --
 * that's the avoided model call this whole primitive exists to count. Independent verification
 * always runs afterward regardless of which earlier step resolved the work; this helper has no
 * option to skip it, by design, so it cannot be used to weaken a safety gate.
 *
 * All step functions are plain callables the caller supplies; this module contains no model
 * calls, network calls, or I/O of its own -- it only sequences caller-provided steps and records
 * which ones ran.
 *
 * @param {Object} steps
 * @param {() => {resolved: boolean, result?: *}} steps.reason - initial reasoning step. Must
 *   return `{ resolved, result }`; `resolved: false` means "needs a deterministic transform/guard
 *   or further reasoning before this is safe to act on".
 * @param {null | ((reasonResult: *) => {applicable: boolean, resolved?: boolean, result?: *})} [steps.transformOrGuard] -
 *   deterministic transform/guard, e.g. a known-safe rewrite, schema validator, or policy check.
 *   Returns `{ applicable: false }` when it doesn't apply to this case (falls through to
 *   reason-if-unresolved), or `{ applicable: true, resolved, result }` when it does.
 * @param {(reasonResult: *, transformResult: *) => {resolved: boolean, result?: *}} [steps.reasonIfUnresolved] -
 *   probabilistic step invoked ONLY when neither `reason` nor the transform/guard resolved the
 *   work. This is the call `avoidedModelCalls` counts when it is skipped.
 * @param {(candidateResult: *) => {ok: boolean, result?: *}} steps.independentVerification -
 *   always invoked on whatever candidate result the chain produced; required (throws if omitted)
 *   so this helper cannot be used to skip verification.
 * @returns {DeterministicFirstResult}
 */
export function decideDeterministicTransformFirst(steps) {
  if (typeof steps?.reason !== 'function') throw new Error('steps.reason is required');
  if (typeof steps?.independentVerification !== 'function') {
    throw new Error('steps.independentVerification is required -- this helper must never skip independent verification');
  }

  const trace = [];
  let avoidedModelCalls = 0;
  let resolved = false;
  let result;

  const reasonOutcome = steps.reason();
  trace.push({ step: 'reason', invoked: true, resolved: !!reasonOutcome?.resolved });
  if (reasonOutcome?.resolved) {
    resolved = true;
    result = reasonOutcome.result;
  }

  let transformOutcome;
  if (!resolved && typeof steps.transformOrGuard === 'function') {
    transformOutcome = steps.transformOrGuard(reasonOutcome?.result);
    if (transformOutcome?.applicable) {
      trace.push({ step: 'transform', invoked: true, resolved: !!transformOutcome.resolved });
      if (transformOutcome.resolved) {
        resolved = true;
        result = transformOutcome.result;
      }
    } else {
      trace.push({ step: 'transform', invoked: true, resolved: false, note: 'not applicable to this case' });
    }
  } else if (!resolved) {
    trace.push({ step: 'transform', invoked: false, note: 'no transformOrGuard registered' });
  }

  if (!resolved && typeof steps.reasonIfUnresolved === 'function') {
    const reasonAgainOutcome = steps.reasonIfUnresolved(reasonOutcome?.result, transformOutcome?.result);
    trace.push({ step: 'reason-if-unresolved', invoked: true, resolved: !!reasonAgainOutcome?.resolved });
    if (reasonAgainOutcome?.resolved) {
      resolved = true;
      result = reasonAgainOutcome.result;
    }
  } else if (resolved) {
    // The deterministic path already settled it -- this is the avoided probabilistic call.
    avoidedModelCalls += 1;
    trace.push({ step: 'reason-if-unresolved', invoked: false, note: 'skipped: already resolved by reason/transform-guard' });
  } else {
    trace.push({ step: 'reason-if-unresolved', invoked: false, note: 'no reasonIfUnresolved registered and work remains unresolved' });
  }

  const verification = steps.independentVerification(result);
  trace.push({ step: 'independent-verification', invoked: true, resolved: !!verification?.ok });

  return {
    trace,
    resolved: resolved && !!verification?.ok,
    result: verification?.ok ? (verification.result ?? result) : undefined,
    avoidedModelCalls,
    independentVerificationRan: true,
  };
}
