// Frontier-model task packaging (issue #72).
//
// Frontier reasoning is the most expensive, least portable tier on the escalation ladder.
// Work handed to it must be packaged so that: (a) the model receives only the minimal
// sufficient context to do the job, not the whole repository; (b) the expected evidence for
// acceptance is explicit up front, so verification doesn't become open-ended; (c) the shard
// is bounded to a budget so a single task can't silently consume unbounded horizon/cost; and
// (d) the mutation scope is explicit, so a frontier response can't touch files/systems outside
// what was authorized. This keeps any single frontier provider from becoming an architectural
// authority: the package is provider-agnostic and portable to any model that accepts the same
// Engineering IR shape.

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${field} is required`);
  return value;
}

function requireArray(value, field) {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value;
}

// Builds a frontier task package (an "Engineering IR" envelope) from a task and the minimal
// context needed to complete it. Throws if the request is missing anything that would force
// the frontier model to guess at scope, evidence, or budget.
export function packageFrontierTask({
  taskKey,
  objective,
  cognitionClass,
  minimalContext = [],
  evidenceRequirements = [],
  mutationScope = [],
  shardBudget,
  horizonBudgetMs,
  costJustification
} = {}) {
  requireNonEmptyString(taskKey, 'taskKey');
  requireNonEmptyString(objective, 'objective');
  requireNonEmptyString(cognitionClass, 'cognitionClass');
  requireNonEmptyString(costJustification, 'costJustification');
  requireArray(minimalContext, 'minimalContext');
  requireArray(evidenceRequirements, 'evidenceRequirements');
  requireArray(mutationScope, 'mutationScope');
  if (evidenceRequirements.length === 0) throw new Error('evidenceRequirements must be non-empty: frontier work must declare how acceptance will be verified');
  if (mutationScope.length === 0) throw new Error('mutationScope must be non-empty: frontier work must declare exactly what it may change');
  const shard = Number(shardBudget);
  if (!Number.isFinite(shard) || shard <= 0) throw new Error('shardBudget must be a positive number (max files/units the shard may touch)');
  const horizon = Number(horizonBudgetMs);
  if (!Number.isFinite(horizon) || horizon <= 0) throw new Error('horizonBudgetMs must be a positive number');

  for (const entry of minimalContext) {
    if (!entry?.path) throw new Error('minimalContext entries require a path');
  }

  return {
    version: 1,
    taskKey,
    objective,
    cognitionClass,
    minimalContext: minimalContext.map((entry) => ({ path: entry.path, reason: entry.reason ?? null })),
    evidenceRequirements: [...evidenceRequirements],
    mutationScope: [...mutationScope],
    shardBudget: shard,
    horizonBudgetMs: horizon,
    costJustification
  };
}

// Estimates whether the accepted-value gain of routing this work to a frontier model justifies
// its cost, given prior attempts at cheaper tiers. This is a deliberately conservative,
// deterministic heuristic (not itself a model call) so it can gate routing decisions cheaply:
// escalation is justified once cheaper tiers have been tried and failed, or the task is
// declared high-novelty/architectural by the caller with a stated reason.
export function estimateFrontierJustification({
  lowerTierAttempts = 0,
  lowerTierFailures = 0,
  highNoveltyReason = null,
  estimatedFrontierCostUnits = 0,
  estimatedAcceptedValueUnits = 0
} = {}) {
  const triedAndFailed = Number(lowerTierAttempts) > 0 && Number(lowerTierFailures) >= Number(lowerTierAttempts);
  const declaredNovel = Boolean(highNoveltyReason);
  const valuePositive = Number(estimatedAcceptedValueUnits) > Number(estimatedFrontierCostUnits);
  const justified = (triedAndFailed || declaredNovel) && valuePositive;
  return {
    justified,
    reason: !valuePositive
      ? 'expected-accepted-value-does-not-exceed-cost'
      : triedAndFailed
        ? 'lower-tier-attempts-exhausted'
        : declaredNovel
          ? 'declared-high-novelty'
          : 'no-escalation-basis',
    triedAndFailed,
    declaredNovel,
    valuePositive
  };
}

// Given an accepted frontier package + its accepted solution, produces the minimal record
// needed to harvest it into a reusable transform/skill/cache entry (issue #72 acceptance
// criterion: "accepted frontier solutions can be harvested into reusable transforms").
// The caller is expected to persist this via the existing transform-registry / artifact-cache
// infrastructure; this function only normalizes the shape.
export function harvestableFromAcceptedPackage(pkg, { solutionDigest, acceptedAt = Date.now() } = {}) {
  requireNonEmptyString(solutionDigest, 'solutionDigest');
  return {
    sourceTaskKey: pkg.taskKey,
    cognitionClass: pkg.cognitionClass,
    mutationScope: [...pkg.mutationScope],
    evidenceRequirements: [...pkg.evidenceRequirements],
    solutionDigest,
    acceptedAt
  };
}
