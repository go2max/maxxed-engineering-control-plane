# Vision

## Objective

Build Maxxed into an autonomous software-production system where the owner governs direction, capital allocation and true exceptions while routine engineering work discovers itself, executes, verifies, repairs, ships and reports evidence without manual task feeding.

## Target operating model

The architecture is designed for **300x sustained owner-attention leverage** across the blended portfolio and horizontal scalability beyond that for standardized product families. 500x–1000x may occur on highly repeatable factory work, but it is not the baseline success criterion.

The core metric is:

`accepted human-engineering-equivalent hours / owner active intervention hours`

This metric is an operating estimate, not payroll accounting. Accepted output must have completion evidence; owner attention must be measured or explicitly entered; human-equivalent effort must retain low/base/high bounds, confidence and methodology version.

## End-state owner experience

The owner should primarily see:

- the highest-value exceptions requiring a decision;
- what shipped and what value it unlocked;
- which critical path is currently limiting the portfolio;
- whether execution, verification, repair, model capacity, local hardware, provider limits or human gates are the bottleneck;
- current leverage, autonomous completion, rework and cost per accepted output;
- budget posture and exact reason for any recommended capacity increase.

The owner should not routinely need to:

- choose the next issue for a worker;
- restart stuck lanes manually;
- inspect raw logs or database rows;
- copy shell commands from Admin;
- reconcile GitHub, queue and worker state by hand;
- open provider dashboards to understand ordinary status;
- repeatedly approve low-risk, policy-compliant work.

## Non-negotiable properties

- Dependency-safe.
- Fail-closed for new claims when state is stale or contradictory.
- Event-driven where practical.
- Backpressure-aware.
- Explainable scheduling decisions.
- Bounded retries and repair loops.
- Strong source-of-truth boundaries.
- Semantic operator actions rather than raw mutation surfaces.
- Self-hosted GitHub Actions compute only.
- Cost-aware without weakening safety checks.
- Product-factory and shared-SDK oriented.
- Historical evidence must remain attributable to exact source SHA/policy version.

## Completion definition

The platform is at end-state when a large multi-repository backlog can continuously flow through planning, eligibility, scheduling, implementation, verification, repair, acceptance, merge/release and production verification while independent work continues around blocked items and the owner is primarily engaged only for policy-defined exceptions and strategic decisions.
