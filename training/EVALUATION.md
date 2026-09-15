# Per-domain evaluation and promotion gate

Implements the mechanism half of `docs/training/EVALUATION_PROMOTION_PORT_DESIGN.md`'s scoped
plan: the actual decision function, not just its design. Built independent of any live model --
the gate is unit-tested against synthetic score inputs (`test/promotion-gate.test.js`).

## Operator requirement (verbatim, 2026-09-13)

> Do not decide "Model B beat Model A" from one global score. Use a domain eval suite with
> pass/fail gates. Primary metrics should be task success/correctness, regression rate,
> hallucination/unsupported-action rate, tool-use correctness, latency, and cost. A replacement
> model should beat the incumbent on its target domain without materially regressing the
> safety/reliability gates.

## Pieces

- **`training/benchmarks/<domain>/`** (one per domain from `training/manifest.json`'s 7-domain
  taxonomy) -- `manifest.json` + `cases.jsonl`. Seed-sized (3 cases each) held-out eval sets;
  expand case count before using these for a real promotion decision. Not derived from the
  imported `outreach-support-email-marketing-v1` training data -- these are held-out eval cases,
  never training examples.
- **`src/training/score-benchmark.js`** -- `aggregateDomainScores(caseResults, { baselinePassedCaseIds })`
  turns per-case pass/fail + flags into the `DomainScores` shape (taskSuccessRate, regressionRate,
  hallucinationRate, toolUseCorrectness, latencyMsP50, costPerTaskUsd). Pure aggregation; does not
  run a model. `regressionRate` needs a baseline (the incumbent's prior passing case-id set) to be
  meaningful -- without one it reports 0, meaning "not yet measured," not "clean."
- **`src/training/promotion-gate.js`** -- `evaluatePromotionGate({ targetDomain, incumbentScores,
  candidateScores, policy })`. The decision function itself. Domain check: candidate must strictly
  beat incumbent on the target domain's primary metric (`taskSuccessRate` by default). Safety
  check: cross-cutting (checked across every domain both sides were scored on, not just the target
  domain) -- `regressionRate` and `hallucinationRate` must not increase past
  `maxSafetyRegression` (or a per-metric override in `maxRegressionByMetric`). Either check failing
  rejects, even if the other passes -- this is what makes "domain score improves but safety
  regresses" a REJECT, per the operator's explicit callout.
- **`training/MAXXED_PROMOTION_POLICY_V1.json`** -- the default policy as data, loaded by
  `scripts/promote-model.mjs`. **`maxSafetyRegression: 0.02` (2 percentage points absolute) is an
  unconfirmed default pending explicit operator sign-off** -- see the file's `status` field and
  `notes`. Do not treat it as approved; it exists so the mechanism has something concrete to run
  against.
- **`scripts/promote-model.mjs`** -- CLI: `node scripts/promote-model.mjs --domain <domain>
  --incumbent-scores <path> --candidate-scores <path> [--policy <path>] [--out <path>]`. Reads two
  already-computed domain-keyed score files (the `DomainScores` shape above), runs the gate, writes
  a decision record under `training/runs/`, and exits 0 (PROMOTE) or 1 (REJECT) so it composes with
  CI the same way `npm run validate:training` does today (`npm run promote:model -- --domain ...`).
- **`training/runs/`** -- file-based decision records (option 2 from the design doc: no DB in this
  repo, git-diffable, PR-reviewable). Each run's JSON captures the full gate result: verdict,
  domain improvement, every safety regression found, and which domains were cross-checked.

## What this does not do yet (explicitly out of scope, per the design doc)

- No `scripts/evaluate-model.mjs` that actually calls `src/models/model-router.js` and scores a
  candidate against `training/benchmarks/<domain>/cases.jsonl` -- that's the next piece; this PR
  builds the judge, not the thing that runs the exam.
- No shadow-run/traffic-splitting mechanism (needs a real two-model serving path that doesn't
  exist yet in this control plane).
- No promotion-decision storage beyond flat files under `training/runs/`; revisit a real DB only if
  file-based run volume or concurrent-promotion races make that necessary (see the design doc's
  option 1/2 tradeoff).
- Benchmark cases are seed-sized (3 per domain) and hand-written for mechanism testing, not yet a
  statistically meaningful eval corpus.

## Composability with PR #62's design

Matches the design doc's scoped implementation plan almost exactly: `training/benchmarks/`
(item 1), `src/training/` port of the pure `evaluation.ts`/`promotion-verifier.ts` logic (items 2,
4 -- reworked for per-domain gating instead of the single global score email-marketing's original
code assumed), and `scripts/promote-model.mjs` (item 5). `scripts/evaluate-model.mjs` (item 3) and
shadow-run execution (item 6) remain explicit follow-ups, as the design doc already called out.
