# ADR 0006 — Reuse before build

Status: Accepted

## Decision

For every non-trivial engineering mechanism, perform a reuse scan before writing a bespoke implementation.

The search order is mandatory:

1. **Existing Maxxed code first** — search the current repository, shared SDKs, control-plane/runtime repos, and prior accepted implementations.
2. **Mature open-source implementations second** — search established GitHub projects that solve the same mechanism in production.
3. **Build only the missing delta** — prefer adapting a proven algorithm, protocol, data shape, test pattern, or small compatible implementation over creating a parallel framework.

The goal is lower engineering effort, less duplicate code, faster validation, and smaller long-term maintenance surface.

## Adoption gate

Before reusing external code or a substantial implementation, record:

- upstream repository and exact file/commit/tag when practical;
- project maturity / evidence that the mechanism is exercised in production;
- license and compatibility with the target repository;
- whether the Maxxed change is **copied**, **adapted**, **ported**, or only **inspired by** the upstream mechanism;
- the local authority/invariant boundary that must not be weakened;
- tests proving the adopted behavior inside the Maxxed runtime.

Prefer permissive sources (MIT, Apache-2.0, BSD, ISC) for direct reuse. GPL/AGPL/LGPL or unclear licensing requires explicit compatibility review before copying code. When licensing is incompatible or uncertain, use the implementation as architectural research only and write an independent implementation from the learned mechanism.

## Architecture rule

Open-source reuse must not introduce a second source of truth. If Maxxed already has a canonical authority for scheduling, leases, queue state, verification, cost, or telemetry, external code may improve that authority but may not create a competing one.

For orchestration specifically:

- durable control-plane state remains authoritative;
- lease expiry and fencing remain the ownership boundary;
- worker heartbeat remains advisory liveness;
- Admin remains a projection/operator surface;
- recovery is reconcile-first and fail-closed;
- graceful contraction uses drain/checkpoint behavior rather than unsafe mutation preemption.

## Definition of done

A feature is not considered efficiently implemented until the PR states one of:

- `reuse: internal` with the reused Maxxed component;
- `reuse: external` with upstream provenance/license;
- `reuse: none` with a short explanation of why no suitable implementation was adopted.

This requirement applies to infrastructure, schedulers, queues, retry/backoff, locking, parsers, adapters, build/release tooling, observability, caching, and other reusable engineering primitives. Product-specific business logic may use a lighter scan when the mechanism is genuinely unique.

## Current #886 examples

The portfolio scheduler/recovery work uses these external mechanisms as research inputs rather than importing another queue framework:

- Kubernetes client-go workqueue: per-item exponential retry combined with an overall token-bucket limiter;
- Graphile Worker: stop accepting new jobs during graceful shutdown while draining/releasing active work;
- Argo Workflows: durable synchronization/lock ownership rather than stealing ownership solely from stale controller liveness;
- Temporal activity execution: heartbeat/progress semantics separated from durable attempt ownership/timeouts.

The canonical implementation remains `maxxed-engineering-control-plane`.
