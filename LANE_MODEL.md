# Lane and Concurrency Model

## Goal

Maximize accepted throughput by assigning every available machine the smallest useful unit of work it can complete safely, while preventing conflicting mutations and downstream verification debt.

## Lane classes

- planning/decomposition;
- implementation task lanes;
- micro-lane / patch-shard execution;
- deterministic transform lanes;
- verification;
- repair/reconciliation;
- patch composition/integration;
- release/deployment;
- maintenance/governance.

A host may serve multiple classes, but class capacity is tracked separately so implementation cannot overwhelm verification, repair or composition.

## Task lane vs micro-lane

A task lane owns an entire bounded coding task. A micro-lane owns a small mutation shard: typically one symbol, file cluster, route, component, test slice, migration subset or codemod target set.

Micro-sharding is allowed only when:
- the base source is an immutable SHA;
- mutation scopes can be made non-overlapping or explicitly ordered;
- expected parallel speedup exceeds decomposition/composition overhead;
- targeted verification exists;
- the final composed branch can still run the parent acceptance contract.

Line count is an observation, not the decomposition boundary. Symbol/dependency/mutation scope is authoritative.

## Claim contract

Every mutating lane owns:
- parent task and optional shard ID;
- repository/product;
- immutable base SHA;
- bounded file/symbol/resource mutation scopes;
- before hashes for mutated resources;
- isolated workspace/worktree;
- branch or patch-bundle identity;
- lease generation/fencing token;
- worker identity/capabilities;
- risk and validation tier;
- expiry/heartbeat metadata.

Conflicting mutation scopes cannot hold simultaneous write claims unless the composition plan explicitly serializes them.

## Patch bundle contract

A micro-lane returns a content-addressed bundle containing at minimum:
- parent/shard IDs;
- base SHA;
- touched files/symbols;
- before/after hashes;
- diff or complete bounded writes;
- targeted verification evidence;
- worker/lease generation;
- evidence digest;
- optional commit SHA.

A shard never independently merges to `main`.

## Composition rules

1. Verify every patch against the same intended base or an explicitly rebased compatible state.
2. Reject stale before-hashes.
3. Reject writes outside declared mutation scopes.
4. Detect textual and semantic conflicts before integration.
5. Apply compatible patches to one integration worktree/branch.
6. Run parent-level integration acceptance after composition.
7. Produce one parent PR whenever practical; shard PR explosion is an anti-pattern.

## Scheduling rules

1. Eligibility before priority.
2. Reuse/transform before fresh reasoning.
3. Blocked work releases capacity.
4. Idle weak hosts may receive small deterministic/test/indexing shards while stronger hosts handle reasoning-heavy work.
5. Downstream verification/composition capacity constrains shard fan-out.
6. Speculative duplicate solutions are reserved for high-value/high-risk/novel work and are budgeted explicitly.
7. Host loss fences its generation and requeues restartable shards.
8. Production deployment remains serialized unless policy explicitly changes it.

## Adaptive shard sizing

The scheduler should learn shard size from observed:
- decomposition time;
- transfer/checkout time;
- execution duration;
- conflict/rejection rate;
- composition duration;
- targeted/full verification duration;
- worker capability and current pressure.

Target the smallest shard that materially reduces end-to-end accepted cycle time. Do not split 20 seconds of work into 15 seconds of coordination.

## Backpressure

Contract new work or reduce shard fan-out when verification backlog, composition conflicts, repair rate, host pressure, merge queue or production verification deteriorate. Accepted throughput is the objective; raw lane count is not.
