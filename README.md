# Maxxed Engineering Control Plane

This repository is the canonical planning and architecture authority for Maxxed Technical Systems' autonomous engineering platform.

## End-state target

Build a portfolio-scale, exception-driven software-production control plane designed for **300x sustained owner-attention leverage across mixed engineering work**, with a separate architectural target of **up to 100,000x effective/burst leverage on highly standardized product-family operations** through reuse, deterministic transformation, caching, micro-sharding and learned repair.

The 100k target is not a claim of 100k faster general-purpose coding. It means one novel solution can be reused or transformed across many products with little or no new reasoning while preserving exact-SHA acceptance evidence.

## Current operating shape

`intent -> leverage lookup -> exact reuse / deterministic transform / retrieval-assisted / novel reasoning -> portfolio scheduler -> patch/task lanes -> isolated workers -> independent verification -> repair/reconciliation -> safe composition -> PR/release -> production verification -> outcome harvest -> cache/training feedback`

Autonomous coding, fenced local workers, verification/repair, local model routing, dynamic throughput controls and product-factory execution are implemented. The current leverage-fabric tranche adds solution/artifact caches, semantic code graph, transform registry, repair memory, training trajectory harvesting, execution replay, product-family delta planning, maintenance batching, bottleneck analysis and speculative planning.

## Source-of-truth boundaries

- **This repository:** architecture intent, runtime contracts, roadmap, ADRs, leverage targets, capacity/cost policy and cross-repository dependency intent.
- **Maxxed Admin (`admin.techmaxxed.com`):** protected operator UI, projections, exception handling and bounded semantic controls. It is not execution authority.
- **GitHub product repositories:** product source, implementation branches, PRs and release evidence.
- **Execution/control-plane state:** claims, leases, attempts, workers, acceptance evidence and event history.
- **Solution/artifact caches:** optimization layers only. They may accelerate work but never override source SHA, policy, fencing or acceptance truth.

## Core design rules

1. Optimize for accepted output per owner-attention hour, not agent activity.
2. Never perform identical deterministic work twice when a content-addressed result can be safely reused.
3. Agents are the fallback for novel work; exact reuse and deterministic transforms come first.
4. Exact reuse requires immutable source identity and compatible policy/environment fingerprints.
5. Split large work into conflict-aware micro-lanes when expected savings exceed coordination cost.
6. Workers return bounded evidence/patches; they never write directly to `main`.
7. Verification, repair and merge capacity apply backpressure to implementation fan-out.
8. Keep eligibility, priority, capacity, execution, verification and release authority separate.
9. No individual worker, model, runner, host or provider is required for safe forward progress.
10. GitHub Actions compute may run only on approved organization-scoped local self-hosted runners.
11. Human/provider gates block only dependent work.
12. Persist provenance, event history and accepted/rejected outcomes so the system improves from real work.
13. Prefer product-family deltas and shared SDK/foundation reuse over rebuilding complete products.
14. Do not weaken security, acceptance or source-of-truth boundaries to increase reported leverage.

## Repository map

- `ARCHITECTURE.md` — end-state control-plane architecture.
- `LANE_MODEL.md` — task lanes, micro-lanes, claims, leases and backpressure.
- `THROUGHPUT_MODEL.md` — sustained vs effective leverage metrics and checkpoints.
- `docs/100K_LEVERAGE_ARCHITECTURE.md` — compounding reuse/caching/learning architecture.
- `docs/PATCH_FABRIC.md` — micro-shard execution and safe patch composition.
- `docs/AUTONOMOUS_CODING_RUNBOOK.md` — current coding-loop operation.
- `SECURITY_GOVERNANCE.md` — authority and safety boundaries.
- `FAILURE_RECOVERY.md` — bounded repair/reconciliation policy.
- `PRODUCT_FACTORIES.md` — product-family platformization strategy.
- `DATA_ARCHITECTURE.md` — durable state and event/storage design.
- `TASK_CONTRACT.md` / `ACCEPTANCE_CONTRACT.md` — machine-readable work/completion semantics.
- `planning/manifest.json` and `contracts/` — canonical planning projection contracts.
- `DECISIONS/` — architecture decision records.
