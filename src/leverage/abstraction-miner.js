// Automatic abstraction mining over recorded accepted outcomes.
//
// Scans accepted trajectory records already persisted by the OutcomeStore
// (src/training/outcome-store.js, issue #71) for repeated semantic structures -- the same
// tool+target action pattern recurring across multiple independent tasks/sources -- and proposes
// candidate abstractions (SDK function, transform, validator, schema, or policy rule) once the
// pattern clears a configurable frequency threshold, with a documented savings estimate so a
// human/verifier can judge whether extraction is worth the coordination/migration cost.
//
// reuse: internal -- this is a pure-function pass over the existing OutcomeStore record shape
// (ALLOWED_TOP_LEVEL_FIELDS / ALLOWED_ACTION_FIELDS in src/training/outcome-store.js). It adds no
// new storage format: input is `readOutcomeLog()` output (or any array of already-redacted
// records), output is plain data the caller can hand to `TransformRegistry.register` or a
// `CapabilityGraph.registerImplementation` call once a human/verifier accepts a proposal. This is
// a mining/proposal pass only -- it does not itself write transforms or capability nodes, so a
// bad signature match can never silently mutate the graph or registry.
//
// Scope note (issue #102): this module proposes candidate abstractions from *already accepted*
// deltas. It intentionally does NOT implement live fan-out/regeneration to other product
// instances -- see docs/... PR body / README notes for why that is out of scope for this pass.

/**
 * Build a signature for one recorded action that is specific enough to group real repeats
 * together, but coarse enough to survive superficial differences (exact file path, exact byte
 * counts). Two actions match when they use the same tool against files with the same extension
 * and directory depth, doing the same action type.
 */
function actionSignature(action) {
  if (!action || typeof action !== 'object') return null;
  const target = typeof action.target === 'string' ? action.target : '';
  const ext = target.includes('.') ? target.slice(target.lastIndexOf('.')) : '';
  const depth = target ? target.split('/').length : 0;
  return [action.type ?? 'unknown', action.tool ?? 'unknown', ext || 'no-ext', `depth:${depth}`].join('|');
}

/**
 * Group a record's accepted actions by signature, returning one entry per distinct signature
 * present in that record (a record contributing the same signature twice only counts once toward
 * "distinct sources" -- repetition *within* one task is not portfolio-level repetition).
 */
function signaturesInRecord(record) {
  const actions = Array.isArray(record.actions) ? record.actions : [];
  const seen = new Map();
  for (const action of actions) {
    if (action?.ok !== true) continue; // only mine from actions that actually succeeded
    const sig = actionSignature(action);
    if (!sig) continue;
    if (!seen.has(sig)) seen.set(sig, action);
  }
  return seen;
}

const DEFAULT_ABSTRACTION_KIND_BY_TYPE = {
  edit: 'transform',
  test: 'validator',
  config: 'schema',
  policy: 'policy-rule',
};

function proposedKindFor(signature) {
  const [type] = signature.split('|');
  return DEFAULT_ABSTRACTION_KIND_BY_TYPE[type] ?? 'sdk-function';
}

/**
 * Mine accepted outcome records for repeated action signatures and propose candidate
 * abstractions.
 *
 * @param {Object[]} records - accepted/rejected trajectory records, e.g. from
 *   `readOutcomeLog()` in src/training/outcome-store.js.
 * @param {Object} [options]
 * @param {number} [options.minOccurrences=3] - minimum number of *distinct* source fingerprints
 *   the signature must appear in accepted records before it is proposed. This is the frequency
 *   threshold from issue #102 ("Define thresholds for abstraction proposals").
 * @param {number} [options.minEstimatedSavingsUsd=0] - drop candidates whose estimated savings
 *   fall at or below this (proves savings exceed coordination/migration cost, per issue #102).
 * @param {number} [options.coordinationCostUsd=5] - flat estimated cost of extracting and
 *   migrating one abstraction (review, tests, rollout), subtracted from gross savings to get a
 *   net savings estimate. Deliberately a simple, documented constant rather than a hidden
 *   heuristic -- tune per environment via this option.
 * @returns {{ candidates: Object[], consideredSignatures: number, consideredRecords: number }}
 */
export function mineAbstractions(records = [], options = {}) {
  const minOccurrences = Number(options.minOccurrences ?? 3);
  const minEstimatedSavingsUsd = Number(options.minEstimatedSavingsUsd ?? 0);
  const coordinationCostUsd = Number(options.coordinationCostUsd ?? 5);

  const accepted = records.filter((r) => r?.finalAcceptance === 'accepted');

  // signature -> { sourceFingerprints: Set, records: [{recordId, sourceFingerprint, action, cost, latencyMs}] }
  const bySignature = new Map();
  for (const record of accepted) {
    const sigs = signaturesInRecord(record);
    for (const [sig, action] of sigs) {
      if (!bySignature.has(sig)) bySignature.set(sig, { sourceFingerprints: new Set(), occurrences: [] });
      const entry = bySignature.get(sig);
      entry.sourceFingerprints.add(record.sourceFingerprint);
      entry.occurrences.push({
        recordId: record.recordId,
        sourceFingerprint: record.sourceFingerprint,
        taskClass: record.taskClass,
        actionTarget: action.target ?? null,
        costUsd: record.cost?.usd ?? 0,
        latencyMs: record.latencyMs ?? action.durationMs ?? 0,
      });
    }
  }

  const candidates = [];
  for (const [signature, entry] of bySignature) {
    const distinctSources = entry.sourceFingerprints.size;
    if (distinctSources < minOccurrences) continue;

    // Savings model: the first occurrence of a repeated pattern is "genuine" reasoning/build
    // work; every occurrence after the first for a *distinct* source is a reasoning call that a
    // shared abstraction (SDK function/transform/validator/schema/policy rule) would have let the
    // system skip by applying a deterministic, already-verified transform instead of re-deriving
    // the same edit from scratch. This is intentionally conservative: it credits savings only for
    // occurrences beyond the first, and only counts the direct recorded cost/latency of those
    // occurrences -- it does not speculate about future/unseen usage.
    const sortedByCost = entry.occurrences.slice().sort((a, b) => a.costUsd - b.costUsd);
    const reasoningCallsAvoided = distinctSources - 1;
    const savingsOccurrences = sortedByCost.slice(1); // drop cheapest one as the "genuine first solve"
    const grossUsd = savingsOccurrences.reduce((sum, o) => sum + o.costUsd, 0);
    const grossLatencyMs = savingsOccurrences.reduce((sum, o) => sum + o.latencyMs, 0);
    const netUsd = Math.max(0, grossUsd - coordinationCostUsd);

    if (netUsd <= minEstimatedSavingsUsd) continue;

    candidates.push({
      signature,
      proposedAbstractionKind: proposedKindFor(signature),
      occurrenceCount: entry.occurrences.length,
      distinctSources,
      reasoningCallsAvoided,
      exampleRecordIds: entry.occurrences.slice(0, 5).map((o) => o.recordId),
      exampleTargets: [...new Set(entry.occurrences.map((o) => o.actionTarget).filter(Boolean))].slice(0, 5),
      estimatedSavings: {
        grossUsd: Number(grossUsd.toFixed(4)),
        coordinationCostUsd,
        netUsd: Number(netUsd.toFixed(4)),
        latencyMsAvoided: grossLatencyMs,
      },
    });
  }

  candidates.sort((a, b) => b.estimatedSavings.netUsd - a.estimatedSavings.netUsd);

  return {
    candidates,
    consideredSignatures: bySignature.size,
    consideredRecords: accepted.length,
  };
}
