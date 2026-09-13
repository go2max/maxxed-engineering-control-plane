# End-State Architecture

## Logical flow

`Planning authority -> portfolio graph -> leverage engine -> decomposition/mutation-scope planner -> eligibility/priority -> capacity broker -> task or micro-lanes -> isolated execution -> verification -> repair/reconciliation -> patch composition -> acceptance -> PR/release -> production verification -> telemetry/outcome harvest -> cache/training/scheduler feedback`

Maxxed Admin is the protected operator surface over this loop. It never becomes a second execution authority.

## Major components

### 1. Planning authority
Versioned architecture intent, roadmap milestones, ADRs, budget/capacity policy, leverage targets and cross-repo dependencies are projected into Admin by exact source SHA.

### 2. Portfolio and semantic graphs
The portfolio graph models products, repositories, dependencies, blockers, risk and critical path. The semantic code graph models files, symbols, imports/references/calls/tests and product-family relationships so tasks receive a bounded dependency slice instead of rediscovering entire repositories.

### 3. Leverage engine
Before allocating reasoning capacity, classify work in this order:
1. exact content-addressed reuse;
2. deterministic transform/codemod;
3. retrieval-assisted execution using accepted solutions or repair memory;
4. novel model reasoning.

Exact reuse requires immutable source identity plus compatible task, policy and environment fingerprints. Cache entries never override acceptance or source truth.

### 4. Eligibility, priority and capacity
Eligibility remains authoritative. Priority ranks only eligible work. The capacity broker accounts for CPU/RAM/disk, worker/model capability, host pressure, mutation scopes, expected duration, verification capacity, repair backlog and speculative-work budget.

### 5. Decomposition and Patch Fabric
Large work may be decomposed into micro-shards at file/symbol/component/package scope when the expected execution-time savings exceed decomposition, transfer, composition and verification cost. Each shard is bound to an immutable base SHA, non-overlapping mutation scopes and a bounded acceptance contract. See `docs/PATCH_FABRIC.md`.

### 6. Execution fabric
Mutations execute in isolated worktrees/workspaces. Coding workers are bounded to workspace reads/writes and approved verification commands. Deterministic transforms may use model-free precomputed writes. Claims, leases, generations/fencing and resource locks prevent stale or conflicting writers.

### 7. Verification and repair
Implementation never self-certifies. Targeted shard checks precede composition; composed branches receive broader integration verification. Failures are fingerprinted, repair memory is consulted, bounded repair tasks are generated, and uncertain external state requires reconciliation.

### 8. Safe composition and promotion
Workers return evidence-rich task branches or patch bundles, not direct `main` writes. A composer verifies base hashes, mutation scopes, conflicts and acceptance evidence before producing one integration branch/PR. Repository policy remains the final merge authority.

### 9. Product-family factory
Shared foundations are versioned once. New products and broad changes are expressed as product-specific deltas. Portfolio maintenance can fan a known deterministic transform across many repositories in bounded batches.

### 10. Outcome-learning loop
Accepted and rejected trajectories, repair results, model outcomes and artifacts are sanitized and retained. They feed solution CAS, repair memory, held-out evals and future specialist training. Training data never becomes acceptance authority.

### 11. Replay and fail-safe operations
Durable event history reconstructs task/claim/acceptance projections. No individual host, runner, model, provider or Admin instance is required for safe progress. Loss of capability contracts available work rather than corrupting authority.

## Backpressure

New reasoning/implementation starts contract when verification, composition, repair, merge or production-verification queues saturate. Micro-sharding is disabled when coordination overhead exceeds predicted savings. Speculative fan-out is budgeted by available capacity and verifier headroom.

## Source-of-truth hierarchy

1. Product repository + accepted SHA/PR/release evidence for implementation truth.
2. Claim/fencing/event ledger for execution authority.
3. Planning repository for strategic intent and policy.
4. Admin as derived projection and bounded-control surface.
5. Solution/artifact caches, semantic indexes and training corpora as disposable/rebuildable acceleration layers.

Conflicts are surfaced explicitly; no optimization layer silently overwrites an authoritative layer.
