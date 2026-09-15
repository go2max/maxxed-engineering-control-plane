export const MergeRiskClass = Object.freeze({
  C0: 'C0', // no behavioral/cost surface (docs, comments, formatting)
  C1: 'C1', // low: isolated logic change, no recurring-cost surface
  C2: 'C2', // moderate: touches a cost-relevant surface but bounded/one-time
  C3: 'C3', // elevated: recurring-cost surface (scheduled job, hot path, retry logic)
  C4: 'C4', // high: fan-out/amplification surface, cross-shard economic interaction
  C5: 'C5'  // critical: payment/billing, external spend, or migration-scale cost surface
});

const ORDER = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'];

function rank(cls) { return ORDER.indexOf(cls); }
function max(a, b) { return rank(a) >= rank(b) ? a : b; }

const COST_SURFACE_HINTS = [
  { pattern: /cron|schedule|scheduledJob|setInterval/i, cls: MergeRiskClass.C3, reason: 'scheduled-job-surface' },
  { pattern: /retry|backoff/i, cls: MergeRiskClass.C3, reason: 'retry-surface' },
  { pattern: /fan[-_]?out|worker.*pool|parallel/i, cls: MergeRiskClass.C4, reason: 'fan-out-surface' },
  { pattern: /payment|billing|charge|invoice/i, cls: MergeRiskClass.C5, reason: 'payment-surface' },
  { pattern: /migration|backfill/i, cls: MergeRiskClass.C5, reason: 'migration-surface' },
  { pattern: /\b(query|scan|SELECT|db\.|database)\b/i, cls: MergeRiskClass.C2, reason: 'database-surface' },
  { pattern: /model\.|tokens?|llm|openai|anthropic|inference/i, cls: MergeRiskClass.C3, reason: 'model-spend-surface' },
  { pattern: /poll|polling/i, cls: MergeRiskClass.C3, reason: 'polling-surface' }
];

// Explicit caller-supplied flags, same escalate-and-record shape as COST_SURFACE_HINTS above.
const RISK_FLAG_HINTS = [
  { flag: 'touchesScheduledWork', cls: MergeRiskClass.C3, reason: 'flag:scheduled-work' },
  { flag: 'touchesRetryLogic', cls: MergeRiskClass.C3, reason: 'flag:retry-logic' },
  { flag: 'touchesFanOut', cls: MergeRiskClass.C4, reason: 'flag:fan-out' },
  { flag: 'touchesExternalApi', cls: MergeRiskClass.C3, reason: 'flag:external-api' },
  { flag: 'touchesPaymentOrBilling', cls: MergeRiskClass.C5, reason: 'flag:payment-or-billing' },
  { flag: 'touchesMigration', cls: MergeRiskClass.C5, reason: 'flag:migration' }
];

/**
 * Classifies merge-risk C0-C5 automatically from a semantic diff / Engineering IR summary.
 * Deliberately conservative: any ambiguity about whether a surface is cost-relevant escalates
 * the class rather than downgrading it, per the "fail closed" safety requirement.
 */
export class MergeRiskClassifier {
  classify({
    changedPaths = [],
    diffText = '',
    touchesScheduledWork = false,
    touchesRetryLogic = false,
    touchesFanOut = false,
    touchesExternalApi = false,
    touchesPaymentOrBilling = false,
    touchesMigration = false,
    docsOnly = false,
    compositionParticipants = 1
  } = {}) {
    if (docsOnly && !changedPaths.some((path) => !/\.(md|txt)$/i.test(path))) {
      return { class: MergeRiskClass.C0, reasons: ['docs-only'] };
    }

    let cls = MergeRiskClass.C1;
    const reasons = [];

    const haystack = `${diffText}\n${changedPaths.join('\n')}`;
    for (const hint of COST_SURFACE_HINTS) {
      if (hint.pattern.test(haystack)) { cls = max(cls, hint.cls); reasons.push(hint.reason); }
    }
    const flags = { touchesScheduledWork, touchesRetryLogic, touchesFanOut, touchesExternalApi, touchesPaymentOrBilling, touchesMigration };
    for (const hint of RISK_FLAG_HINTS) {
      if (flags[hint.flag]) { cls = max(cls, hint.cls); reasons.push(hint.reason); }
    }
    // Composition-level amplification: several individually cheap shards combining is itself an
    // escalation trigger even when no single shard crosses a threshold on its own.
    if (Number(compositionParticipants) >= 3 && rank(cls) < rank(MergeRiskClass.C3)) {
      cls = max(cls, MergeRiskClass.C3);
      reasons.push('composition-amplification');
    }

    return { class: cls, reasons: [...new Set(reasons)] };
  }

  requiresEconomicCertificate(cls) {
    return rank(cls) >= rank(MergeRiskClass.C3);
  }

  compare(a, b) { return rank(a) - rank(b); }
}
