# Reuse-first engineering gate

Implements issue #50. This is the mandatory, concrete checklist behind
[ADR 0006 — Reuse before build](../DECISIONS/0006-reuse-before-build.md). It applies before
writing any net-new infrastructure or framework-level code: schedulers, queues, retry/backoff,
locking, parsers, adapters, build/release tooling, observability, caching, and other reusable
engineering primitives. Product-specific business logic may use a lighter pass when the mechanism
is genuinely unique — say so in the PR's `reuse: none` reason.

This checklist is enforced two ways:

1. **Process** — every engineering task (human or autonomous coding loop, see
   [`AUTONOMOUS_CODING_RUNBOOK.md`](AUTONOMOUS_CODING_RUNBOOK.md#reuse-first-gate)) runs this
   checklist before implementation begins.
2. **PR template** — [`.github/pull_request_template.md`](../.github/pull_request_template.md)
   requires a `reuse:` line; `npm run validate:reuse-gate` (wired into CI) fails the build if it's
   missing or malformed.

## Checklist

1. **Define the capability and invariants first.** Write down what the mechanism must guarantee
   (durability, ordering, failure semantics, authority boundary) before searching for or writing
   any code. You cannot evaluate a candidate against invariants you haven't stated.
2. **Search existing Maxxed repositories first.** Check this repo, shared SDKs, and prior accepted
   implementations for equivalent or adjacent code (`git grep`, `mcp__github__search_code` across
   `go2max/*` repos). A near-duplicate found here is a **refactor signal**, not a green light to
   add a second implementation — consolidate instead, or explain in the PR why not.
3. **Search mature public GitHub projects second.** For a substantial mechanism, aim for a pool of
   at least 25 credible, production-grade implementations when that many exist (see ADR 0006's
   "Top-25 selection and synthesis"). Favor maintained systems with real production usage and
   tests; span implementation families rather than near-identical forks. If fewer than 25 credible
   candidates exist, record the actual pool and why it's smaller — don't pad with irrelevant repos.
4. **Evaluate candidates** on license compatibility, maintenance activity, test coverage, security
   posture, dependency weight, API stability, and architectural fit with Maxxed's authority
   boundaries (durable control-plane state, lease/fencing ownership, fail-closed recovery — see
   ADR 0006's "Architecture rule").
5. **Prefer, in this order:**
   1. reuse existing Maxxed code unchanged;
   2. extract/adapt a small proven implementation or algorithm;
   3. use a stable upstream library when the dependency cost is justified;
   4. write custom code only for the remaining Maxxed-specific delta.
6. **Never copy code with unclear license/provenance.** Record source repository, source
   path/commit/tag, license, what was adapted, and why — in the PR's reuse section. Prefer
   permissive licenses (MIT, Apache-2.0, BSD, ISC) for direct reuse; GPL/AGPL/LGPL or unclear
   licensing requires explicit compatibility review before copying code, or use it as
   architectural research only and write an independent implementation.
7. **Do not import a whole framework when a small algorithm/pattern is sufficient.** A single
   admission-control function does not justify a workflow-engine dependency.
8. **Add regression tests around adapted behavior**, so upstream inspiration does not become an
   undocumented dependency — the test should pass even if the upstream project disappears
   tomorrow.
9. **Record estimated avoided engineering hours / LOC / maintenance surface** when meaningful, in
   the PR body, to make reuse value visible over time (see "Metrics" below).
10. **During later refactors, re-run this checklist** before adding another parallel subsystem.
    Open-source reuse (or internal reuse) must not create a second source of truth alongside an
    existing Maxxed authority.

## Adoption gate record

Before reusing external code, capture in the PR (the template provides the fields):

- upstream repository and exact file/commit/tag when practical;
- evidence the mechanism is exercised in production upstream;
- license and compatibility with this repository;
- whether the change is **copied**, **adapted**, **ported**, or only **inspired by** the upstream
  mechanism;
- the local Maxxed authority/invariant boundary that must not be weakened;
- tests proving the adopted behavior inside the Maxxed runtime.

## Metrics

`scripts/reuse-metrics.mjs` scans merged PR bodies (or a local directory of saved PR bodies) for
`reuse:` lines and reports counts by category (`internal` / `external` / `synthesized-top-25` /
`none`) plus any recorded avoided-engineering-time estimates, so reused-vs-newly-authored code and
avoided engineering time can be tracked over time. Run it with:

```
node scripts/reuse-metrics.mjs <path-to-jsonl-or-directory-of-pr-bodies>
```

`scripts/check-reuse-gate.mjs` is the CI-facing enforcement: it validates that a given PR body
text contains exactly one well-formed `reuse:` line and exits non-zero otherwise.
