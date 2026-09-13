# ADR 0005 — Acceleration State Is Non-Authoritative

## Status
Accepted.

## Decision
Solution caches, artifact caches, semantic indexes, embeddings, training/eval exports, repair similarity memory and model-routing statistics are acceleration state. They may improve speed, cost or quality but never determine authoritative task ownership, acceptance, deployment or policy state by themselves.

Authoritative state remains:
- canonical task graph and dependencies;
- claims, leases and fencing generations;
- Patch Fabric session/composition state while active;
- verification/acceptance evidence;
- operator command/idempotency ledger;
- repository commits/PRs/releases according to repository policy.

## Recovery invariant
The platform must remain correct if all acceleration stores are deleted. Missing acceleration data causes cache misses, re-indexing or fresh reasoning—not false acceptance or loss of ownership truth.

Every acceleration object must therefore be attributable to immutable source/provenance where applicable and safe to regenerate from canonical evidence.

## Executable proof
`DerivedStateManager.disposabilityDrill()` is the executable recovery proof for this invariant. It:

1. fingerprints the authoritative runtime snapshot with volatile capture time removed;
2. snapshots acceleration state;
3. wipes solution/artifact caches, semantic graph, trajectory/training state and repair memory;
4. verifies the authoritative fingerprint is byte-semantically unchanged;
5. rebuilds reconstructable solution/trajectory/repair state from accepted authoritative task evidence;
6. verifies the authoritative fingerprint again;
7. optionally restores the original acceleration snapshot and verifies authority a third time.

The drill fails closed if reset, rebuild or restore mutates authoritative runtime state. Source indexes and disposable artifact caches are deliberately reported as requiring source re-indexing/artifact regeneration rather than being fabricated from incomplete runtime evidence.

This drill is non-destructive by default (`restoreAfter: true`) and is suitable for recurring recovery validation. A destructive recovery exercise may set `restoreAfter: false` to leave only regenerated state behind.

## Training boundary
Harvested trajectories and eval data are sanitized derivatives. Removing/revoking a source must prevent future training export while preserving compact audit lineage that the source was revoked.

## Consequence
Performance optimizations can evolve aggressively without turning an index/cache/model into a hidden second control plane.
