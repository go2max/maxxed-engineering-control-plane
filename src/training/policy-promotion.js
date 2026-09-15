// Promotion-gated self-improvement loop for learned orchestration policies (issue #71).
//
// Extends src/training/promotion-gate.js (benchmark accept/reject decision logic) with the
// surrounding stage machine the issue requires:
//
//   offline replay -> shadow -> benchmark -> canary -> independent promotion gate -> production
//
// and with versioned policy storage plus automatic rollback. This module does not re-implement
// benchmark scoring: the BENCHMARK stage delegates to `evaluatePromotionGate` from
// promotion-gate.js, so there remains exactly one training/promotion authority in this repo.
//
// Safety invariants enforced here:
//   - a policy at any stage other than PRODUCTION has no live authority: `getActivePolicy` never
//     returns a SHADOW/CANARY-stage policy, only PRODUCTION (or the deterministic fallback).
//   - a worse candidate cannot reach PRODUCTION: `promoteThroughGate` refuses to advance a
//     candidate whose benchmark verdict is REJECT.
//   - canary regression rolls back automatically: `evaluateCanary` returns a rollback verdict when
//     any monitored metric worsens beyond its threshold, and `PolicyRegistry.recordCanaryResult`
//     applies that rollback immediately, restoring the previous PRODUCTION version.
//   - a deterministic fallback is always available and is never itself replaced by promotion --
//     `getActivePolicy` falls back to it whenever no PRODUCTION version exists or the current
//     PRODUCTION version has been rolled back with nothing to replace it.
//
// reuse: internal -- stage machine is new (this repo's authority boundary is specific to it), but
// the accept/reject decision at the BENCHMARK stage reuses evaluatePromotionGate unchanged rather
// than duplicating its logic.

import { evaluatePromotionGate, DEFAULT_PROMOTION_POLICY } from './promotion-gate.js';

export const PROMOTION_STAGES = Object.freeze([
  'OFFLINE_REPLAY',
  'SHADOW',
  'BENCHMARK',
  'CANARY',
  'PROMOTION_GATE',
  'PRODUCTION',
]);

const STAGE_INDEX = new Map(PROMOTION_STAGES.map((s, i) => [s, i]));

/**
 * Default canary-monitoring policy: candidate must not worsen any of these metrics beyond the
 * given absolute threshold relative to the current production/control policy, over the canary
 * window. UNCONFIRMED DEFAULTS, same caveat as promotion-gate.js's DEFAULT_PROMOTION_POLICY --
 * reasonable starting thresholds, not operator-signed-off.
 */
export const DEFAULT_CANARY_POLICY = Object.freeze({
  version: 1,
  maxAcceptanceRateDrop: 0.02, // acceptance rate lower-is-worse
  maxCostIncreasePct: 0.15,
  maxLatencyIncreasePct: 0.15,
  maxRollbackRateIncrease: 0.01,
  maxSecurityIncidentIncrease: 0, // any increase in security incidents rolls back
  maxVerifierEscapeRateIncrease: 0.005,
});

/**
 * @typedef {Object} CanaryMetrics
 * @property {number} acceptanceRate 0..1
 * @property {number} costPerTaskUsd
 * @property {number} latencyMsP50
 * @property {number} rollbackRate 0..1
 * @property {number} securityIncidentCount
 * @property {number} verifierEscapeRate 0..1
 */

function pctIncrease(before, after) {
  if (before === 0) return after > 0 ? Infinity : 0;
  return (after - before) / before;
}

/**
 * Compare candidate canary metrics against control (current production) metrics and decide
 * whether the canary should continue/promote or roll back immediately. Pure function.
 *
 * @param {CanaryMetrics} controlMetrics
 * @param {CanaryMetrics} candidateMetrics
 * @param {typeof DEFAULT_CANARY_POLICY} [policy]
 * @returns {{ verdict: 'CONTINUE'|'ROLLBACK', regressions: Array<{metric: string, control: number, candidate: number, delta: number}>, policy: typeof DEFAULT_CANARY_POLICY }}
 */
export function evaluateCanary(controlMetrics, candidateMetrics, policy = DEFAULT_CANARY_POLICY) {
  const regressions = [];

  const acceptanceDrop = controlMetrics.acceptanceRate - candidateMetrics.acceptanceRate;
  if (acceptanceDrop > policy.maxAcceptanceRateDrop) {
    regressions.push({ metric: 'acceptanceRate', control: controlMetrics.acceptanceRate, candidate: candidateMetrics.acceptanceRate, delta: -acceptanceDrop });
  }

  const costIncrease = pctIncrease(controlMetrics.costPerTaskUsd, candidateMetrics.costPerTaskUsd);
  if (costIncrease > policy.maxCostIncreasePct) {
    regressions.push({ metric: 'costPerTaskUsd', control: controlMetrics.costPerTaskUsd, candidate: candidateMetrics.costPerTaskUsd, delta: costIncrease });
  }

  const latencyIncrease = pctIncrease(controlMetrics.latencyMsP50, candidateMetrics.latencyMsP50);
  if (latencyIncrease > policy.maxLatencyIncreasePct) {
    regressions.push({ metric: 'latencyMsP50', control: controlMetrics.latencyMsP50, candidate: candidateMetrics.latencyMsP50, delta: latencyIncrease });
  }

  const rollbackIncrease = candidateMetrics.rollbackRate - controlMetrics.rollbackRate;
  if (rollbackIncrease > policy.maxRollbackRateIncrease) {
    regressions.push({ metric: 'rollbackRate', control: controlMetrics.rollbackRate, candidate: candidateMetrics.rollbackRate, delta: rollbackIncrease });
  }

  const securityIncrease = candidateMetrics.securityIncidentCount - controlMetrics.securityIncidentCount;
  if (securityIncrease > policy.maxSecurityIncidentIncrease) {
    regressions.push({ metric: 'securityIncidentCount', control: controlMetrics.securityIncidentCount, candidate: candidateMetrics.securityIncidentCount, delta: securityIncrease });
  }

  const escapeIncrease = candidateMetrics.verifierEscapeRate - controlMetrics.verifierEscapeRate;
  if (escapeIncrease > policy.maxVerifierEscapeRateIncrease) {
    regressions.push({ metric: 'verifierEscapeRate', control: controlMetrics.verifierEscapeRate, candidate: candidateMetrics.verifierEscapeRate, delta: escapeIncrease });
  }

  return { verdict: regressions.length > 0 ? 'ROLLBACK' : 'CONTINUE', regressions, policy };
}

/**
 * In-memory versioned registry of a single learned policy "slot" (e.g. "shard-sizing-policy",
 * "model-router-policy"). Callers own persistence of `toJSON()`/`fromJSON()` if durability across
 * process restarts is needed; the registry itself is deterministic pure state.
 */
export class PolicyRegistry {
  /**
   * @param {Object} deterministicFallback - always-available, never-promoted fallback policy.
   *   Must be an object identifying the policy (e.g. { kind: 'shard-sizing', rule: 'fixed-1' }).
   */
  constructor(deterministicFallback) {
    if (!deterministicFallback) throw new Error('PolicyRegistry requires a deterministicFallback policy');
    this.deterministicFallback = deterministicFallback;
    /** @type {Array<{version: number, stage: string, policy: Object, history: string[]}>} */
    this.versions = [];
    this.nextVersion = 1;
  }

  /**
   * Register a new candidate policy at OFFLINE_REPLAY, the entry stage. Returns its version number.
   */
  registerCandidate(policy) {
    const version = this.nextVersion++;
    this.versions.push({ version, stage: 'OFFLINE_REPLAY', policy, history: ['OFFLINE_REPLAY'] });
    return version;
  }

  #get(version) {
    const entry = this.versions.find((v) => v.version === version);
    if (!entry) throw new Error(`unknown policy version ${version}`);
    return entry;
  }

  /**
   * Advance a candidate from its current stage to the next stage in PROMOTION_STAGES, in order.
   * Refuses to skip stages. Use `promoteThroughGate` to go through BENCHMARK with a verdict.
   */
  advanceStage(version, toStage) {
    const entry = this.#get(version);
    const fromIdx = STAGE_INDEX.get(entry.stage);
    const toIdx = STAGE_INDEX.get(toStage);
    if (toIdx === undefined) throw new Error(`unknown stage "${toStage}"`);
    if (toIdx !== fromIdx + 1) {
      throw new Error(`cannot advance version ${version} from ${entry.stage} directly to ${toStage} (stages must advance one at a time)`);
    }
    entry.stage = toStage;
    entry.history.push(toStage);
    return entry;
  }

  /**
   * Run the BENCHMARK stage: delegate to evaluatePromotionGate. A REJECT verdict leaves the
   * candidate at BENCHMARK (it does not advance, and can never reach PRODUCTION from here) so a
   * worse candidate cannot promote. A PROMOTE verdict advances it to CANARY.
   */
  promoteThroughGate({ version, targetDomain, incumbentScores, candidateScores, policy = DEFAULT_PROMOTION_POLICY }) {
    const entry = this.#get(version);
    if (entry.stage !== 'BENCHMARK') {
      throw new Error(`version ${version} must be at BENCHMARK stage to run the promotion gate (currently ${entry.stage})`);
    }
    const result = evaluatePromotionGate({ targetDomain, incumbentScores, candidateScores, policy });
    entry.lastGateResult = result;
    if (result.verdict === 'PROMOTE') {
      this.advanceStage(version, 'CANARY');
    }
    return result;
  }

  /**
   * Record a canary result for a CANARY-stage candidate. On CONTINUE, advances to
   * PROMOTION_GATE (an independent human/operator sign-off gate, represented here as a stage a
   * caller must explicitly advance past via `finalizePromotion` -- this method does not itself
   * grant production authority). On ROLLBACK, the candidate is marked ROLLED_BACK and never
   * reaches PRODUCTION; the currently active PRODUCTION version (if any) is left untouched, which
   * is itself the rollback (control keeps serving).
   */
  recordCanaryResult(version, controlMetrics, candidateMetrics, canaryPolicy = DEFAULT_CANARY_POLICY) {
    const entry = this.#get(version);
    if (entry.stage !== 'CANARY') {
      throw new Error(`version ${version} must be at CANARY stage to record a canary result (currently ${entry.stage})`);
    }
    const result = evaluateCanary(controlMetrics, candidateMetrics, canaryPolicy);
    entry.lastCanaryResult = result;
    if (result.verdict === 'CONTINUE') {
      this.advanceStage(version, 'PROMOTION_GATE');
    } else {
      entry.stage = 'ROLLED_BACK';
      entry.history.push('ROLLED_BACK');
    }
    return result;
  }

  /**
   * Independent promotion gate: requires an explicit approval token distinct from the benchmark
   * verdict (e.g. an operator/second-system sign-off id), so a single automated pipeline cannot
   * both decide and grant production authority. Advances PROMOTION_GATE -> PRODUCTION and demotes
   * any prior PRODUCTION version for this registry to RETIRED.
   */
  finalizePromotion(version, { approvedBy } = {}) {
    const entry = this.#get(version);
    if (entry.stage !== 'PROMOTION_GATE') {
      throw new Error(`version ${version} must be at PROMOTION_GATE stage to finalize promotion (currently ${entry.stage})`);
    }
    if (!approvedBy) {
      throw new Error('finalizePromotion requires an explicit approvedBy identifier (independent gate, not self-authorized)');
    }
    for (const other of this.versions) {
      if (other.stage === 'PRODUCTION') {
        other.stage = 'RETIRED';
        other.history.push('RETIRED');
      }
    }
    entry.stage = 'PRODUCTION';
    entry.history.push('PRODUCTION');
    entry.approvedBy = approvedBy;
    return entry;
  }

  /**
   * Roll back the currently active PRODUCTION version to RETIRED (e.g. a post-promotion
   * regression detected outside the canary window: acceptance, cost, latency, rollback rate,
   * security, or verifier-escape-rate worsening). The registry then falls back to the previous
   * PRODUCTION version if one exists, else the deterministic fallback -- see getActivePolicy.
   */
  rollbackProduction(reason) {
    const current = this.versions.find((v) => v.stage === 'PRODUCTION');
    if (!current) return null;
    current.stage = 'ROLLED_BACK';
    current.history.push('ROLLED_BACK');
    current.rollbackReason = reason ?? 'unspecified regression';
    return current;
  }

  /**
   * The only policy with live authority. Never returns a SHADOW/CANARY/PROMOTION_GATE-stage
   * policy. Falls back to the deterministic policy when no PRODUCTION version exists.
   */
  getActivePolicy() {
    const production = this.versions.find((v) => v.stage === 'PRODUCTION');
    if (production) return { version: production.version, stage: 'PRODUCTION', policy: production.policy, isFallback: false };
    return { version: 0, stage: 'DETERMINISTIC_FALLBACK', policy: this.deterministicFallback, isFallback: true };
  }

  getVersion(version) {
    return this.#get(version);
  }

  toJSON() {
    return { deterministicFallback: this.deterministicFallback, versions: this.versions, nextVersion: this.nextVersion };
  }

  static fromJSON(data) {
    const registry = new PolicyRegistry(data.deterministicFallback);
    registry.versions = data.versions;
    registry.nextVersion = data.nextVersion;
    return registry;
  }
}
