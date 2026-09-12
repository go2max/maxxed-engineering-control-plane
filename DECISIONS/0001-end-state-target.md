# ADR 0001 — Build for the end-state control plane

Status: Accepted
Date: 2026-09-12

## Decision

Design the control plane directly for a 300x sustained owner-attention target and horizontal scalability beyond that, rather than building separate 10x/20x/50x architectures.

Intermediate leverage levels are operational checkpoints only.

## Consequences

- Core contracts cannot assume a fixed host/worker/model count.
- Scheduler, claims, verification and repair must scale horizontally.
- Backpressure and source-of-truth boundaries are foundational rather than later optimizations.
- Migration may proceed incrementally, but the target contracts remain stable across waves.
