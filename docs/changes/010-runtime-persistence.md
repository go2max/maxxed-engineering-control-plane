# PR 010 — Restart-safe runtime persistence

Adds atomic local control-plane snapshots for the task graph, claim fencing generations, and verifier/repair budgets.

Safety rules:
- active claims are never restored after restart;
- claim generations are restored, so stale pre-restart claim tokens cannot regain authority;
- restartable claimed tasks return to READY;
- non-restartable claimed tasks become BLOCKED for reconciliation;
- task lineage survives restart;
- repair attempts and circuit-breaker state survive restart.

Category movement:
- Engineering Control Plane Core: 55% → 68%
- Verifier and Repair Fabric: 38% → 42%
