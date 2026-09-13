# ADR 0006 — Reuse before build

Status: Accepted

## Decision

For every non-trivial engineering mechanism, perform a reuse scan before writing a bespoke implementation.

The search order is mandatory:

1. **Existing Maxxed code first** — search the current repository, shared SDKs, control-plane/runtime repos, and prior accepted implementations.
2. **Top-25 comparative open-source scan second** — inspect at least 25 strong, relevant, production-grade GitHub implementations or mechanism sources whenever that many credible examples exist.
3. **Synthesize before coding** — extract and deduplicate the strongest invariants, failure handling, admission rules, recovery semantics, observability, and tests across the pool.
4. **Build only the missing delta** — prefer adapting proven algorithms, protocols, data shapes, test patterns, or small compatible implementations over creating a parallel framework.

The objective is not to copy the most popular repository. It is to use a large evidence pool to surface edge cases and design questions we may not have identified yet, then build the strongest compatible composite for the Maxxed architecture.

## Top-25 selection and synthesis

For each substantial reusable mechanism, the research record should:

- include at least 25 credible candidates when available;
- favor mature, maintained systems with real production usage and tests;
- span multiple implementation families where useful rather than 25 near-identical forks;
- score or qualitatively compare candidates on correctness, failure recovery, concurrency semantics, operational maturity, maintenance activity, dependency weight, fit with Maxxed invariants, and license compatibility;
- distinguish directly reusable code from mechanism-only research;
- capture recurring patterns and important dissenting designs;
- explicitly identify new failure modes, questions, or acceptance tests discovered during the scan;
- produce one local design synthesis before implementation begins.

If fewer than 25 credible implementations exist, record the actual pool and why it is smaller. Do not pad the count with low-quality or irrelevant repositories.

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
- `reuse: synthesized-top-25` with the compared candidate pool and extracted mechanisms;
- `reuse: none` with a short explanation of why no suitable implementation was adopted.

This requirement applies to infrastructure, schedulers, queues, retry/backoff, locking, parsers, adapters, build/release tooling, observability, caching, and other reusable engineering primitives. Product-specific business logic may use a lighter scan when the mechanism is genuinely unique.

## Current #886 synthesis pool

The current orchestration research pool includes 25 mature systems spanning workflow engines, schedulers, queues, and distributed workers: Temporal, Kubernetes client-go, Argo Workflows, Graphile Worker, BullMQ, Agenda, pg-boss, Celery, RQ, Dramatiq, Sidekiq, Faktory, Nomad, Airflow, Dagster, Prefect, Dask Distributed, Ray, Luigi, Cadence, Netflix Conductor, Hatchet, River, Machinery, and Kestra.

Recurring mechanisms already adopted or being adapted include:

- dynamic concurrency evaluated at admission/submit time rather than fixed startup-only limits;
- global safety throttles separated from per-group/per-stage admission limits;
- saturation/backpressure represented as a transient scheduling condition rather than task failure;
- durable lease/fencing ownership separated from advisory liveness/heartbeat;
- per-item retry/backoff separated from global rate/capacity limits;
- graceful drain that stops new starts while allowing bounded in-flight work to finish;
- deterministic reconciliation and idempotency rather than blind replay;
- explicit dead-letter/escalation behavior after bounded retry/repair exhaustion.

The canonical implementation remains `maxxed-engineering-control-plane`; external systems are research inputs unless provenance/license explicitly supports direct reuse.
