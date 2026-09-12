# Admin Integration

## Principle

`admin.techmaxxed.com` is the protected operator console, not a second planning or execution source of truth.

## Planning feed

Admin consumes a versioned machine-readable manifest from this repository by exact commit SHA. It caches the validated projection and displays source SHA, fetched/parsed timestamps, schema version and freshness.

Planning feed states:

`CURRENT | STALE | PARTIAL | INVALID | UNAVAILABLE | SUPERSEDED`

A stale or failed refresh cannot remain visually current.

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
- owner exception inbox.

## Existing implementation owners

Maxxed-Tech-Site issues #883-#886 own planning ingestion, leverage telemetry, infrastructure budget/capacity governance and portfolio scheduling. Existing issues #422, #456, #481, #485, #790, #794 and #798 remain canonical for lineage/explainability, Admin completeness, Company Health, Work Packets, operator closure, browser acceptance and the overall Admin workhorse program.

## No-duplication rule

Admin must link/project canonical sources. It must not copy strategic plan data into independently editable Admin records or recreate execution state merely to render a dashboard.
