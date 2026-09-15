import { MergeRiskClass } from './merge-risk-classifier.js';
import { extractChangedPaths } from './merge-economic-gate.js';

// Purpose-vs-diff consistency (issue #104).
//
// This is deliberately a *different axis* from the two live classifiers it sits beside:
//   - MergeRiskClassifier (merge-risk-classifier.js) reads diff content/flags alone and asks
//     "how cost-dangerous is this surface", with no notion of what the task said it would do.
//   - SemanticConflictDetector (semantic-conflict-detector.js) compares shards *against each
//     other* (shared capability/contract/invariant), not against a declared intent at all.
// MutationSurpriseScorer compares what a task DECLARED it would touch (mutationScopes / stated
// capabilities-contracts-permissions-schema surfaces, already present in this repo's task
// metadata -- see src/core/orchestrator.js#scopesFor and src/verification/evidence-bundle.js)
// against what the evidence bundle shows it ACTUALLY touched. It reuses MergeRiskClassifier's
// existing risk-surface detection as one input signal rather than reimplementing pattern
// matching for scheduled/payment/migration/fan-out surfaces.
//
// Scope of this file (primitive wave only, per docs/MULTI_AGENT_ORCHESTRATION_PLAYBOOK.md):
//   - The scorer itself (pure function of declared scope + evidence, no I/O).
//   - `autoReclassifyOnSurprise`, a standalone hook function others can call to escalate a
//     classification in response to a high-surprise score.
// Deliberately NOT done here: wiring either of the above into the live orchestrator accept/
// reject path (src/core/orchestrator.js, src/economics/merge-economic-gate.js). That requires
// its own careful review pass because it changes real acceptance behavior -- see PR description.

export const SurpriseLevel = Object.freeze({
  BENIGN: 'BENIGN', // fully within or a reasonable expansion of declared scope
  MODERATE: 'MODERATE', // some undeclared surface touched, but low individual risk
  HIGH: 'HIGH', // undeclared surface touched that is itself a real cost/risk surface
  CRITICAL: 'CRITICAL' // undeclared touch to a highest-sensitivity dimension (security/auth/
  // schema/dependency/cost surface), or a diff-derived risk class escalation with zero
  // declared-scope coverage at all
});

const LEVEL_ORDER = ['BENIGN', 'MODERATE', 'HIGH', 'CRITICAL'];
function levelRank(level) { return LEVEL_ORDER.indexOf(level); }
function maxLevel(a, b) { return levelRank(a) >= levelRank(b) ? a : b; }

// Dimensions that, when touched but undeclared, are surprising regardless of file overlap --
// these mirror the issue's explicit list ("security/auth/schema/dependency/cost-surface").
const CRITICAL_UNDECLARED_DIMENSIONS = Object.freeze([
  'permissions', 'schema', 'security', 'auth', 'dependencies'
]);

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => String(entry ?? '').trim()).filter(Boolean))];
}

// A declared scope entry may be a bare path ('src/a'), a namespaced scope
// ('file:repo:src/a.js', 'repo:org/repo'), or a directory prefix. This strips known prefixes and
// treats the remainder as a path/prefix to match actual changed paths against.
function scopePathFragment(scope) {
  const stripped = scope.replace(/^(global:|repo:[^:]*:|file:[^:]*:|dir:[^:]*:)/, '');
  return stripped === scope && scope.includes(':') ? null : stripped;
}

function isRepoOrGlobalScope(scope) {
  return scope.startsWith('global:') || /^repo:[^:]+$/.test(scope);
}

/**
 * Whether `path` falls within at least one declared scope entry. A repo-wide or global scope
 * declaration covers everything (that is an explicitly broad declared intent, not a surprise);
 * a path/dir-shaped scope covers exact matches and anything nested under it as a prefix.
 */
function pathIsDeclared(path, declaredScopes) {
  for (const scope of declaredScopes) {
    if (isRepoOrGlobalScope(scope)) return true;
    const fragment = scopePathFragment(scope);
    if (fragment == null) continue;
    if (path === fragment || path.startsWith(`${fragment.replace(/\/$/, '')}/`)) return true;
  }
  return false;
}

/**
 * Compares a task's declared mutation scope/intent against the actual semantic mutation
 * captured by an evidence bundle, and produces a surprise score in [0, 1] plus a categorical
 * level and human-readable reasons.
 */
export class MutationSurpriseScorer {
  /**
   * @param {object} riskClassifier - a MergeRiskClassifier instance (or compatible: exposes
   *   `.classify(...)` returning `{ class, reasons }` and `.compare(a, b)`). Injected rather than
   *   constructed here so callers can share one instance across the accept path.
   */
  constructor(riskClassifier) {
    if (!riskClassifier || typeof riskClassifier.classify !== 'function') {
      throw new Error('MutationSurpriseScorer requires a MergeRiskClassifier-compatible riskClassifier');
    }
    this.riskClassifier = riskClassifier;
  }

  /**
   * @param {object} input
   * @param {string[]} [input.declaredScopes] - task.metadata.mutationScopes, or equivalent.
   * @param {string} [input.declaredObjective] - task.objective / stated intent, free text.
   * @param {object} [input.declaredSurfaces] - explicit declared-intent booleans, matching the
   *   flags MergeRiskClassifier already understands (touchesPaymentOrBilling, etc). A task that
   *   declares upfront it will touch a surface should not be scored as "surprised" by it.
   * @param {object} input.evidence - evidence-bundle-shaped evidence (evidence.artifacts.*), or
   *   an evidence object with the same `artifacts.changedPaths`/`artifacts.diff` shape used by
   *   merge-economic-gate.js's extractChangedPaths.
   * @param {object} [input.actualMutation] - optional explicit actual-mutation descriptor beyond
   *   file paths: { symbols, packages, contracts, permissions, schema, dependencies,
   *   runtimeBehavior }, each an array of string identifiers or booleans for schema/permissions/
   *   dependencies/runtimeBehavior. Not all evidence bundles carry this; anything omitted is
   *   simply not scored on that dimension (never assumed absent-and-safe for the file dimension,
   *   which is always derivable from the diff).
   * @returns {{ score: number, level: string, reasons: string[], undeclaredPaths: string[],
   *   undeclaredDimensions: string[], riskClassification: {class:string, reasons:string[]} }}
   */
  score({ declaredScopes = [], declaredObjective = '', declaredSurfaces = {}, evidence = {}, actualMutation = {} } = {}) {
    const scopes = normalizeList(declaredScopes);
    const changedPaths = extractChangedPaths(evidence);
    const diffText = String(evidence?.artifacts?.diff ?? '');

    // Reuse MergeRiskClassifier's existing risk-surface detection as an input signal, rather
    // than reimplementing scheduled/payment/migration/fan-out pattern matching here.
    const riskClassification = this.riskClassifier.classify({
      changedPaths,
      diffText,
      touchesScheduledWork: Boolean(actualMutation.touchesScheduledWork),
      touchesRetryLogic: Boolean(actualMutation.touchesRetryLogic),
      touchesFanOut: Boolean(actualMutation.touchesFanOut),
      touchesExternalApi: Boolean(actualMutation.touchesExternalApi),
      touchesPaymentOrBilling: Boolean(actualMutation.touchesPaymentOrBilling),
      touchesMigration: Boolean(actualMutation.touchesMigration),
      compositionParticipants: Number(actualMutation.compositionParticipants ?? 1)
    });

    const reasons = [];
    let level = SurpriseLevel.BENIGN;
    let scoreValue = 0;

    // --- Dimension 1: file-path scope creep ---
    // No declared scope at all with real changes present is itself ambiguous -- fail closed
    // (mirrors MergeRiskClassifier's own no-evidence contract) rather than silently scoring 0.
    const hasDeclaredScope = scopes.length > 0;
    const undeclaredPaths = hasDeclaredScope
      ? changedPaths.filter((path) => !pathIsDeclared(path, scopes))
      : [...changedPaths];

    if (!hasDeclaredScope && changedPaths.length > 0) {
      level = maxLevel(level, SurpriseLevel.HIGH);
      scoreValue = Math.max(scoreValue, 0.7);
      reasons.push('no-declared-scope-fail-closed');
    } else if (undeclaredPaths.length > 0) {
      const creepFraction = undeclaredPaths.length / Math.max(1, changedPaths.length);
      scoreValue = Math.max(scoreValue, creepFraction * 0.6);
      reasons.push(`scope-creep:${undeclaredPaths.length}/${changedPaths.length}-paths-undeclared`);
      level = maxLevel(level, creepFraction >= 0.5 ? SurpriseLevel.HIGH : SurpriseLevel.MODERATE);
    }

    // --- Dimension 2: declared vs actual named surfaces (symbols/packages/contracts/
    // permissions/schema/dependencies/runtime behavior) ---
    const undeclaredDimensions = [];
    const namedSurfaceDims = ['symbols', 'packages', 'contracts'];
    for (const dim of namedSurfaceDims) {
      const actualList = normalizeList(actualMutation[dim]);
      const declaredList = normalizeList(declaredSurfaces[dim]);
      const undeclared = actualList.filter((entry) => !declaredList.includes(entry));
      if (undeclared.length > 0) {
        undeclaredDimensions.push(dim);
        reasons.push(`undeclared-${dim}:${undeclared.join(',')}`);
        scoreValue = Math.max(scoreValue, 0.5);
        level = maxLevel(level, SurpriseLevel.MODERATE);
      }
    }

    // Boolean-shaped surfaces the issue calls out explicitly as always-critical-if-undeclared.
    for (const dim of CRITICAL_UNDECLARED_DIMENSIONS) {
      const actuallyTouched = Boolean(actualMutation[dim]) ||
        (Array.isArray(actualMutation[dim]) && actualMutation[dim].length > 0);
      const wasDeclared = Boolean(declaredSurfaces[dim]) ||
        (Array.isArray(declaredSurfaces[dim]) && declaredSurfaces[dim].length > 0);
      if (actuallyTouched && !wasDeclared) {
        undeclaredDimensions.push(dim);
        reasons.push(`undeclared-critical-surface:${dim}`);
        scoreValue = Math.max(scoreValue, 0.9);
        level = maxLevel(level, SurpriseLevel.CRITICAL);
      }
    }

    if (actualMutation.runtimeBehavior && !declaredSurfaces.runtimeBehavior) {
      undeclaredDimensions.push('runtimeBehavior');
      reasons.push('undeclared-runtime-behavior-change');
      scoreValue = Math.max(scoreValue, 0.6);
      level = maxLevel(level, SurpriseLevel.HIGH);
    }

    // --- Dimension 3: diff-derived risk surface with no matching declared intent ---
    // If MergeRiskClassifier independently found a real risk surface (C3+) purely from diff
    // content, and the task's declared surfaces/objective gave no hint it expected one, that is
    // itself a hidden-mutation surprise -- even if every changed path was individually declared
    // (e.g. a declared "src/jobs/" scope that turns out to newly wire in billing calls).
    const declaredAnyRiskyFlag = Object.values(declaredSurfaces).some((value) => value === true);
    const objectiveMentionsRiskyReason = riskClassification.reasons.some((reason) => {
      const keyword = reason.split(/[-:]/)[0];
      return keyword && declaredObjective.toLowerCase().includes(keyword);
    });
    if (this.riskClassifier.compare(riskClassification.class, MergeRiskClass.C3) >= 0 &&
      !declaredAnyRiskyFlag && !objectiveMentionsRiskyReason) {
      reasons.push(`undeclared-risk-surface:${riskClassification.class}(${riskClassification.reasons.join(',')})`);
      scoreValue = Math.max(scoreValue, riskClassification.class === MergeRiskClass.C5 ? 0.95 : 0.75);
      level = maxLevel(level, riskClassification.class === MergeRiskClass.C5 ? SurpriseLevel.CRITICAL : SurpriseLevel.HIGH);
    }

    return {
      score: Math.min(1, scoreValue),
      level,
      reasons: [...new Set(reasons)],
      undeclaredPaths,
      undeclaredDimensions: [...new Set(undeclaredDimensions)],
      riskClassification
    };
  }

  /** True for HIGH/CRITICAL, the two levels the issue says must be reclassify/escalate candidates. */
  isSurprising(result) {
    return levelRank(result.level) >= levelRank(SurpriseLevel.HIGH);
  }
}

/**
 * Standalone hook others can call in response to a high-surprise scoring result. Deliberately
 * NOT invoked from anywhere in the live accept/reject path in this PR (see file header) -- wiring
 * it into src/core/orchestrator.js / src/economics/merge-economic-gate.js is a follow-up that
 * needs its own review given it would affect real acceptance behavior.
 *
 * @param {object} input
 * @param {{score:number, level:string, reasons:string[]}} input.surpriseResult - from
 *   MutationSurpriseScorer#score.
 * @param {string} input.currentClass - the task/merge's current MergeRiskClass.
 * @param {object} [input.riskClassifier] - a MergeRiskClassifier-compatible instance, used only
 *   for its ordering via `.compare`/`.max`-equivalent; defaults to simple index comparison against
 *   the shared MergeRiskClass ordering when omitted.
 * @returns {{ shouldEscalate: boolean, escalatedClass: string, reason: string|null }}
 */
export function autoReclassifyOnSurprise({ surpriseResult, currentClass, riskClassifier } = {}) {
  if (!surpriseResult) return { shouldEscalate: false, escalatedClass: currentClass, reason: null };
  const isHighOrCritical = levelRank(surpriseResult.level) >= levelRank(SurpriseLevel.HIGH);
  if (!isHighOrCritical) return { shouldEscalate: false, escalatedClass: currentClass, reason: null };

  // A CRITICAL surprise forces C5 (the issue's "critical hidden mutation" acceptance scenario);
  // a HIGH surprise floors the class at C4 so it cannot slip through under the C3 economic-
  // certificate threshold without at least the fan-out/composition-level scrutiny C4 implies.
  const floor = surpriseResult.level === SurpriseLevel.CRITICAL ? MergeRiskClass.C5 : MergeRiskClass.C4;
  const compare = riskClassifier && typeof riskClassifier.compare === 'function'
    ? riskClassifier.compare.bind(riskClassifier)
    : (a, b) => ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'].indexOf(a) - ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'].indexOf(b);

  const escalatedClass = compare(currentClass, floor) >= 0 ? currentClass : floor;
  const escalated = escalatedClass !== currentClass;
  return {
    shouldEscalate: true,
    escalatedClass,
    reason: escalated
      ? `mutation-surprise:${surpriseResult.level}:${surpriseResult.reasons.join(',')}`
      : `mutation-surprise:${surpriseResult.level}:already-at-or-above-floor`
  };
}
