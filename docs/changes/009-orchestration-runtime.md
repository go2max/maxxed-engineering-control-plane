# PR 009 — Integrated orchestration runtime

Composes the task graph, portfolio scheduler, global claim authority, acceptance verifier, bounded repair controller and local-first model router into one engineering orchestration runtime.

Dispatch now creates authoritative resource-scoped claims, records model selection when required, and refuses model-dependent work when no eligible healthy local model exists. Completion converts independent verifier results into accepted, repairable, escalated or terminal task states. Expired claims are fenced and restartable work returns to the executable frontier while non-restartable work blocks for reconciliation.

Category movement in this slice:
- Engineering Control Plane Core: 40% → 55%
- Portfolio Scheduler and Dynamic Lanes: 30% → 38%
- Verifier and Repair Fabric: 30% → 38%
- Local AI / Model Router: 28% → 32%
