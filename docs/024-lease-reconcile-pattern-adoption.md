# 024 — Adopting proven lease/reconcile patterns without a second queue authority

Research note for issue #47.

## Scope note on "#886"

Issue #47 references "#886" as the source of the portfolio dynamic-lane work being reviewed.
This repository's issue numbering has no #886, and the issue body is explicit that it is
recording **design sources**, not asking for a specific PR to be closed by number — it says
"this note records the design sources so implementation can reuse mechanisms without importing
a second framework or copying third-party code." The dynamic-lane work it refers to is this
repo's `src/scheduler/*` and `src/core/claim-authority.js`, most directly documented in
`docs/changes/011-dynamic-lanes-backpressure.md` and `docs/changes/012-critical-path-fairness.md`.
Treating #886 as an external/typo reference and #47 as a research note (per the task
instructions) is the correct read: **the deliverable is written analysis plus one small,
targeted mechanism gap-fill, not a rewrite of the scheduler.**

## Where each reviewed pattern already lives in this codebase

| Reviewed pattern | Source | Already present here as |
|---|---|---|
| Durable mutex/semaphore ownership; queue by priority then age | Argo Workflows | `src/core/claim-authority.js` (`claim`/`fence`/generation) is the sole ownership authority; `src/scheduler/portfolio-scheduler.js#scoreTask` ranks by `priority * 10 + ... + starvationSteps * 3` (age-based starvation boost), and `test/critical-path-fairness.test.js` covers it. |
| Do not take held ownership merely because a heartbeat is stale | Argo Workflows | `test/lease-recovery.test.js` — reassignment happens only via TTL expiry + fencing (`ClaimAuthority#sweepExpired`/`#fence`), never via heartbeat alone. **Gap closed by this PR** (see below): heartbeat loss previously had no representation at all, so nothing *could* have revoked a lease off a stale heartbeat, but there was also no way to stop new work going to a suspect worker without conflating it with lease logic. |
| Separate heartbeat/liveness from attempt timeout; persist progress so retry resumes from a checkpoint; cancellation via heartbeat channel | Temporal | Attempt timeout = `ClaimAuthority` TTL (`claim.expiresAt`). Heartbeat/liveness was previously unmodeled. Checkpoint-resume is out of scope here (task attempts are currently all-or-nothing at the shard granularity via `src/patch/micro-shard-coordinator.js`); cancellation-via-heartbeat is not implemented. |
| Event-driven reconcile; per-item backoff + global token-bucket; bounded retry then drop/escalate | k8s controller-runtime/client-go | `src/core/orchestrator.js#dispatch` reconciles expired leases before reassigning (event-driven, not polling-only). `src/verification/repair-controller.js` and `src/verification/failure-fingerprint.js` classify and bound retries, routing deterministic repeats to repair/dead-letter handling — this already matches "bounded retry then drop/escalate." `adaptiveLaneCapacity()` in `portfolio-scheduler.js` is the global capacity limiter (analogous to a token bucket, keyed on worker pressure rather than a fixed rate). |
| Graceful shutdown drains active work; crash recovery unlocks only after a bounded stale-lock interval | Graphile Worker | `src/core/runtime-state.js#restoreRuntime` fences *all* live leases on restart (stricter than "bounded stale-lock interval" — see the comment in `test/lease-recovery.test.js`, which is an intentional, documented divergence: a process restart is treated as a total ownership loss regardless of remaining TTL, not a partial one). Graceful drain-on-shutdown (stop new claims, let active work finish) is not currently implemented as a distinct code path. |
| Bounded retries, crash recovery, TTL as a safety aid not a perfect guarantee | Asynq/Sidekiq | Matches current design: `ClaimAuthority` TTL + fencing generation is explicitly a safety aid (the generation number, not the TTL, is the actual correctness mechanism — see `#matches()`), consistent with "uniqueness/lock TTL as a safety net." |

## Architecture implications from the issue, and their status

1. **Durable control-plane lease/fencing remains the sole authority; Admin stays
   projection/operator only.** Already true: `ClaimAuthority` is the only place a claim is
   created, renewed, or revoked. `docs/ADMIN_INTEGRATION.md` and `src/service/http-server.js`
   expose admin/operator surfaces that read or apply policy (freeze/drain/priority overrides via
   `SchedulerPolicy`), never a competing claim/lock table. No change needed.
2. **Heartbeat loss makes a worker suspect and stops new assignments; it does not itself revoke
   a current lease.** This was the one genuine gap: there was no heartbeat model at all, so
   "suspect but still owns its claim" had no representation. **Closed by this PR** — see below.
3. **Reassignment occurs only after lease expiry/safe reconciliation and fencing-generation
   advance.** Already implemented and tested (`ClaimAuthority#fence`, `sweepExpired`,
   `orchestrator.js#dispatch`, `test/lease-recovery.test.js`). No change needed.
4. **Capacity contraction/reprioritization uses checkpoint-drain, not unsafe in-flight
   preemption.** Partially true: `SchedulerPolicy#drainRepository` stops *new* admission to a
   repository (`docs` shows `repository-draining` backpressure) without touching in-flight
   claims — that is drain, not preemption. A generic worker-level graceful-shutdown drain (stop
   new claims for one worker, let its current claim finish) is not implemented; flagged as
   future work below since it's a distinct code path from repository draining.
5. **Retry/backoff is classified and bounded; deterministic repeated failures route to
   repair/dead-letter/circuit-breaker handling.** Already implemented via
   `failure-fingerprint.js` + `repair-controller.js`. No change needed.
6. **Scheduler filters ineligible/blocked work before priority ranking.** Already implemented:
   `PortfolioScheduler#planWithReport` filters candidates (work-packet validity, deployment
   serialization, stage admission, policy) before `scoreTask`/sort. No change needed.

## The one mechanism gap this PR closes

Implication 2 had no code representation. `src/scheduler/worker-heartbeat.js` adds
`WorkerHeartbeatMonitor`: a worker missing its heartbeat window becomes "suspect" and is
filtered out of *new* dispatch eligibility in `PortfolioScheduler#planWithReport`
(`heartbeatMonitor.eligibleForNewWork`), while its existing claim in `ClaimAuthority` is left
completely untouched — revocation still only happens through TTL expiry + fencing. This is
additive: `heartbeatMonitor` is an optional constructor argument, defaulting to `null`
(no behavior change for existing callers), and it does not become a second ownership authority
— it never writes to `ClaimAuthority` and has no opinion about who owns a task, only about
whether a worker should receive more of it right now.

## Deferred (explicitly, not silently dropped)

- **Checkpoint/progress persistence for mid-attempt resume** (Temporal-style). The current
  shard/verify/repair loop already treats a failed attempt as fully retryable from its inputs
  rather than needing resume-from-checkpoint, so there is no correctness gap today; adding
  persisted progress checkpoints is real scope that deserves its own design, not a lease-pattern
  footnote.
- **Cancellation delivered through the heartbeat channel.** No current caller needs
  worker-initiated cancellation; `WorkerHeartbeatMonitor` intentionally stays a one-way liveness
  signal (worker → monitor) until that requirement exists, to avoid speculative API surface.
- **Generic per-worker graceful-shutdown drain** (distinct from repository draining). Flagged in
  implication 4 above; natural home would be alongside `SchedulerPolicy`, but doing it well
  needs a real shutdown-signal integration point in `src/service/*`, which is out of scope for
  a research-note PR under a launch deadline.
