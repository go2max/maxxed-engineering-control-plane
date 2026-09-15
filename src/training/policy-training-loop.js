// Live wiring between the accepted/rejected-outcome learning store (issue #71,
// src/training/outcome-store.js / outcome-recorder.js, recording every real completion since
// PR #82) and the offline/shadow/canary policy-promotion stage machine
// (src/training/policy-promotion.js). Closes the gap noted on issue #73: the stage machine was
// fully built and tested but, before this module, was imported nowhere except its own test.
//
// This module drives ONLY the safe, no-live-authority part of the stage machine automatically:
//
//   OFFLINE_REPLAY -> SHADOW -> BENCHMARK (-> CANARY, entered automatically by promoteThroughGate
//   on a PROMOTE verdict, exactly as policy-promotion.js already defines)
//
// It never calls `recordCanaryResult` or `finalizePromotion`. Those remain explicit, separately
// invoked operations -- CANARY monitoring and the PROMOTION_GATE -> PRODUCTION step still require
// the existing independent approval (`finalizePromotion` throws without an explicit `approvedBy`,
// unchanged here). `PolicyRegistry.getActivePolicy()` never returns anything below PRODUCTION, so
// nothing this module does can gain live authority on its own -- see policy-promotion.js's own
// safety-invariants comment.
//
// BENCHMARK decision authority is unchanged: this module never invents promotion criteria. It only
// assembles the two DomainScores objects `promoteThroughGate` already requires and hands them to
// the existing, unmodified `evaluatePromotionGate` (via `promoteThroughGate`).
//
// Evidence split (how incumbent/candidate scores are built): when a candidate enters SHADOW, the
// outcome records accumulated so far become the frozen "incumbent" (pre-shadow) baseline. Once at
// least `minRecordsForBenchmark` *new* records have been recorded since (i.e. accumulated live
// during shadow), those new records become the "candidate" (shadow-observed) evidence, and both
// are aggregated into DomainScores (via score-benchmark.js's `aggregateDomainScores`, unchanged)
// keyed under the task class as the domain. This is a real, if simple, temporal control/treatment
// split over genuine recorded production outcomes -- not synthetic data -- and it is the same
// DomainScores shape the rest of this repo's promotion machinery already expects.
//
// UNCONFIRMED DEFAULTS: `minRecordsForShadow` / `minRecordsForBenchmark` below are reasonable
// starting thresholds (same caveat as promotion-gate.js's DEFAULT_PROMOTION_POLICY and
// policy-promotion.js's DEFAULT_CANARY_POLICY), not operator-signed-off, and are trivially
// overridable per call.
//
// reuse: internal -- delegates all decision logic to policy-promotion.js and score-benchmark.js
// unchanged; this module's only job is periodic/event-driven wiring plus the outcome-record ->
// CaseResult shaping needed to call them with real data.

import { readOutcomeLog } from './outcome-store.js';
import { PolicyRegistry } from './policy-promotion.js';
import { aggregateDomainScores } from './score-benchmark.js';

const DEFAULT_MIN_RECORDS_FOR_SHADOW = 20;
const DEFAULT_MIN_RECORDS_FOR_BENCHMARK = 20; // new records accumulated *during* shadow

/**
 * Map one redacted outcome-store trajectory record (outcome-store.js's persisted shape) onto the
 * CaseResult shape score-benchmark.js's `aggregateDomainScores` consumes. Pure function.
 *
 * `hallucinated` has no direct field in the outcome-store schema (issue #71 deliberately stores no
 * chain-of-thought, only explicit artifacts/verdicts), so this uses the closest available signal:
 * a record that was accepted despite at least one verifier reporting a `fail` verdict is flagged --
 * something claimed acceptable slipped past a check that itself failed. This is a conservative
 * proxy, not a hallucination detector; callers relying on `hallucinationRate` precision should
 * replace this heuristic once a dedicated signal exists.
 */
export function caseResultFromOutcomeRecord(record) {
  const verifierOutcomes = Array.isArray(record.verifierOutcomes) ? record.verifierOutcomes : [];
  const anyVerifierFailed = verifierOutcomes.some((v) => v.verdict === 'fail');
  return {
    caseId: record.recordId,
    success: record.finalAcceptance === 'accepted',
    hallucinated: record.finalAcceptance === 'accepted' && anyVerifierFailed,
    toolUseCorrect: undefined,
    latencyMs: typeof record.latencyMs === 'number' ? record.latencyMs : undefined,
    costUsd: typeof record.cost?.usd === 'number' ? record.cost.usd : undefined,
  };
}

/**
 * Build the deterministic-fallback candidate policy object registered at OFFLINE_REPLAY for a
 * task class. Summarizes accumulated evidence rather than encoding any new decision authority --
 * this is metadata a downstream router/scheduler could consult, not itself a scoring function.
 */
function deriveCandidatePolicy(taskClass, records) {
  const acceptedCount = records.filter((r) => r.finalAcceptance === 'accepted').length;
  return {
    kind: 'outcome-derived-policy',
    taskClass,
    derivedAt: new Date().toISOString(),
    sampleSize: records.length,
    acceptanceRate: records.length > 0 ? acceptedCount / records.length : 0,
  };
}

/**
 * In-memory-per-process registries and shadow-entry bookkeeping, keyed by task class. Callers that
 * need durability across restarts can serialize `registries` (each is a `PolicyRegistry`, which
 * already supports `toJSON`/`fromJSON`) plus `shadowBaselines` alongside their own snapshot.
 */
export class PolicyTrainingLoop {
  /**
   * @param {Object} options
   * @param {string} options.outcomeLogPath - path to the OutcomeStore JSONL log (matches
   *   ControlPlaneRuntime's `outcomeLogPath`, default 'var/training/outcomes.jsonl').
   * @param {number} [options.minRecordsForShadow]
   * @param {number} [options.minRecordsForBenchmark]
   * @param {(taskClass: string) => Object} [options.deterministicFallbackFor] - fallback policy
   *   object per task class; defaults to a task-class-tagged no-op fallback.
   */
  constructor({
    outcomeLogPath,
    minRecordsForShadow = DEFAULT_MIN_RECORDS_FOR_SHADOW,
    minRecordsForBenchmark = DEFAULT_MIN_RECORDS_FOR_BENCHMARK,
    deterministicFallbackFor = (taskClass) => ({ kind: 'deterministic-fallback', taskClass }),
  } = {}) {
    if (!outcomeLogPath) throw new Error('PolicyTrainingLoop requires outcomeLogPath');
    this.outcomeLogPath = outcomeLogPath;
    this.minRecordsForShadow = minRecordsForShadow;
    this.minRecordsForBenchmark = minRecordsForBenchmark;
    this.deterministicFallbackFor = deterministicFallbackFor;
    /** @type {Map<string, PolicyRegistry>} */
    this.registries = new Map();
    /** @type {Map<string, {version: number, baselineRecordCount: number}>} */
    this.shadowBaselines = new Map();
  }

  registryFor(taskClass) {
    let registry = this.registries.get(taskClass);
    if (!registry) {
      registry = new PolicyRegistry(this.deterministicFallbackFor(taskClass));
      this.registries.set(taskClass, registry);
    }
    return registry;
  }

  /** In-flight candidate (not yet at CANARY/PROMOTION_GATE/PRODUCTION/terminal) for a registry, if any. */
  #inFlightCandidate(registry) {
    return registry.versions.find((v) => v.stage === 'OFFLINE_REPLAY' || v.stage === 'SHADOW' || v.stage === 'BENCHMARK');
  }

  /**
   * Run one training cycle: read the outcome log, and for every task class present, advance that
   * class's candidate through OFFLINE_REPLAY -> SHADOW -> BENCHMARK as evidence supports, never
   * touching CANARY or beyond. Safe to call on any periodic tick or after any batch of new outcome
   * records; a no-op when there is not yet enough evidence to advance.
   *
   * @returns {Array<Object>} one entry per action taken this cycle (registered/advanced/gated).
   */
  sync(now = Date.now()) {
    const allRecords = readOutcomeLog(this.outcomeLogPath);
    if (allRecords.length === 0) return [];

    const byTaskClass = new Map();
    for (const record of allRecords) {
      const taskClass = record.taskClass ?? 'standard';
      if (!byTaskClass.has(taskClass)) byTaskClass.set(taskClass, []);
      byTaskClass.get(taskClass).push(record);
    }

    const actions = [];
    for (const [taskClass, records] of byTaskClass) {
      const registry = this.registryFor(taskClass);
      let candidate = this.#inFlightCandidate(registry);

      // OFFLINE_REPLAY entry: register a new candidate once there is enough accumulated evidence
      // and none is already in flight for this task class. Registration + OFFLINE_REPLAY itself
      // carry no live authority (getActivePolicy never returns it), so this is safe/automatic.
      if (!candidate && records.length >= this.minRecordsForShadow) {
        const version = registry.registerCandidate(deriveCandidatePolicy(taskClass, records));
        candidate = registry.getVersion(version);
        actions.push({ taskClass, version, action: 'REGISTERED', stage: 'OFFLINE_REPLAY', sampleSize: records.length, at: now });
      }
      if (!candidate) continue;

      // OFFLINE_REPLAY -> SHADOW: automatic once the entry threshold is met (it already is, by
      // construction, for a freshly registered candidate; this also covers a candidate registered
      // in a prior cycle that hadn't yet advanced).
      if (candidate.stage === 'OFFLINE_REPLAY' && records.length >= this.minRecordsForShadow) {
        registry.advanceStage(candidate.version, 'SHADOW');
        this.shadowBaselines.set(taskClass, { version: candidate.version, baselineRecordCount: records.length });
        actions.push({ taskClass, version: candidate.version, action: 'ADVANCED', stage: 'SHADOW', at: now });
      }

      if (candidate.stage === 'SHADOW') {
        const baseline = this.shadowBaselines.get(taskClass) ?? { version: candidate.version, baselineRecordCount: records.length };
        if (baseline.version !== candidate.version) {
          // Defensive: a differently-versioned baseline (e.g. after a restart without persisted
          // shadowBaselines) can't be trusted as this candidate's pre-shadow split point. Re-anchor
          // to "no new evidence yet" rather than comparing against the wrong slice.
          this.shadowBaselines.set(taskClass, { version: candidate.version, baselineRecordCount: records.length });
          continue;
        }
        const newRecordCount = records.length - baseline.baselineRecordCount;
        if (newRecordCount >= this.minRecordsForBenchmark) {
          const incumbentRecords = records.slice(0, baseline.baselineRecordCount);
          const candidateRecords = records.slice(baseline.baselineRecordCount);
          const incumbentScores = { [taskClass]: aggregateDomainScores(incumbentRecords.map(caseResultFromOutcomeRecord)) };
          const candidateScores = { [taskClass]: aggregateDomainScores(candidateRecords.map(caseResultFromOutcomeRecord)) };

          registry.advanceStage(candidate.version, 'BENCHMARK');
          actions.push({ taskClass, version: candidate.version, action: 'ADVANCED', stage: 'BENCHMARK', at: now });

          const gateResult = registry.promoteThroughGate({ version: candidate.version, targetDomain: taskClass, incumbentScores, candidateScores });
          actions.push({ taskClass, version: candidate.version, action: 'GATED', verdict: gateResult.verdict, stage: registry.getVersion(candidate.version).stage, at: now });
        }
      }
    }
    return actions;
  }
}
