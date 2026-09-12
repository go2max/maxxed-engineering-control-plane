# Lane and Concurrency Model

## Goal

Safely maximize accepted throughput by keeping independent work moving while preventing conflicting mutations, overloaded verification, and owner-driven task feeding.

## Lane classes

- planning/decomposition;
- implementation;
- verification;
- repair;
- release/deployment;
- maintenance/governance.

A host may serve multiple classes if capacity and policy allow, but the scheduler treats class capacity separately so implementation cannot overwhelm verification or repair.

## Claim contract

Every mutating lane owns:
- task/work-packet ID;
- repository;
- bounded scope/resource lock;
- isolated workspace identity;
- base SHA;
- branch;
- lease generation/fencing token;
- worker identity;
- risk class;
- expected validation tier;
- lease expiry/heartbeat metadata.

Conflicting scopes cannot hold simultaneous write claims.

## Scheduling rules

1. Eligibility is computed before priority.
2. Blocked high-priority work does not occupy a lane.
3. Idle capacity immediately considers the next eligible task.
4. Scheduler considers downstream verification/repair capacity before starting more implementation.
5. Work Packets are preferred for tightly related same-repo low/medium-risk work when canonical eligibility permits.
6. Human/provider-blocked tasks release execution capacity while preserving state/evidence.
7. Host loss or stale heartbeat stops new claims and triggers reconciliation.
8. Safe in-progress mutations are checkpointed/drained rather than abruptly preempted for reprioritization.
9. Production deployment remains serialized unless explicitly changed by ADR/policy.

## Horizontal scaling

No contract assumes one host, fixed worker count or single model provider. Capacity is discovered and advertised by workers/hosts and selected by policy.

## Backpressure signals

Reduce new implementation starts when:
- verification queue age exceeds target;
- repair queue grows beyond target;
- first-pass acceptance deteriorates;
- host pressure approaches limits;
- downstream provider capacity is degraded;
- merge/release queues exceed policy limits.

## Explainability

Every dispatch records why the task was eligible, why it ranked above alternatives, why the selected lane was compatible and which policy/capacity constraints affected the decision.
