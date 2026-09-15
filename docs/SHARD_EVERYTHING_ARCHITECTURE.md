# Shard-Everything Architecture

## Purpose

Make every meaningful engineering operation **measurable, decomposable, attributable, independently verifiable and economically accountable** at the smallest useful unit, without forcing pathological decomposition where coordination overhead exceeds value.

The goal is not "split every function into tiny jobs." The goal is:

`everything can be represented as an atomic work unit or recursively decomposed into work units with explicit boundaries, clocks, cost, evidence and composition semantics.`

This document extends `docs/OPEN_ENDED_LEVERAGE_ARCHITECTURE.md`, `docs/100K_LEVERAGE_ARCHITECTURE.md`, `docs/PATCH_FABRIC.md` and `THROUGHPUT_MODEL.md`.

## Core rule

Every operation must be one of:

1. **Atomic** — already below the useful decomposition threshold.
2. **Shardable** — can be decomposed into independently executable/observable children.
3. **Composite-only** — cannot be safely accepted from child evidence alone and therefore requires parent-level composition verification.
4. **Serial authority operation** — must remain singular because splitting authority would violate correctness, security or policy.

This prevents "shard everything" from becoming "parallelize everything." Measurement and decomposition are universal; parallel execution is conditional.

## Why sharding improves metric truth

Smaller work units make attribution much better, but granularity alone does not make metrics true. Truth requires:

- immutable event IDs and shard IDs;
- exact source SHA / artifact digest / policy version;
- monotonic clocks for durations;
- wall-clock timestamps for correlation;
- explicit observed vs derived vs modeled provenance;
- idempotent/replay-safe event ingestion;
- separate queue, dependency, execution, verification, repair, composition, merge and deployment timing;
- explicit cost attribution;
- no output credit before independent acceptance.

Use milliseconds for human-facing reporting and monotonic nanoseconds internally where the runtime supports them. Never infer causality from wall-clock ordering alone.

## Universal shard envelope

Every shard should converge on a common envelope:

```yaml
schema: maxxed.engineering.shard.v1
id: shard-id
parent_id: optional-parent
root_id: program-or-task-root
kind: code|test|build|verify|repair|compose|merge|deploy|data|cost|policy|research
objective: bounded objective
source_identity:
  repository: owner/repo
  sha: 40-char-sha
policy_version: version
risk_class: low|medium|high|critical
mutation_scope:
  files: []
  symbols: []
  packages: []
depends_on: []
execution:
  capability_requirements: []
  model_class: optional
  max_context_tokens: optional
  max_tool_calls: optional
  max_runtime_ms: optional
  max_cost_usd: optional
acceptance:
  contract_ref: ref
  independent_verifier: true
  evidence_required: []
economics:
  expected_cost_usd: null
  expected_human_equivalent_ms: null
  expected_future_work_avoided_ms: null
rollback:
  strategy_ref: ref
telemetry:
  trace_id: trace
  span_id: span
```

## What can be sharded

### Planning
- intent normalization;
- capability lookup;
- reuse lookup;
- dependency discovery;
- risk classification;
- cost estimation;
- decomposition candidate generation;
- decomposition evaluation.

### Context
- symbol retrieval;
- dependency slice retrieval;
- contract retrieval;
- historical repair retrieval;
- policy retrieval;
- documentation retrieval;
- context compression and ranking.

### Implementation
- file/symbol/package mutations;
- generated artifacts;
- codemods;
- migrations;
- dependency upgrades;
- configuration changes;
- documentation changes.

### Verification
- syntax;
- type checking;
- static analysis;
- focused tests;
- contract tests;
- security review;
- authorization review;
- cost review;
- performance review;
- migration review;
- accessibility review;
- provenance review;
- mutation testing;
- fuzz testing.

### Composition
- patch merge;
- semantic-conflict analysis;
- interaction tests;
- cost aggregation;
- artifact composition;
- release-candidate construction.

### Release and operations
- canary cohorts;
- product-family rollout batches;
- post-deploy probes;
- rollback scopes;
- metric comparison windows.

### Control-plane self-improvement
- scheduler candidate;
- context strategy candidate;
- model routing candidate;
- verifier policy candidate;
- transform candidate;
- cache policy candidate;
- sharding-policy candidate.

## What should usually remain atomic or serial

Examples:

- final authority to mark a release accepted;
- final source-of-truth mutation when policy requires serialization;
- cryptographic signing with a singular protected key authority;
- non-idempotent external operations that cannot be safely partitioned;
- tiny deterministic transforms where decomposition costs more than execution;
- parent integration acceptance when child evidence cannot prove interactions.

Atomic does not mean unmeasured. Atomic units still receive the same timing, evidence and economic envelope.

## Dynamic shard sizing

Shard size is a learned control variable, not a constant.

A candidate size should be selected from:

- executor/model observed reliability on the task class;
- semantic dependency width;
- mutation-scope size;
- risk/blast radius;
- expected verifier cost;
- expected conflict probability;
- context budget;
- tool-call budget;
- historical repair rate;
- coordination overhead;
- current fleet/verifier saturation.

Conceptually:

`optimal_shard_size = argmax(expected accepted value - execution cost - verifier cost - coordination cost - rework risk)`

Stronger reasoning models may receive larger coherent shards; deterministic transforms may safely operate over very large fan-out sets; high-risk changes may be deliberately split smaller even when a model could handle more.

## High-resolution timing model

Every shard lifecycle should expose at least:

- `created_wall_ms`
- `ready_wall_ms`
- `claimed_wall_ms`
- `execution_started_wall_ms`
- `first_output_wall_ms`
- `execution_completed_wall_ms`
- `verification_started_wall_ms`
- `verification_completed_wall_ms`
- `composition_started_wall_ms`
- `composition_completed_wall_ms`
- `accepted_wall_ms`

and monotonic counterparts where events occur within the same runtime/process boundary.

Derived durations:

- intake/decomposition time;
- dependency wait;
- ready queue wait;
- claim/dispatch delay;
- execution time;
- time to first output;
- verifier wait;
- verifier execution;
- repair delay;
- composition wait;
- composition execution;
- merge/deploy wait;
- total accepted cycle time.

The canonical measurement rule is: **store observations; derive durations from observations; label any estimate/model as such.**

## Truth grades

Every metric should carry a truth grade:

- **OBSERVED** — directly measured from authoritative event boundaries.
- **DERIVED** — deterministic arithmetic over observed values.
- **PROXY** — measured substitute for a unavailable quantity.
- **MODELED** — forecast/estimate.

Never aggregate modeled values into a number labeled as observed.

## Shard economics

Every shard should be able to record:

- model input/output/cached tokens;
- model price/version;
- CPU/GPU time;
- runner time;
- storage and artifact bytes;
- DB reads/writes/rows/egress when attributable;
- API calls;
- verifier cost;
- failed/speculative candidate cost;
- owner intervention time;
- human-equivalent accepted work;
- expected future work avoided from newly-created automation capital.

This enables:

`cost_per_accepted_shard`

`cost_per_accepted_capability`

`accepted_value_per_compute_dollar`

`accepted_value_per_owner_ms`

`reasoning_cost_avoided`

## Merge Integrity & Economic Safety sector

Treat merge/economic safety as an independent verification sector.

Required review lenses can themselves run as shards:

- functional interaction;
- semantic conflict;
- API/schema compatibility;
- security/authorization;
- build/package;
- performance;
- DB/query-plan;
- recurring-job/frequency amplification;
- model/token spend;
- storage/egress;
- CI/build cost;
- release blast radius;
- rollback readiness.

No cost-affecting merge is accepted solely because functional tests pass.

### Economic amplification rule

For recurring operations measure the multiplier explicitly:

`monthly_cost_impact = cost_per_execution * executions_per_month * fanout * retry_multiplier`

This catches small diffs that create large bills through polling, retries, logging, scheduled jobs, fan-out or database scans.

## Composition tree and automatic bisection

Compose shards as a tree rather than a flat mega-merge. Intermediate nodes are independently observable and testable.

If a composition fails, automatically reduce the failure set:

1. split candidate shard set;
2. test halves/interactions;
3. continue until the minimum failing shard or shard combination is isolated;
4. persist the minimized counterexample as repair/evaluation data.

This combines merge-queue batch bisection with property-testing style failure shrinking.

## Affected-only validation

Use semantic dependency/impact graphs to determine which validators and products are affected by a shard. Run the narrowest justified suite first, then continuously challenge the impact selector with randomized/full-suite checks.

Impact selection may reduce cost; it may never weaken acceptance truth. If challenge tests expose missed impact, downgrade the selector and expand coverage.

## Proof-carrying shards

Accepted shards produce a reusable certificate binding:

- source SHA;
- mutation digest;
- environment/toolchain fingerprint;
- policy version;
- executor identity/class;
- scope;
- tests/checks and outcomes;
- verifier identity;
- cost evidence;
- dependency impact;
- rollback metadata;
- artifact digests.

Reusable deterministic certificate components may skip repeated work only when all immutable compatibility dimensions still match. Parent composition still executes checks required to prove interactions.

## Speculative shard racing

Multiple candidate paths are allowed only where expected value exceeds added compute and verifier load. Typical race:

- exact prior solution candidate;
- deterministic transform;
- specialist/commodity model;
- frontier model.

The first independently accepted candidate wins; stale candidates are cancelled. Rejected candidates are cost, never output credit.

## Failure frontier and checkpoints

Persist checkpoints and the failure frontier so replacement workers do not rediscover known facts. A resumable shard stores:

- completed deterministic steps;
- inspected dependencies;
- rejected hypotheses;
- error fingerprints;
- accepted intermediate artifacts;
- unresolved hypotheses;
- next allowed actions.

Workers remain disposable; state does not.

## Early implementation order

1. shard lifecycle telemetry with monotonic timing and truth grades;
2. shard economics envelope and cost aggregation;
3. shard-level evidence certificate schema;
4. semantic affected-set selection;
5. composition-tree telemetry and failure bisection;
6. merge economic-safety lenses;
7. adaptive shard-sizing policy;
8. checkpoint/failure-frontier persistence;
9. speculative racing with expected-value gate;
10. learned decomposition/shard sizing from accepted outcomes.

## Prior-art patterns to adopt, not authorities to copy

Useful reference classes identified in the GitHub sweep:

- Bazel/Buck2/Nx: dependency/critical-path and affected-only execution;
- Dagger/Turborepo/Nix: typed/content-addressed/reproducible execution and cache identity;
- Bors-style merge queues: staged batches and automatic bisection;
- Temporal/DBOS/LangGraph: durable checkpoints and resumable workflows;
- Infracost/OpenCost: pre-change cost deltas and runtime cost attribution;
- OPA: declarative policy authority;
- Lean/formal tools: probabilistic search behind deterministic proof boundaries;
- Hypothesis/QuickCheck: property generation and minimal counterexample shrinking;
- OSS-Fuzz/chaos systems: continuous adversarial execution;
- Wasmtime/WASI/microVM systems: dense isolated workers.

Adopt patterns through Maxxed-owned contracts and adapters. None becomes a competing source of truth.

## Anti-gaming rules

- More shards do not create more leverage credit by themselves.
- Child tracker/coordination tasks produce no accepted-output credit.
- Millisecond/nanosecond precision is not labeled accuracy unless clocks/events are authoritative.
- Replayed/duplicate events do not double-count.
- Failed and speculative shards count toward cost, not output.
- Parent output is counted once unless derivative products independently satisfy real acceptance contracts and represent real human-equivalent work.
- No metric may silently mix observed and modeled data.

## Desired end state

An engineering objective of arbitrary size becomes a durable graph of atomic or shardable units. Every unit has exact identity, attributable timing, cost, evidence and outcome. The system continuously learns the economically optimal decomposition and executor for each class of work while independent composition verification preserves correctness.

The long-term target is not maximal shard count. It is **maximal accepted value per owner-attention millisecond and resource dollar, with minimal net complexity and no fixed leverage ceiling**.
