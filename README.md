# Maxxed Engineering Control Plane

This repository is the canonical planning and architecture authority for Maxxed Technical Systems' autonomous engineering platform.

## End-state target

Build directly for a portfolio-scale, exception-driven software-production control plane designed for **300x sustained owner-attention leverage** with horizontal scalability beyond that for highly standardized workloads. Intermediate leverage stages are acceptance checkpoints, not architectural destinations.

## Source-of-truth boundaries

- **This repository:** architecture intent, roadmap, ADRs, planning manifest, leverage targets, capacity and cost policy, product-factory strategy, migration sequencing, cross-repository dependency intent.
- **Maxxed Admin (`admin.techmaxxed.com`):** protected operator UI, roadmap projection, execution reconciliation, capacity/cost/throughput views, safe semantic controls, exception inbox.
- **GitHub product repositories:** implementation work and product-specific issues/PRs.
- **Execution/control-plane state:** actual claims, leases, attempts, workers, CI, deployments and accepted completion evidence. Planning intent never overwrites live execution truth.

## Core design rules

1. Design for the end-state; do not redesign the architecture at 20x, 50x or 100x.
2. Separate eligibility, priority, capacity and execution authority.
3. Prefer event-driven dispatch over polling.
4. Keep implementation, verification and repair capacity balanced with backpressure.
5. Use self-hosted runners only for GitHub Actions compute.
6. Treat PostgreSQL as durable state, not a raw event/log firehose.
7. Keep engineering-platform Neon/PostgreSQL spend at or below the configured target (initially $40/month) through architecture and query efficiency before scaling spend.
8. Do not scale unrelated infrastructure such as the Fly.io Kalshi/prediction workload for engineering automation.
9. Keep Cloudflare capacity flat unless measured saturation/reliability evidence justifies change.
10. Optimize, reuse and rebalance before purchasing additional capacity.
11. Human/provider gates block only dependent work, never independent ready lanes.
12. Measure accepted output per owner-attention hour, not commits, PRs, tokens or agent activity.

## Repository map

- `VISION.md` — operating model and ceiling.
- `ARCHITECTURE.md` — end-state platform architecture.
- `ROADMAP.md` — implementation sequencing and acceptance waves.
- `COST_MODEL.md` — budget/capacity policy.
- `THROUGHPUT_MODEL.md` — leverage metric and stage gates.
- `DATA_ARCHITECTURE.md` — PostgreSQL/event/storage design.
- `LANE_MODEL.md` — concurrency, claims, leases and isolation.
- `AGENT_ROLES.md` — planner/implementer/verifier/repair/release responsibilities.
- `FAILURE_RECOVERY.md` — bounded repair and reconciliation policy.
- `PRODUCT_FACTORIES.md` — platformization strategy.
- `ADMIN_INTEGRATION.md` — canonical feed into Maxxed Admin.
- `MIGRATION_PLAN.md` — controlled replacement of current automation.
- `SECURITY_GOVERNANCE.md` — authority and safety boundaries.
- `TASK_CONTRACT.md` / `ACCEPTANCE_CONTRACT.md` — machine-readable work and completion semantics.
- `planning/manifest.json` — initial canonical roadmap projection.
- `contracts/planning-manifest.schema.json` — versioned planning feed contract.
- `DECISIONS/` — architecture decision records.

## Related Maxxed-Tech-Site work

The Admin implementation tracks the planning-source ingestion, leverage telemetry, capacity/cost governance and portfolio scheduler under Maxxed-Tech-Site issues #883–#886. Existing canonical issues for route completeness, lineage, Work Packets, Company Health, browser acceptance and operator closure remain authoritative and must be reused rather than duplicated.
