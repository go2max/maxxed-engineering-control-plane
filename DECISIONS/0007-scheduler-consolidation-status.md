# ADR 0007 — Scheduler authority consolidation status (issue #48)

Status: Accepted — phase 1 complete in this repository, phase 2 tracked cross-repo

## Context

Issue #48 (P0 follow-up) requires that `maxxed-engineering-control-plane/src/scheduler` remain the
sole scheduling authority, and that the duplicate `engineering-portfolio-scheduler.js`
implementation added in `Maxxed-Tech-Site` be retired once this repo exposes an equivalent
read-only projection for it to consume.

The issue's own investigation comment (go2max/maxxed-engineering-control-plane#48) confirmed this
is genuine duplication — a second independent weighting/eligibility/worker-fit/backpressure
implementation — and explicitly split the work into two phases:

- **Phase 1** (this repository): add a read-only scheduling projection so `Maxxed-Tech-Site` can
  defer to this repo's `PortfolioScheduler` instead of recomputing its own schedule. Shipped in
  `GET /schedule` (see `src/service/http-server.js` and
  `ControlPlaneRuntime.schedulePreview()` in `src/service/control-plane-runtime.js`), which returns
  `authoritative: true`, the same dispatch/backpressure/adaptive-lane/rebalancing/audit output the
  live `PortfolioScheduler` would produce, and per-task `reason` fields on every backpressure entry
  so a consuming admin UI can render an explanation without its own scoring logic.
- **Phase 2** (a different repository, `Maxxed-Tech-Site`): switch
  `platform/src/engineering-scheduler-view.js` to consume `GET /schedule` via the existing
  `EngineeringControlPlaneAdapter`, then delete the scoring/eligibility logic in
  `platform/src/engineering-portfolio-scheduler.js`. The issue's own comment records this as
  deliberately deferred to a separate, reviewed PR because Tech-Site's admin UI and tests
  (`engineering-operator-snapshot.js`, `engineering-operator-metrics.test.mjs`) depend on the local
  implementation's exact output shape, and cutting that over in the same change as the API addition
  would be an unreviewed production-risk change.

## Decision

This repository's contribution to #48 is complete: `GET /schedule` is the authoritative,
loopback-consumable projection (dispatches, backpressure with explanations, adaptive lane limit,
remaining lane budget, rebalancing, audit) that lets any consumer, including Tech-Site's Admin UI,
defer to `PortfolioScheduler` without re-implementing eligibility/weighting/worker-fit logic.

Retiring `Maxxed-Tech-Site/platform/src/engineering-portfolio-scheduler.js` is out of this
repository's blast radius — that file, its call sites, and its tests live in a different
repository (`Maxxed-Tech-Site`) that was not attached to this change. Deleting or rewriting code
there sight-unseen, on a launch day, would be exactly the unreviewed production risk the issue's
own investigation comment says to avoid. Per this repo's reuse-before-build and no-second-source-
of-truth rules (ADR 0006), the correct move is to keep this repo authoritative and land the
Tech-Site cutover as its own reviewed PR against that repository, once its adapter wiring and
tests are updated to consume `GET /schedule`.

Issue #48 should stay open (or be re-labeled "phase 2 pending") until that Tech-Site PR merges and
`engineering-portfolio-scheduler.js` is deleted there.

## Non-goals

- No second scheduler, queue, lease owner, or eligibility/weighting implementation is introduced
  anywhere in this change.
- No code in `Maxxed-Tech-Site` is modified by this change.

reuse: internal — `PortfolioScheduler.planWithReport()` (`src/scheduler/portfolio-scheduler.js`) and
the existing `GET /schedule` projection are the single scheduling authority this ADR formalizes;
no new scheduling logic was added.
