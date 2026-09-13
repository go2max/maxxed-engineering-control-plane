# Data Architecture

## PostgreSQL role

PostgreSQL is the durable control-plane state store, not the raw log/event firehose.

Store durable authoritative entities such as:
- tasks/work packets and normalized dependencies;
- claims, leases, fencing generations and resource locks;
- compact execution-attempt metadata;
- accepted-output records and intervention facts;
- policy/config versions;
- budget/capacity snapshots;
- planning-source provenance and reconciliation state;
- compact audit/transition history required for explainability;
- operator/automation command ledger and idempotency records;
- worker registrations, capability advertisements and last acknowledged lease state;
- durable outbox/reconciliation checkpoints required to recover interrupted transitions.

Do not store as hot relational rows:
- full build logs;
- model transcripts/prompts;
- large command outputs;
- screenshots/binaries;
- full provider payload archives;
- redundant GitHub repository content.

Use object/artifact storage for large evidence and retain compact checksummed references in PostgreSQL.

## Authority classes

Data is classified into two hard classes.

### Authoritative state
Required to prove ownership, acceptance or policy. Loss can affect correctness and therefore requires backup/restore guarantees. This includes tasks, claims, fences, command ledger, accepted evidence references and policy versions.

### Acceleration/derived state
Safe to delete and rebuild from authoritative/source data. This includes:
- solution CAS entries;
- artifact/build/test caches;
- semantic code indexes;
- context bundles;
- transform candidate indexes;
- repair similarity indexes;
- training/eval exports;
- dashboard projections/materializations.

Acceleration state may improve throughput but never extends leases, grants acceptance, changes policy or overrides source SHA. Recovery drills must prove the system remains safe when all acceleration state is removed.

## Content-addressed acceleration stores

Solution/artifact cache entries record content identity, source SHA/fingerprint, task/toolchain/policy/environment versions, created time, confidence, validation evidence reference and optional TTL. Cache corruption or incompatible identity produces a miss, never a best-effort hit.

Large cache payloads belong in local/object content-addressed storage with compact metadata indexes. Enforce disk quotas, eviction metrics, checksum verification and atomic writes.

## Patch Fabric data

A patch-shard record contains parent/shard IDs, immutable base SHA, mutation scopes, before/after hashes, patch/content digest, worker and fencing generation, targeted acceptance evidence and composition state.

Patch bundles are not accepted output until the composer verifies scope/base compatibility and the parent integration acceptance contract passes.

## Training/eval data

Trajectory harvesting stores sanitized derived records only. Persist provenance sufficient to revoke/regenerate training rows when source material, redaction policy or dataset schema changes. Training and held-out eval sets use versioned manifests and contamination checks.

## Queue and claiming patterns

- Prefer event-driven wake-up/dispatch.
- Durable jobs may be represented in PostgreSQL when appropriate.
- Claim with atomic transitions and lease/fencing protection.
- `FOR UPDATE SKIP LOCKED` is acceptable for bounded job-claim paths when consistent with the canonical scheduler.
- Never rely on `LISTEN/NOTIFY` as durable queue truth.
- Periodic reconciliation exists as a safety net, not the primary dispatch mechanism.
- Capacity advertisements are leases, not permanent truth; stale capacity can only reduce scheduling confidence, never expand concurrency.

## Transactional boundaries

Unsafe-to-split operations share one durable transaction or explicit outbox/inbox reconciliation. This includes claim+fence creation, attempt completion+acceptance evidence, ownership expiry/reissue, operator command+state transition, and durable events required by downstream projections.

A process crash after durable commit but before external side effect must be replayable using stable IDs. A crash before commit must not create authoritative state.

## Command ledger

Every semantic mutation uses a unique `command_id` with action, target/scope, normalized payload hash, state, resulting transition/event IDs, timestamps and compact result/error metadata. Duplicate identical IDs return the prior result; conflicting reuse is rejected.

## Lease/fencing durability

A claim records task/work-packet ID, attempt ID, worker identity, expiry, fencing generation/token, resource scope and timestamps. Completion writes include the current fence predicate; stale generations update zero authoritative rows.

## Local recovery outbox

Workers may keep a bounded append-only evidence spool while durable state is unavailable. The spool cannot extend a lease. Replay is authoritative only when current ownership/fencing is re-proven; otherwise material remains diagnostic evidence.

## Efficiency and local-first durability

Use typed hot fields, bounded history, partial indexes, batching, pooling, materialized rollups and cold archival as justified. The default deployment must work against locally controlled PostgreSQL. Hosted PostgreSQL remains replaceable and cannot be required for queue correctness or recovery.

Backups use verified restorable snapshots plus WAL/PITR where supported. Recovery is complete only after restore drills prove task/claim/fence/command invariants and after acceleration stores can be rebuilt independently.

## Budget constraint

If hosted PostgreSQL such as Neon is used, the initial target remains <= $40/month. Approaching the limit triggers an architecture/query/storage-amplification review before capacity upgrades.

## Data states

Every projected operational dataset exposes source, as-of time and one of:

`CURRENT | STALE | PARTIAL | UNKNOWN | ERROR`

Stale data cannot remain visually healthy indefinitely.
