# Accepted-outcome learning store and promotion-gated self-improvement loop

Implements issue #71. Extends the existing training authority
(`src/training/promotion-gate.js`, `src/training/score-benchmark.js`) rather than creating a
second one.

`reuse: internal` — built on this repo's existing training/benchmark conventions
(`training/manifest.json` domains, the `DomainScores` shape, JSONL benchmark/eval files) and on
`evaluatePromotionGate` unchanged. No external framework was introduced; the promotion stage
machine is Maxxed-specific authority-boundary logic that has no equivalent elsewhere in the repo.

## Outcome store (`src/training/outcome-store.js`)

Every accepted or rejected shard trajectory is redacted down to an allow-listed shape before it
can be persisted:

- `taskClass`, `sourceFingerprint`, `executor` (id/model/kind), `shardSize`, `contextBundleId`
- `actions` (type/tool/target/result/ok/durationMs — explicit tool calls only)
- `verifierOutcomes`, `repairPath`, `cost`, `latencyMs`
- `finalAcceptance` (`accepted`/`rejected`), `rollbackOutcome`, `productionOutcome`
- `summary` (plain text only — no nested free-form objects)

Unknown fields are dropped silently (allow-list enforcement); known-dangerous field names
(`chainOfThought`, `rawReasoning`, `scratchpad`, `apiKey`, `secret*`, `password`, `credential*`,
`*Token`) throw instead of being dropped, so an accidental attempt to persist hidden reasoning or
a secret is a loud failure during development, not a silent drop in production. No hidden
chain-of-thought is ever accepted — only already-externalized artifacts, observations, decisions,
summaries, and machine-readable state.

`deriveCounterfactualLabels` attaches negative-trajectory/counterfactual labels: cheaper-model-
could-solve, smaller/larger-shard effect, unnecessary-tests-run, repeated-failure, and cache/reuse-
opportunity-missed. Heuristics are conservative and accept optional external comparative signals
(e.g. a cheaper-model shadow replay result) rather than asserting them from a single trajectory
alone.

`buildTaskClassBenchmarkSlice` builds deterministic per-task-class held-out benchmark slices from
accumulated outcome records, and `assertNoBenchmarkLeak` refuses to append a `train`-split record
whose `sourceFingerprint` collides with a held-out benchmark fingerprint.

## Promotion-gated self-improvement loop (`src/training/policy-promotion.js`)

`PolicyRegistry` tracks learned-policy candidates (e.g. shard-sizing, model/executor routing,
context selection, repair choice, test selection, scheduling priority, speculative fan-out)
through the required stage machine:

```
OFFLINE_REPLAY -> SHADOW -> BENCHMARK -> CANARY -> PROMOTION_GATE -> PRODUCTION
```

- `getActivePolicy()` — the only source of live authority. Never returns a SHADOW/CANARY/
  PROMOTION_GATE-stage policy; falls back to the versioned deterministic policy passed into the
  registry's constructor whenever no candidate has reached `PRODUCTION` (or the production
  candidate has been rolled back).
- `promoteThroughGate(...)` — the BENCHMARK stage, delegating to `evaluatePromotionGate` from
  `promotion-gate.js`. A `REJECT` verdict leaves the candidate stuck at `BENCHMARK`; it can never
  reach `PRODUCTION`.
- `recordCanaryResult(...)` / `evaluateCanary(...)` — compares canary candidate metrics
  (acceptance rate, cost, latency, rollback rate, security incidents, verifier escape rate)
  against the current control. Any regression past threshold rolls the candidate back
  immediately (control keeps serving; nothing new is promoted).
- `finalizePromotion(version, { approvedBy })` — the independent promotion gate: requires an
  explicit approver identifier distinct from the automated benchmark/canary verdicts, so a single
  pipeline cannot both decide "this candidate is better" and grant it production authority.
- `rollbackProduction(reason)` — automatic post-promotion rollback path for regressions caught
  outside the canary window; restores the previous `PRODUCTION` version if one exists, else the
  deterministic fallback.

All promoted policies are versioned (`registerCandidate` returns an incrementing version number;
`toJSON`/`fromJSON` round-trip the full version history including stage transitions), and the
deterministic fallback is never itself a promotion candidate — it is supplied once at
construction and is always available.

## Tests

`test/outcome-store.test.js` and `test/policy-promotion.test.js` cover the issue's required test
list: valid records for accepted/rejected outcomes, secret/hidden-reasoning exclusion, held-out
benchmark leak prevention, worse-candidate-cannot-promote, shadow-has-no-live-authority, canary
rollback, and deterministic-fallback availability.
