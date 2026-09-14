# Evaluation/promotion architecture port — scoped design (follow-up)

Status: design only, not implemented. This is the deliberately scoped-down second half of the
training-system migration from `email-marketing`; the import pipeline (see
`scripts/import-training-examples-email-marketing.mjs`) was implemented as a complete PR first.

## What ports as-is (pure logic, no DB, no product coupling)

Copy and adapt with only naming changes, no architectural rework:

- `lib/training-system/evaluation.ts` — classification report, structured-output pass rate, Wilson
  interval, seeded paired bootstrap, preference/win-rate report, safety blocker report, lexical
  diversity. Zero DB or email-marketing coupling.
- `lib/training-system/promotion-verifier.ts` — `evaluatePromotionEvidence(policy, evidence)` gate
  logic (dataset/benchmark/comparison/structured-output/operations/shadow/rollback thresholds →
  PROMOTE/CANARY/SHADOW LONGER/RETRAIN/REJECT/BLOCKED). Pure function.
- The dedup/hashing/leakage/split portions of `lib/training-system/evidence.ts`
  (`normalizeForDedup`, content hashing, `nearDuplicateScore`, `templateFamilyFingerprint`,
  `leakageGroupKey`, `assignDatasetSplit`, `scanLeakage`, `reconcileCounts`,
  `evaluatePromotionGates`) and the privacy-redaction regexes.
- `scripts/evaluate-maxxed-model.ts` mechanism — reads a benchmark JSONL, calls an
  OpenAI-compatible `/chat/completions` endpoint, scores cases, writes score artifacts. Needs only
  its target endpoint repointed at this repo's own model-router (`src/models/model-router.js`)
  instead of email-marketing's send pipeline.

## What needs redesign, not a straight copy

- **Storage layer**: `manifest-job.ts`, `promotion-store.ts`, `provenance-store.ts`,
  `verify-training-promotion.ts`, `build-training-corpus.ts` all use `pg.Pool`/`DATABASE_URL`
  against `llm_control.*` tables (`dataset_manifests`, `dataset_membership`,
  `benchmark_manifests`, `training_registry`, `evaluation_runs`, `evaluation_jobs`, `shadow_runs`,
  `shadow_run_items`, `promotion_decisions`, `dataset_verifications`, `rollback_verifications`).
  This repo has **no database today** (`package.json` had zero runtime dependencies before this
  PR; training data lives in flat JSONL + `manifest.json`). Two real options:
  1. Stand up this repo's own Postgres (Neon or otherwise) and port the migration SQL
     (`llm-data/migrations/005-014`), recreated under a control-plane-owned schema
     (e.g. `training_control` instead of `llm_control`) — preserves the full transactional
     governance model (claim/finish state machines, immutable evaluation_runs, hash-checked
     artifact identity).
  2. File-based equivalent: JSON manifests per run under `training/runs/<run_id>/` with the same
     fields, validated by a script instead of DB constraints — lower operational cost, matches this
     repo's current no-DB convention, but loses transactional claim semantics (two concurrent
     promotion attempts on the same run could race) and query-ability (`list_slow_queries`-style
     inspection).

  Recommendation: start with option 2 (file-based) for the same reason the import pipeline stayed
  in JSONL — this repo is optimized for auditable, PR-reviewable, git-diffable state, not a live
  operational DB. Revisit option 1 only if run volume or concurrent-promotion risk makes file
  locking insufficient.

- **Domain-awareness**: none of the email-marketing evaluation/promotion code has any concept of
  training domain. The benchmark spec, dataset manifest, and promotion policy all need a `domain`
  field threaded through (dataset_manifests.domain, benchmark_manifests.domain, evaluation
  reports segmented per domain) so a promotion decision is scoped to one domain's model
  capability, never a single global score across all seven domains — this is a direct requirement
  from the operator ("Do not decide 'Model B beat Model A' from one global score. Use a domain
  eval suite with pass/fail gates.").

- **Metrics set**: `MAXXED_PROMOTION_POLICY_V1.json`'s dimensions (`campaign_id`, `lead_type`,
  `reply_type`, `traffic_period`) are outreach-specific shadow-coverage dimensions. The ported
  policy needs a per-domain dimension set instead — e.g. `infrastructure-diagnosis` shadow coverage
  might key on `failure_class`/`subsystem` rather than `campaign_id`. The primary metrics the
  operator specified (task success/correctness, regression rate, hallucination/unsupported-action
  rate, tool-use correctness, latency, cost) should become the fixed top-level gate set shared
  across all domains, with domain-specific dimensions layered under `shadowCoverage` per domain.

- **Objective/task-class mapping**: email-marketing's `objective` enum
  (`first_touch_copy`/`offer_and_cta`/`response_wording`) doesn't exist in this repo's schema;
  this repo uses `task_class` (e.g. `failure-classification`, `authority-check`,
  `copy-generation`). The benchmark spec's category counts need remapping to `task_class` ×
  `domain` instead of `objective`.

## Scoped implementation plan (next PR)

1. Add `training/runs/` (file-based run manifests) and `training/benchmarks/` (frozen benchmark
   JSONL + manifest, one per domain) directories with a schema documented in a new
   `training/EVALUATION.md`.
2. Port `evaluation.ts` and `promotion-verifier.ts` verbatim (rename `lib/training-system/` →
   `src/training/`), add unit tests using `node --test` (matching this repo's existing test
   runner, no new test framework).
3. Port `evaluate-maxxed-model.ts` as `scripts/evaluate-model.mjs`, repointed at
   `src/models/model-router.js` instead of an external `/chat/completions` URL, with `--domain`
   required.
4. Define `training/MAXXED_PROMOTION_POLICY_V1.json` per-domain (copy the frozen-threshold
   structure from email-marketing's policy file, replace outreach-specific shadow dimensions per
   domain, keep the six primary metrics fixed across domains).
5. Add `scripts/promote-model.mjs`: reads a run manifest + domain benchmark scores, calls
   `evaluatePromotionEvidence`, writes a `promotion_decisions`-equivalent JSON file plus a
   human-readable summary, gated the same way `validate:training` is today (a `validate:promotion`
   npm script others can wire into CI).
6. Explicitly out of scope for that PR: shadow-run execution/traffic splitting (needs an actual
   serving path for two model versions, which doesn't exist in this repo yet) and rollback drills
   — both stay as further follow-ups once a real model-serving/shadow-traffic mechanism exists in
   the control plane.
