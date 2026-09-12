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
- compact audit/transition history required for explainability.

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

## Neon budget constraint

Initial target: engineering-platform PostgreSQL spend <= $40/month.

Approaching the limit is an architecture/performance alert. Default response is to identify query/storage amplification before upgrading capacity.

## Data states

Every projected operational dataset exposes source, as-of time and one of:

`CURRENT | STALE | PARTIAL | UNKNOWN | ERROR`

Stale data cannot remain visually healthy indefinitely.
