# Data Architecture

## PostgreSQL role

PostgreSQL is the durable control-plane state store, not the raw log/event firehose.

Store durable entities such as:
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

## Queue and claiming patterns

- Prefer event-driven wake-up/dispatch.
- Durable jobs may be represented in PostgreSQL when appropriate.
- Claim with atomic transitions and lease/fencing protection.
- `FOR UPDATE SKIP LOCKED` is acceptable for bounded job-claim paths when consistent with the canonical scheduler.
- Never rely on `LISTEN/NOTIFY` as durable queue truth.
- Periodic reconciliation exists as a safety net, not the primary dispatch mechanism.
- Capacity advertisements are leases, not permanent truth; stale capacity can only reduce scheduling confidence, never expand concurrency.

## Transactional boundaries

Operations that would become unsafe if split across failures must share one durable transaction or use an explicit outbox/inbox reconciliation pattern. This includes:
- assigning a task and creating its lease/fencing generation;
- completing an attempt and recording acceptance/verification evidence;
- expiring/reissuing ownership;
- recording an operator command and its resulting state transition;
- emitting durable events that downstream projections depend upon.

A process crash between database commit and external side effect must be recoverable by replay using stable identifiers. A crash before commit must not produce authoritative state.

## Command ledger

Every semantic mutation uses a unique `command_id`.

The ledger stores:
- `command_id` unique key;
- action;
- target/scope;
- normalized payload hash;
- state (`RECEIVED | EXECUTING | SUCCEEDED | FAILED | RECONCILING`);
- resulting transition/event identifiers;
- timestamps and compact error/result metadata.

Duplicate identical command IDs return the prior result. Reuse of a command ID with a different payload is rejected.

## Lease and fencing durability

A claim row includes at minimum:
- task/work-packet ID;
- attempt ID;
- worker/host identity;
- lease expiry;
- fencing generation/token;
- resource-lock scope;
- created/renewed timestamps.

Completion/update writes include the current fencing token in their predicate. A stale generation must update zero authoritative rows and be treated as superseded evidence, not success.

## Local recovery outbox

Workers may maintain a bounded local append-only spool for evidence produced while durable state is temporarily unavailable. Each record includes task ID, attempt ID, fencing generation, artifact checksums, created time and replay state.

The spool is not queue truth and cannot extend a lease. On reconnect, replay is accepted only after the controller proves that ownership/fencing is still current. Otherwise the material is retained as non-authoritative diagnostic/recovery evidence.

## Efficiency rules

- typed columns for hot scheduler fields;
- JSONB only for justified flexible metadata;
- partial indexes over active/eligible states;
- partition append-heavy history when evidence shows benefit;
- connection pooling;
- prepared/parameterized queries;
- targeted projections instead of `SELECT *`;
- batched low-priority writes;
- daily/monthly materialized rollups for dashboards;
- cold-history archival after retention thresholds;
- bounded history and explicit retention policy.

## Local-first durability

The default architecture must be capable of running against a locally controlled PostgreSQL instance without relying on a paid hosted database. Hosted PostgreSQL may be supported as a replaceable deployment adapter, but it cannot be required for queue correctness, worker recovery or operator command semantics.

Backups use verified, restorable snapshots plus WAL/point-in-time recovery where supported. Recovery is not considered complete until a restore drill proves that active-task, claim, lease, fencing and command-ledger invariants survive restoration.

## Budget constraint

If a hosted PostgreSQL deployment such as Neon is used, the initial target remains <= $40/month.

Approaching the limit is an architecture/performance alert. Default response is to identify query/storage amplification before upgrading capacity.

## Data states

Every projected operational dataset exposes source, as-of time and one of:

`CURRENT | STALE | PARTIAL | UNKNOWN | ERROR`

Stale data cannot remain visually healthy indefinitely.
