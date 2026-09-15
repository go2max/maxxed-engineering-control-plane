// Live wiring glue between MergeRiskClassifier + EconomicVerifier (issue #68) and the real
// merge/acceptance path in src/core/orchestrator.js.
//
// This module deliberately does no I/O and no new authority: it derives classifier/verifier
// inputs from exactly the evidence an accepted task already carries (commit SHA, diff, base ref,
// producer/verifier identities), and returns null when a task is not a SHA-addressed merge at all
// (e.g. a plain scheduling/unit-test task with no commit), so the gate never fires outside real
// merges.
//
// Fail-closed contract (issue #68): a C3+ classification with no validly bound
// EconomicImpactCertificate must REJECT, never ACCEPT-by-default. That contract lives entirely in
// EconomicVerifier.verify; this module only wires real inputs into it.

const SHA40 = /^[0-9a-f]{40}$/i;

/** Default identity used for the independent economic-authority check when the task does not
 * supply one explicitly. Kept distinct from any worker/producer id by convention. */
export const DEFAULT_ECONOMIC_VERIFIER_ID = 'economic-verifier-authority';

/**
 * Best-effort extraction of the file paths a merge touches, from whatever evidence the execution
 * path already produced. Never throws; returns [] rather than guessing when nothing is available
 * -- an empty changedPaths list still lets the classifier fall back to its diffText/flag-based
 * heuristics, which are conservative (escalate on ambiguity) by design.
 */
export function extractChangedPaths(evidence = {}) {
  if (Array.isArray(evidence?.artifacts?.changedPaths)) return evidence.artifacts.changedPaths.map(String);
  const bundleWrites = evidence?.artifacts?.patchBundle?.writes;
  if (Array.isArray(bundleWrites) && bundleWrites.length) return bundleWrites.map((write) => String(write.path));
  const diff = String(evidence?.artifacts?.diff ?? '');
  const matches = [...diff.matchAll(/^diff --git a\/(\S+) b\/(\S+)/gm)];
  if (matches.length) return [...new Set(matches.map((match) => match[2]))];
  return [];
}

/**
 * Whether `task`/`evidence` represent a real, SHA-addressed merge candidate at all. Non-merge
 * tasks (no commit produced, no exact base ref) are out of scope for the economic gate entirely --
 * it never blocks work that isn't actually merging code.
 */
export function isMergeCandidate({ task, evidence } = {}) {
  const sourceSha = String(task?.metadata?.execution?.ref ?? '').toLowerCase();
  const candidateSha = String(evidence?.artifacts?.commitSha ?? '').toLowerCase();
  return SHA40.test(sourceSha) && SHA40.test(candidateSha);
}

/**
 * Classify a merge candidate's risk and run the independent economic verifier against it.
 * Returns null when the task is not a SHA-addressed merge (see isMergeCandidate) -- callers must
 * treat a null return as "gate does not apply", not as an implicit pass.
 *
 * @returns {null | { classification: {class:string, reasons:string[]}, verdict: object, sourceSha: string, candidateSha: string, economicVerifierId: string }}
 */
export function evaluateMergeEconomics({ task, claim, evidence, riskClassifier, economicVerifier } = {}) {
  if (!riskClassifier || !economicVerifier) return null;
  if (!isMergeCandidate({ task, evidence })) return null;

  const sourceSha = String(task.metadata.execution.ref).toLowerCase();
  const candidateSha = String(evidence.artifacts.commitSha).toLowerCase();
  const economics = task?.metadata?.economics ?? {};

  const classification = riskClassifier.classify({
    changedPaths: extractChangedPaths(evidence),
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

  const implementerId = evidence?.producerId ?? claim?.ownerId ?? null;
  const functionalVerifierId = evidence?.verifierId ?? null;
  const economicVerifierId = economics.economicVerifierId ?? DEFAULT_ECONOMIC_VERIFIER_ID;

  const verdict = economicVerifier.verify({
    sourceSha,
    candidateSha,
    riskClass: classification.class,
    certificate: economics.certificate ?? null,
    implementerId,
    functionalVerifierId,
    economicVerifierId,
    canary: economics.canary ?? null
  });

  return { classification, verdict, sourceSha, candidateSha, economicVerifierId };
}
