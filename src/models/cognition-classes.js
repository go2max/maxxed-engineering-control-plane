// Cognition classes describe *what kind of thinking* a unit of work needs, independent of
// which model or tool ultimately performs it. The escalation ladder orders classes from
// cheapest/most-deterministic to most-expensive/least-deterministic so the router can prefer
// the cheapest tier that is expected to satisfy acceptance criteria before escalating.
//
// Per issue #72: frontier reasoning is a scarce, expensive resource. It should only receive
// work whose expected accepted-value gain justifies its cost; everything mechanical or
// provable should be routed to deterministic tools, solvers, caches, transforms, or cheaper
// models first.
export const CognitionClass = Object.freeze({
  EXACT_REUSE: 'exact-reuse',
  DETERMINISTIC_TRANSFORM: 'deterministic-transform',
  RETRIEVAL_SEARCH: 'retrieval-search',
  SOLVER: 'solver',
  CHEAP_CLASSIFICATION: 'cheap-classification',
  ROUTINE_CODING: 'routine-coding',
  SPECIALIST_REASONING: 'specialist-reasoning',
  FRONTIER_REASONING: 'frontier-reasoning',
  FORMAL_PROOF: 'formal-proof',
  PHYSICAL_VALIDATION: 'physical-validation'
});

// Escalation tiers. Lower `rank` is cheaper/preferred; the router walks tiers in order and
// only advances to the next tier when the current one has no eligible, healthy candidate or
// has been explicitly marked as insufficient for the task at hand (e.g. by the caller
// requesting a minimum tier, or by prior attempts failing verification).
export const EscalationTier = Object.freeze({
  REUSE: 'reuse',
  DETERMINISTIC: 'deterministic',
  CHEAP_MODEL: 'cheap-model',
  STRONG_MODEL: 'strong-model',
  FRONTIER: 'frontier',
  DECOMPOSITION: 'decomposition',
  SPECIALIST: 'specialist',
  HUMAN_EXCEPTION: 'human-exception'
});

// Ordered ladder (index = escalation order). Each rung names the cognition classes it is
// naturally suited for, so a request can be seeded with a starting rung by task class.
export const ESCALATION_LADDER = Object.freeze([
  { tier: EscalationTier.REUSE, cognitionClasses: [CognitionClass.EXACT_REUSE] },
  { tier: EscalationTier.DETERMINISTIC, cognitionClasses: [CognitionClass.DETERMINISTIC_TRANSFORM, CognitionClass.RETRIEVAL_SEARCH, CognitionClass.SOLVER] },
  { tier: EscalationTier.CHEAP_MODEL, cognitionClasses: [CognitionClass.CHEAP_CLASSIFICATION, CognitionClass.ROUTINE_CODING] },
  { tier: EscalationTier.STRONG_MODEL, cognitionClasses: [CognitionClass.ROUTINE_CODING, CognitionClass.SPECIALIST_REASONING] },
  { tier: EscalationTier.FRONTIER, cognitionClasses: [CognitionClass.FRONTIER_REASONING] },
  { tier: EscalationTier.DECOMPOSITION, cognitionClasses: [CognitionClass.FRONTIER_REASONING, CognitionClass.SPECIALIST_REASONING] },
  { tier: EscalationTier.SPECIALIST, cognitionClasses: [CognitionClass.FORMAL_PROOF, CognitionClass.PHYSICAL_VALIDATION] },
  { tier: EscalationTier.HUMAN_EXCEPTION, cognitionClasses: [] }
]);

const TIER_RANK = new Map(ESCALATION_LADDER.map((rung, index) => [rung.tier, index]));

export function tierRank(tier) {
  const rank = TIER_RANK.get(tier);
  if (rank == null) throw new Error(`unknown escalation tier: ${tier}`);
  return rank;
}

export function nextTier(tier) {
  const rank = tierRank(tier);
  return ESCALATION_LADDER[rank + 1]?.tier ?? null;
}

export function isValidCognitionClass(value) {
  return Object.values(CognitionClass).includes(value);
}

export function isValidTier(value) {
  return TIER_RANK.has(value);
}

// Default starting tier for a given cognition class: the cheapest rung on the ladder that
// lists this cognition class. Callers may still start higher (e.g. a task already known to
// require frontier reasoning) but should never start lower than this without deterministic
// or cached evidence of exact reuse.
export function defaultTierForCognitionClass(cognitionClass) {
  const rung = ESCALATION_LADDER.find((entry) => entry.cognitionClasses.includes(cognitionClass));
  return rung?.tier ?? EscalationTier.STRONG_MODEL;
}

// Live-dispatch inference (issue #72): given the shape of a real coding/repair task, decide
// which cognition class it needs so ModelRouter.route() can apply tiered escalation and
// cost-justification gating instead of every task defaulting to the same cheap tier.
// Deliberately conservative: only riskClass and repeated-repair-failure evidence move a task
// off the cheapest routine-coding class, since silence is never justification for frontier.
export function inferCognitionClassForCodingTask({ riskClass = 'normal', repairAttempt = 0 } = {}) {
  const attempts = Number(repairAttempt ?? 0);
  if (riskClass === 'critical' || attempts >= 4) return CognitionClass.FRONTIER_REASONING;
  if (riskClass === 'high' || attempts >= 2) return CognitionClass.SPECIALIST_REASONING;
  return CognitionClass.ROUTINE_CODING;
}
