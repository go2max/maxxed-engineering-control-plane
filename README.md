# Maxxed Engineering Control Plane

This repository is the canonical planning and architecture authority for Maxxed Technical Systems' autonomous engineering platform.

## Open-ended leverage objective

Build a portfolio-scale, exception-driven software-production control plane that continuously increases **independently verified production value per owner-attention hour** without encoding a terminal leverage ceiling.

The current measured operating baseline is approximately **86x average effective engineering throughput**. Milestones such as **300x, 1K, 3K, 10K, 30K, 100K, 300K, 1M and beyond** are measurement checkpoints, not end states.

The architecture pursues progressively higher leverage through exact reuse, deterministic transformation, typed Engineering IR, context/horizon compression, content-addressed execution, micro-sharding, durable checkpoints, repair memory, product-family regeneration, capability graphs, proof/evidence fabrics, learned routing, counterfactual policy testing, and continuous abstraction/complexity optimization.

The open-ended architecture and latest 100-perspective adversarial panel + broad GitHub prior-art sweep are documented in [`docs/OPEN_ENDED_LEVERAGE_ARCHITECTURE.md`](docs/OPEN_ENDED_LEVERAGE_ARCHITECTURE.md).

The prior 100K acceleration audit remains useful for the detailed 1,600-perspective sector review and phase-by-phase engineering-hour estimates: [`docs/AI_AGENT_100K_ACCELERATION_AUDIT.md`](docs/AI_AGENT_100K_ACCELERATION_AUDIT.md).

## Current operating shape

`intent -> intent/engineering IR -> capability resolution -> leverage lookup -> exact reuse / deterministic transform / retrieval-assisted / novel reasoning -> horizon/context compiler -> portfolio scheduler -> patch/task lanes -> isolated checkpointable workers -> proof/evidence fabric -> repair/reconciliation -> safe composition -> PR/release -> production verification -> outcome harvest -> policy laboratory / abstraction mining / training feedback`

Autonomous coding, fenced local workers, verification/repair, local model routing, dynamic throughput controls and product-factory execution are implemented. The leverage fabric is being expanded with solution/artifact caches, semantic and capability graphs, transform registry, repair memory, training trajectory harvesting, execution replay, product-family delta planning, maintenance batching, bottleneck analysis, durable checkpoints, policy shadowing, causal telemetry and continuous architecture garbage collection.

## Source-of-truth boundaries

- **This repository:** architecture intent, runtime contracts, roadmap, ADRs, leverage milestones, capacity/cost policy and cross-repository dependency intent.
- **Maxxed Admin (`admin.techmaxxed.com`):** protected operator UI, projections, exception handling and bounded semantic controls. It is not execution authority.
- **GitHub product repositories:** product source, implementation branches, PRs and release evidence.
- **Execution/control-plane state:** claims, leases, attempts, workers, checkpoints, acceptance evidence and event history.
- **Solution/artifact caches:** optimization layers only. They may accelerate work but never override source SHA, policy, fencing or acceptance truth.

## Core design rules

1. Optimize for accepted production value per owner-attention hour, not agent activity.
2. Never treat a leverage number as an architectural ceiling; milestones exist to measure progress.
3. Never perform identical deterministic work twice when a content-addressed result can be safely reused.
4. Agents are the fallback for novel work; exact reuse and deterministic transforms come first.
5. Exact reuse requires immutable source identity and compatible policy/environment fingerprints.
6. Keep probabilistic tasks inside an empirically reliable horizon; decompose before blindly upgrading model strength.
7. Split large work into conflict-aware micro-lanes when expected savings exceed coordination cost.
8. Workers return bounded evidence/patches; they never write directly to `main`.
9. Workers should be disposable; durable state/checkpoints live outside the worker.
10. Verification, repair and merge capacity apply backpressure to implementation fan-out.
11. Keep eligibility, priority, capacity, execution, verification and release authority separate.
12. No individual worker, model, runner, host or provider is required for safe forward progress.
13. GitHub Actions compute may run only on approved organization-scoped local self-hosted runners.
14. Human/provider gates block only dependent work.
15. Persist provenance, event history and accepted/rejected outcomes so the system improves from real work.
16. Prefer product-family deltas and shared SDK/foundation reuse over rebuilding complete products.
17. Do not weaken security, acceptance, provenance, rollback or source-of-truth boundaries to increase reported leverage.
18. AI-agent work should consume typed work packets and compiled minimal context rather than rediscovering repository conventions from scratch.
19. New scheduling/model/context/verification policies must earn promotion through shadow/canary evidence rather than self-modifying directly in production.
20. Repeated successful reasoning patterns should become deterministic infrastructure; obsolete paths should be deleted.

## Repository map

- `ARCHITECTURE.md` — end-state control-plane architecture.
- `LANE_MODEL.md` — task lanes, micro-lanes, claims, leases and backpressure.
- `THROUGHPUT_MODEL.md` — leverage metrics, anti-gaming rules and open-ended milestone checkpoints.
- `docs/OPEN_ENDED_LEVERAGE_ARCHITECTURE.md` — no-ceiling architecture, latest 100-perspective panel, GitHub sweep, self-optimizing policy laboratory and new leverage primitives.
- `docs/100K_LEVERAGE_ARCHITECTURE.md` — the 100K milestone architecture and compounding reuse/caching/learning primitives.
- `docs/AI_AGENT_100K_ACCELERATION_AUDIT.md` — 1,600-perspective simulated cross-sector audit, deduplicated AI-agent optimizations, engineering-hour estimates and cumulative leverage model.
- `docs/PATCH_FABRIC.md` — micro-shard execution and safe patch composition.
- `docs/AUTONOMOUS_CODING_RUNBOOK.md` — current coding-loop operation.
- `SECURITY_GOVERNANCE.md` — authority and safety boundaries.
- `FAILURE_RECOVERY.md` — bounded repair/reconciliation policy.
- `PRODUCT_FACTORIES.md` — product-family platformization strategy.
- `DATA_ARCHITECTURE.md` — durable state and event/storage design.
- `TASK_CONTRACT.md` / `ACCEPTANCE_CONTRACT.md` — machine-readable work/completion semantics.
- `planning/manifest.json` and `contracts/` — canonical planning projection contracts.
- `DECISIONS/` — architecture decision records.
