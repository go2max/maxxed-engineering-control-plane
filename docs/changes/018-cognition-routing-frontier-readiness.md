# PR 018 — Cognition routing and frontier-model readiness

Closes #72.

## Problem

The execution router treated "local" and "external" as the only meaningful axis, and picked
the cheapest local-first candidate with no notion of what *kind of thinking* a task needed.
That is fine for routine coding, but it gives frontier-tier reasoning no principled path into
the system and no guardrail against routing mechanical work to it once external escalation is
turned on.

## What changed

- `src/models/cognition-classes.js` — defines the ten cognition classes from the issue (exact
  reuse, deterministic transform, retrieval/search, solver, cheap classification, routine
  coding, specialist reasoning, frontier reasoning, formal/proof engine, physical/device
  validation) and an eight-rung escalation ladder (reuse → deterministic → cheap model →
  strong model → frontier → decomposition → specialist → human exception).
- `src/models/model-registry.js` — models now carry a `tier` (defaults to `cheap-model` for
  local models, `strong-model` for external ones; never defaults into `frontier`, since that
  changes routing gates).
- `src/models/model-router.js` — `route()` accepts `cognitionClass` and/or `forceMinTier` to
  seed the minimum escalation tier a request will consider, and refuses to select any
  `frontier`-tier (or higher) candidate unless the request demonstrates cost justification
  (`lowerTierAttempts > 0`, an explicit `costJustification`, or an explicit `forceMinTier` at
  or above frontier). Existing local-first, evals-ranked, cheapest-correct behavior is
  unchanged for requests that don't opt into tiered escalation.
- `src/models/frontier-task-packaging.js` — `packageFrontierTask()` builds the Engineering IR
  envelope the issue calls for: minimal sufficient context (explicit file list + reason, not
  "the repo"), evidence requirements, mutation scope, and shard/horizon budgets, and refuses to
  build a package missing any of them. `estimateFrontierJustification()` is a deterministic,
  zero-cost heuristic (no model call) for gating escalation on expected accepted-value vs. cost.
  `harvestableFromAcceptedPackage()` normalizes an accepted frontier solution into the shape
  needed to feed the existing `transform-registry` / `artifact-cache` reuse pipeline, so
  accepted frontier work stops being a one-off cost every time it recurs.

## What was deliberately deferred

- **Wiring a real frontier provider adapter.** This PR makes the router and packaging format
  provider-agnostic and ready; it does not add a specific frontier vendor client. That keeps
  provider portability intact (no single frontier provider becomes architectural authority, per
  the issue's explicit requirement) and is a separate, reviewable integration decision.
- **Counterfactual replay tooling** to mine `execution-replay.js` / eval history for reasoning
  that could be replaced by deterministic infrastructure. The harvesting hook
  (`harvestableFromAcceptedPackage`) is in place so that data starts accumulating, but the
  offline mining job itself is out of scope for this PR given the launch deadline.
- **Automatic benchmark of shard-size vs. decomposition overhead** for stronger models. The
  shard/horizon budget fields exist in the packaging contract so this can be measured once
  frontier traffic exists; the benchmark itself needs real usage data to be meaningful.

These are natural follow-ups once a frontier provider is actually wired in; building them now
would be speculative given there is no frontier traffic yet to measure against.
