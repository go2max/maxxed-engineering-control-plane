# Admin Integration

## Principle

`admin.techmaxxed.com` is the protected operator console, not a second planning or execution source of truth.

Loss of Admin, Cloudflare, the sync bridge, or browser connectivity must never stop the local engineering control plane. The control plane continues under the last durably committed policy and current worker capacity.

## Planning feed

Admin consumes a versioned machine-readable manifest from this repository by exact commit SHA. It caches the validated projection and displays source SHA, fetched/parsed timestamps, schema version and freshness.

Planning feed states:

`CURRENT | STALE | PARTIAL | INVALID | UNAVAILABLE | SUPERSEDED`

A stale or failed refresh cannot remain visually current.

## Execution projection

Admin consumes execution state through a bounded bridge/projection path. It must never attempt to reach a local worker/control-plane loopback address directly from the hosted Cloudflare runtime.

The bridge must preserve:
- exact source/controller identity;
- source sequence/checkpoint where available;
- projection timestamp and age;
- partial/stale endpoint diagnostics;
- last-known-good projection separately from current reachability;
- command IDs and command outcomes;
- authoritative/non-authoritative evidence distinction.

A partial refresh preserves healthy sections but must visibly mark reused or missing sections as degraded. Failure of model health, events, or another optional projection endpoint cannot erase valid task/claim/scheduler truth.

## Command path

Admin sends only bounded semantic commands. It never sends shell commands, arbitrary URLs, raw database queries, or executable scripts.

Every mutation carries a unique `command_id`/idempotency key. The local control plane owns deduplication and side effects.

When the projection is stale, unreachable, unready or partial:
- expansive/resume/recovery mutations fail closed;
- emergency-safe actions that only reduce work may remain available, including pause dispatch, freeze repository and drain repository;
- Admin must show that the command was executed while degraded.

Admin command delivery is not proof of execution. Only a durable command-ledger result/event from the local control plane is authoritative.

## Roadmap views

Admin should expose:
- end-state architecture target;
- current critical path;
- active/blocked milestones;
- dependency relationships;
- product/repository ownership;
- target leverage stage;
- live execution reconciliation;
- budget/capacity posture;
- exact planning source/ADR links.

Roadmap Queue remains idea/spec intake. This repository represents approved architecture/roadmap intent. The execution queue represents actual executable work.

## Operational views

Admin consumes canonical execution evidence to show:
- executable/blocked frontier;
- lane board and host capacity;
- verification/repair backpressure;
- throughput/leverage trends;
- cost per accepted output;
- budget limits and bottleneck attribution;
- owner exception inbox;
- projection freshness and failed endpoint details;
- worker/host degraded, draining, offline and quarantined states;
- command acknowledgment/deduplication state;
- current reconciliation/startup-recovery state.

## Existing implementation owners

Maxxed-Tech-Site issues #883-#886 own planning ingestion, leverage telemetry, infrastructure budget/capacity governance and portfolio scheduling. Existing issues #422, #456, #481, #485, #790, #794 and #798 remain canonical for lineage/explainability, Admin completeness, Company Health, Work Packets, operator closure, browser acceptance and the overall Admin workhorse program.

## No-duplication rule

Admin must link/project canonical sources. It must not copy strategic plan data into independently editable Admin records or recreate execution state merely to render a dashboard.
