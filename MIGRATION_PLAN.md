# Migration Plan

## Objective

Replace the current fragmented automation incrementally without running permanent duplicate schedulers or risking working production paths.

## Rules

1. Inventory and identify canonical owner before replacing a subsystem.
2. Introduce compatibility adapters only when they have a deletion condition.
3. Shadow-read/compare new projections before granting write authority.
4. Move one semantic authority at a time: planning -> eligibility -> claims -> scheduling -> verification/repair -> acceptance -> release integration.
5. Preserve exact rollback to the prior accepted authority during each cutover.
6. Do not maintain two writable sources of truth.
7. Remove superseded code/workflows after acceptance rather than leaving indefinite fallback paths.

## Cutover sequence

### A. Planning
Adopt this repository as canonical strategic planning source and project it read-only into Admin.

### B. Data model
Map existing queue/task/claim state into the versioned canonical contracts. Reconcile contradictions before enabling new writes.

### C. Eligibility and dependency graph
Run new eligibility in comparison mode, prove it does not lease blocked work, then make it authoritative.

### D. Claims/leases
Migrate to one fencing/resource-lock implementation. Drain existing claims before switching conflicting scope authority.

### E. Scheduler
Enable portfolio scheduling over the canonical eligible frontier. Preserve current WIP/deploy/human gates.

### F. Verification/repair
Route existing validation through structured acceptance and failure classification. Introduce bounded repair after failure fingerprints are reliable.

### G. Admin
Move roadmap, lane, leverage and budget views onto canonical projections; eliminate raw/manual reconciliation escape hatches under existing Admin issues.

### H. Product factories
Migrate product families opportunistically after shared contracts are stable. Do not block core control-plane completion on every product migration.

### I. Retirement
Delete superseded queue/scheduler adapters, duplicate state tables, obsolete workflows, temporary migration code and stale documentation only after rollback windows/evidence requirements are satisfied.

## Migration acceptance

Every authority cutover requires:
- old/new behavior comparison;
- explicit owner/source transition;
- rollback path;
- no unexplained active claims;
- no duplicate dispatch;
- state reconciliation evidence;
- required browser/operator evidence where Admin is affected.
