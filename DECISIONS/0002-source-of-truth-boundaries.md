# ADR 0002 — Separate planning, execution and operator projections

Status: Accepted
Date: 2026-09-12

## Decision

Use this repository as strategic planning authority, product repositories/execution ledger as implementation and runtime truth, and Maxxed Admin as a protected projection/semantic-control surface.

Planning intent must never overwrite actual execution state, and Admin must not become an independently editable duplicate source of truth.

## Consequences

- Admin planning data is ingested by exact source SHA and cached.
- Live execution reconciliation is explicit.
- Conflicts surface as drift/degraded state rather than silent overwrite.
- Roadmap Queue remains idea/spec intake; approved architecture belongs here; executable work remains in canonical queues/issues.
