# ADR 0004 — Patch Fabric Authority

## Status
Accepted.

## Decision
Large eligible coding tasks may be decomposed into micro-shards executed concurrently across available workers. Workers never merge directly and never mutate `main`.

The Patch Fabric controller is the sole composition authority for one parent task.

Each shard is bound to:
- exact repository base SHA;
- parent and shard keys;
- declared file/symbol/resource scope;
- worker identity and fencing generation;
- before/after content hashes;
- targeted verification evidence.

## Composition rules
- stale source or fencing generations fail closed;
- out-of-scope mutations fail at the worker boundary;
- textual, resource or semantic conflicts block composition;
- every shard result is content-addressed and immutable;
- the composer reconstructs and verifies base content from shard evidence;
- one integration task applies the composed output and executes the parent acceptance contract;
- only the accepted parent may be promoted to a PR.

## Scheduling rule
Micro-sharding is used only when measured/projected parallel savings exceed decomposition, transfer, composition and verification overhead and when downstream verifier/composer capacity is available.

Critical/destructive/release/payment/migration work remains single-lane unless a later explicit policy permits a safer decomposition class.

## Consequence
Available PCs and servers can perform very small bounded pieces of work without turning GitHub branches or PRs into the composition mechanism and without allowing worker loss, retries or stale patches to corrupt the parent result.
