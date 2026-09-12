# Completion Tracking

The engineering platform is tracked by category in `planning/completion-tracker.json`.

## Rules

1. `completion_pct` measures implemented and accepted scope against the category's defined end state. Architecture-only work does not count as implementation completion.
2. A category remains visible at 100% until it has survived two independent validation passes.
3. `validation_passes` increments only after an executable or production-representative validation pass completes without reopening required work.
4. `clear_eligible` becomes true only when `completion_pct == 100` and `validation_passes >= 2`.
5. Clearing a row means removing it from the active progress report, not deleting its historical evidence. Retired categories remain reconstructable from Git history and program issue #2.
6. Any regression after retirement reopens the category and resets `clear_eligible` to false until the regression is repaired and revalidated.

## Active categories

- Local Compute Fabric
- Engineering Control Plane Core
- Portfolio Scheduler and Dynamic Lanes
- Verifier and Repair Fabric
- Local AI / Model Router
- Maxxed Admin Operator Integration
- SaaS / Web Product Factory

Every implementation PR that materially changes one of these areas must update the tracker in the same PR or in the immediately following bookkeeping PR.
