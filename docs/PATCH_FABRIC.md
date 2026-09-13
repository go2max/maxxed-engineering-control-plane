# Patch Fabric / Micro-Lane Execution

## Purpose

Use every available PC/server for the smallest useful engineering unit instead of forcing one machine to own an entire issue. The objective is lower accepted cycle time, not maximal fragmentation.

## Parent flow

`parent task -> semantic dependency/mutation graph -> shard plan -> parallel micro-lanes -> targeted verification -> patch bundles -> conflict/composition gate -> parent integration verification -> one branch/PR`

## Shard boundaries

Prefer boundaries with low semantic coupling:
- function/class/symbol;
- route/controller/API handler;
- component/view;
- test file/suite;
- migration or codemod target group;
- package/module;
- independent documentation/config slice.

Do not shard by arbitrary line count. A 500-line mechanical mutation may be safer than two 30-line edits to coupled state machines.

## Shard admission

A shard must declare:
- parent task and shard ID;
- immutable base SHA;
- allowed file/symbol mutation scopes;
- forbidden scopes;
- before hashes;
- expected output;
- targeted acceptance checks;
- worker capability requirements;
- lease/fencing generation;
- estimated execution and coordination cost.

## Patch bundle

Workers return content-addressed evidence, not merge authority:

```text
parent_task_id
shard_id
base_sha
mutation_scopes
touched_symbols
before_hashes
after_hashes
unified_diff or bounded complete writes
targeted_test_results
worker_id
lease_generation
evidence_digest
optional_commit_sha
```

## Composer

The composer:
1. confirms the parent/base identity;
2. validates before hashes and mutation scopes;
3. constructs a conflict graph;
4. applies non-conflicting bundles to one integration worktree;
5. serializes explicitly ordered overlapping shards;
6. rejects stale/ambiguous bundles;
7. runs integration/parent acceptance;
8. creates one integration branch/PR.

## Conflict classes

- **textual** — overlapping hunks/lines;
- **resource** — same file/symbol/config key;
- **semantic** — separately valid patches violate an invariant together;
- **dependency** — one shard changes an API/schema assumed by another;
- **base drift** — repository changed since shard generation.

Textual merge success is not sufficient. Semantic/dependency conflicts require re-planning or re-verification.

## Adaptive shard sizing

Use measured cost:

`net_gain = predicted_serial_time - (max_parallel_shard_time + decomposition + transfer + composition + extra_verification)`

Shard only when net gain is positive with adequate confidence. Learn optimal granularity by task class, repository and worker capability.

## Worker specialization

Small/weak hosts are useful for:
- deterministic transforms;
- syntax/lint/unit slices;
- source indexing;
- test generation/verification;
- documentation/config updates;
- mechanical SDK adoption.

Strong hosts are reserved for:
- architecture/reasoning-heavy code;
- large context/model workloads;
- integration/browser/device verification;
- difficult repair/conflict resolution.

## Model-free lane

When a deterministic transform has already produced exact bounded writes against an immutable SHA, a worker may apply those writes without invoking a model, then independently verify, commit and publish under the normal lease/fencing contract.

## Speculative lanes

For high-value/high-risk/novel shards, two or more workers may produce alternatives. The verifier/composer selects the accepted candidate. Speculation is disabled when verifier capacity or compute budget is constrained.

## Failure recovery

Worker loss invalidates its lease generation. Unpublished patches from stale generations cannot become authoritative. Restartable shards requeue; uncertain external mutations reconcile before retry.

## Metrics

Track:
- parent accepted cycle time;
- shard execution P50/P95;
- decomposition/composition overhead;
- conflicts per 100 shards;
- stale-base rejection rate;
- targeted-check escape rate;
- full-test failures after shard success;
- accepted lines/symbols per worker-minute;
- weak-host utilization;
- net time saved versus serial execution.

## Rollout

1. deterministic same-pattern fan-out;
2. independent file/symbol shards;
3. dependency-aware multi-shard features;
4. speculative candidate lanes;
5. learned adaptive shard sizing.

Do not begin with arbitrary broad same-file parallel editing.
