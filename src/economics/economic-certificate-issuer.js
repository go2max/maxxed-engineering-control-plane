// Issue #68/#82 gap closer: nothing in the codebase issued the EconomicImpactCertificate that the
// live, fail-closed EconomicVerifier requires for C3+ merges -- so every real C3+ merge would be
// blocked with no path to pass. EconomicCertificateIssuer closes that gap by collecting the
// economic evidence a real merge candidate already carries (or that its execution produced) and
// issuing a source-bound EconomicImpactCertificate via the *existing* certificate format
// (EconomicImpactCertificate.issue) -- this module never invents a second certificate schema.
//
// Authority boundaries (do not blur):
//   - This issuer only *estimates and issues evidence*. It never decides economic acceptance --
//     that stays with EconomicVerifier (already wired live in #82).
//   - The issuer's identity must be distinct from the implementer/executor and from the functional
//     verifier (independence check below), matching EconomicVerifier's own independence rule --
//     the entity that wrote or functionally verified the code can never self-certify its economics.
//   - No new scheduler, verifier, telemetry system, training system or policy system is built
//     here: risk classification reuses MergeRiskClassifier, cost math reuses cost-lenses.js and
//     recurring-cost-amplifier.js, pricing reuses the local pricing-table.js, and canary evidence
//     is only ever *carried through* to EconomicVerifier/CanaryRollbackController, never re-derived.
//
// Fail-closed contract: `issue()` NEVER throws and NEVER fabricates a passing certificate. Any
// missing evidence, low-confidence estimate, self-certification attempt, or internal error returns
// `null` (no certificate issued at all) -- the caller (orchestrator) then proceeds with no
// certificate attached, and the existing live EconomicVerifier blocks the merge exactly as it does
// today for any C3+ candidate with no valid certificate. This module adds no new way to pass.

import { EconomicImpactCertificate } from './economic-impact-certificate.js';
import { MergeRiskClassifier } from './merge-risk-classifier.js';
import { recurringCostAmplification, projectCompositionEconomics } from './recurring-cost-amplifier.js';
import { digest } from '../leverage/solution-cas.js';
import { pricingTable as defaultPricingTable, modelRateFor } from './pricing-table.js';

const SHA40 = /^[0-9a-f]{40}$/i;
const RANK = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'];
const rank = (cls) => RANK.indexOf(cls);

/** Default identity used for the issuer when the caller does not supply one explicitly. Kept
 * distinct from any implementer/producer or functional-verifier id by convention -- see the
 * independence check in #issue below, which enforces this is never merely a convention. */
export const DEFAULT_ISSUER_ID = 'economic-certificate-issuer';

function gbFromBytes(bytes) { return Number(bytes ?? 0) / (1024 ** 3); }

/**
 * Prices one execution's raw resource-usage evidence into a USD cost-per-execution figure, using
 * only the local, versioned pricing table (no network calls, no hosted pricing/observability
 * service of any kind).
 */
export function costPerExecutionUsd(evidence = {}, pricing = defaultPricingTable) {
  const usage = evidence.modelUsage ?? {};
  const rate = modelRateFor(pricing, usage.model);
  const modelCostUsd = Number(usage.inputTokens ?? 0) * rate.inputPerTokenUsd + Number(usage.outputTokens ?? 0) * rate.outputPerTokenUsd;
  const computeCostUsd = Number(evidence.computeMs ?? 0) * pricing.computeMsUsd;
  const ciCostUsd = Number(evidence.ciBuildMinutes ?? 0) * pricing.ciBuildMinuteUsd;
  const dbCostUsd = Number(evidence.dbReads ?? 0) * pricing.dbReadUsd
    + Number(evidence.dbWrites ?? 0) * pricing.dbWriteUsd
    + Number(evidence.dbScans ?? 0) * pricing.dbScanUsd;
  const storageCostUsd = gbFromBytes(evidence.storageGrowthBytes) * pricing.storageGbMonthUsd;
  const egressCostUsd = gbFromBytes(evidence.egressBytes) * pricing.egressGbUsd;
  const loggingCostUsd = gbFromBytes(evidence.loggingVolumeBytes) * pricing.loggingGbUsd;
  const apiCostUsd = Number(evidence.externalApiCalls ?? 0) * pricing.externalApiCallUsd;
  return modelCostUsd + computeCostUsd + ciCostUsd + dbCostUsd + storageCostUsd + egressCostUsd + loggingCostUsd + apiCostUsd;
}

/**
 * Derives executions-per-month from whatever recurrence evidence is present: an explicit
 * scheduled-job frequency takes priority, otherwise a polling cadence (per minute) is projected
 * across a month, otherwise the surface is treated as one-off (1 execution/month).
 */
export function executionsPerMonth(evidence = {}, pricing = defaultPricingTable) {
  if (Number(evidence.scheduledJobFrequencyPerMonth) > 0) return Number(evidence.scheduledJobFrequencyPerMonth);
  if (Number(evidence.pollingCadencePerMinute) > 0) return Number(evidence.pollingCadencePerMinute) * pricing.minutesPerMonth;
  return Math.max(1, Number(evidence.executionsPerMonth ?? 1));
}

/**
 * One recurring-cost-amplification row for a single evidence surface, using the explicit,
 * mandated formula: monthly_cost = cost_per_execution x executions_per_month x fanout x
 * retry_multiplier. Delegates the actual multiplication to recurring-cost-amplifier.js (#68/#78)
 * rather than re-deriving it.
 */
export function amplifySurface(evidence = {}, pricing = defaultPricingTable) {
  return recurringCostAmplification({
    perInvocationCostUsd: costPerExecutionUsd(evidence, pricing),
    frequencyPerMonth: executionsPerMonth(evidence, pricing),
    fanOut: Number(evidence.fanOut ?? evidence.workerFanOut ?? 1),
    retryMultiplier: Number(evidence.retryMultiplier ?? 1)
  });
}

// Measurement fields that simply sum across surfaces; fanOut/retryMultiplier take the max instead
// (a single hot surface's amplification governs), and modelTokenSpendUsd is priced, not summed raw.
const SUMMED_MEASUREMENT_FIELDS = [
  'computeMs', 'dbReads', 'dbWrites', 'dbScans', 'storageGrowthBytes', 'egressBytes',
  'ciBuildMinutes', 'externalApiCalls', 'loggingVolumeBytes', 'scheduledJobFrequencyPerMonth', 'pollingCadencePerMinute'
];

function aggregateMeasurements(surfaces = []) {
  const totals = Object.fromEntries(SUMMED_MEASUREMENT_FIELDS.map((key) => [key, 0]));
  totals.modelTokenSpendUsd = 0;
  totals.workerFanOut = 0;
  totals.retryMultiplier = 1;
  for (const surface of surfaces) {
    for (const key of SUMMED_MEASUREMENT_FIELDS) totals[key] += Number(surface[key] ?? 0);
    totals.workerFanOut = Math.max(totals.workerFanOut, Number(surface.fanOut ?? surface.workerFanOut ?? 1));
    totals.retryMultiplier = Math.max(totals.retryMultiplier, Number(surface.retryMultiplier ?? 1));
    totals.modelTokenSpendUsd += Number(surface.modelUsage?.inputTokens ?? 0) > 0 || Number(surface.modelUsage?.outputTokens ?? 0) > 0
      ? costPerExecutionUsd({ modelUsage: surface.modelUsage }, defaultPricingTable) : 0;
  }
  return totals;
}

/**
 * Collects and issues source-bound EconomicImpactCertificates for real, SHA-addressed merge
 * candidates. Estimation/issuance authority only -- see the module header for the authority
 * boundary against EconomicVerifier, CanaryRollbackController and the orchestrator's merge
 * authority.
 */
export class EconomicCertificateIssuer {
  constructor({ policyVersion, issuerId = DEFAULT_ISSUER_ID, pricing = defaultPricingTable, minConfidence = 0.3, riskClassifier = new MergeRiskClassifier() } = {}) {
    if (!policyVersion) throw new Error('EconomicCertificateIssuer requires policyVersion');
    if (!issuerId) throw new Error('EconomicCertificateIssuer requires issuerId');
    this.policyVersion = String(policyVersion);
    this.issuerId = String(issuerId);
    this.pricing = pricing;
    this.minConfidence = Number(minConfidence);
    this.riskClassifier = riskClassifier;
  }

  /**
   * Collects evidence for `task`/`evidence` and issues a certificate bound to the exact
   * source/candidate SHA and this issuer's policy version, or returns `null` (fail closed) when
   * evidence is missing/insufficient, the SHAs aren't real, confidence is below policy, or this
   * issuer identity would collide with the implementer/functional-verifier identity. Never throws.
   *
   * @returns {null | { certificate: object, classification: {class:string, reasons:string[]}, issuerId: string, evidenceDigest: string }}
   */
  issue({ task, evidence, claim, riskClassification = null, now = Date.now() } = {}) {
    try {
      return this.#issue({ task, evidence, claim, riskClassification, now });
    } catch {
      // Any internal failure -- malformed evidence, unexpected shape, arithmetic error -- must
      // never surface as (or be mistaken for) a fabricated pass. No certificate, full stop.
      return null;
    }
  }

  #issue({ task, evidence, claim, riskClassification, now }) {
    const sourceSha = String(task?.metadata?.execution?.ref ?? '').toLowerCase();
    const candidateSha = String(evidence?.artifacts?.commitSha ?? '').toLowerCase();
    if (!SHA40.test(sourceSha) || !SHA40.test(candidateSha)) return null;
    if (sourceSha === candidateSha) return null; // no real candidate diff to certify

    const implementerId = evidence?.producerId ?? claim?.ownerId ?? null;
    const functionalVerifierId = evidence?.verifierId ?? null;
    // Independence: the executor/implementer or the functional verifier can never also be the
    // economic-certificate issuer -- mirrors EconomicVerifier's own self-certification guard.
    if (this.issuerId === implementerId || this.issuerId === functionalVerifierId) return null;

    const economics = task?.metadata?.economics ?? {};

    const classification = riskClassification ?? this.riskClassifier.classify({
      changedPaths: economics.changedPaths ?? [],
      diffText: String(evidence?.artifacts?.diff ?? ''),
      touchesScheduledWork: Boolean(economics.touchesScheduledWork),
      touchesRetryLogic: Boolean(economics.touchesRetryLogic),
      touchesFanOut: Boolean(economics.touchesFanOut),
      touchesExternalApi: Boolean(economics.touchesExternalApi),
      touchesPaymentOrBilling: Boolean(economics.touchesPaymentOrBilling),
      touchesMigration: Boolean(economics.touchesMigration),
      docsOnly: Boolean(economics.docsOnly),
      compositionParticipants: Number(economics.compositionParticipants ?? 1)
    });

    // C0-C2: low overhead -- certificate generation is a no-op unless policy/evidence explicitly
    // asked for one, matching the C0-C2 no-op path EconomicVerifier already treats as certificate-
    // not-required.
    if (!this.riskClassifier.requiresEconomicCertificate(classification.class) && !economics.forceCertificate) {
      return null;
    }

    const evidenceInput = economics.evidence ?? null;
    if (!evidenceInput) return null; // missing evidence -> no certificate -> verifier blocks

    const surfaces = Array.isArray(evidenceInput.shards) && evidenceInput.shards.length
      ? evidenceInput.shards
      : [evidenceInput];
    if (!surfaces.length) return null;

    const shardProjections = surfaces.map((surface) => {
      const amplification = amplifySurface(surface, this.pricing);
      return { id: surface.id ?? null, totalMonthlyDelta: amplification.estimatedMonthlyDelta, escalate: amplification.estimatedMonthlyDelta >= 25, ...amplification };
    });
    const composition = projectCompositionEconomics(shardProjections, { sharedSurfaceMultiplier: Number(evidenceInput.sharedSurfaceMultiplier ?? 1) });
    const estimatedMonthlyDeltaUsd = composition.compositionMonthlyDelta;

    const provenance = ['estimated', 'measured', 'benchmarked'].includes(evidenceInput.provenance) ? evidenceInput.provenance : 'estimated';
    const confidence = Number.isFinite(evidenceInput.confidence) ? Math.min(1, Math.max(0, Number(evidenceInput.confidence))) : 0.5;
    if (confidence < this.minConfidence) return null; // policy requires higher confidence -> block

    const measurements = aggregateMeasurements(surfaces);

    const evidenceRecord = {
      sourceSha, candidateSha, policyVersion: this.policyVersion, riskClass: classification.class,
      pricingTableVersion: this.pricing.version, surfaces, composition, shardProjections,
      issuerId: this.issuerId, implementerId, functionalVerifierId
    };
    const evidenceDigest = digest(evidenceRecord);

    const certificate = EconomicImpactCertificate.issue({
      sourceSha,
      candidateSha,
      policyVersion: this.policyVersion,
      riskClass: classification.class,
      measurements,
      estimatedMonthlyDeltaUsd,
      provenance,
      confidence,
      recurringAmplification: { shardProjections, composition, pricingTableVersion: this.pricing.version, evidenceDigest },
      now
    });

    return { certificate, classification, issuerId: this.issuerId, evidenceDigest };
  }
}
