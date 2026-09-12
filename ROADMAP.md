# End-State Roadmap

The architecture targets the final 300x+ control plane from the beginning. The waves below are implementation/acceptance sequencing only; they are not separate redesigns.

## Wave 0 — Canonical contracts and source-of-truth boundaries

- planning manifest/schema;
- task and acceptance contracts;
- source-of-truth/ADR decisions;
- cost/capacity policy;
- throughput/leverage methodology;
- Admin planning-feed contract.

Exit: contracts are versioned, machine-readable and referenced by implementation work.

## Wave 1 — Durable control plane and portfolio graph

- normalized tasks/dependencies/blockers;
- claims, leases, fencing and resource locks;
- executable/blocked frontier;
- critical path and dependency-unlock computation;
- stable execution lineage.

Exit: dependencies and claims are deterministic; no manual state editing is needed for ordinary work.

## Wave 2 — Dynamic scheduling and heterogeneous capacity

- priority scorer over eligible work;
- host/worker capability advertisement;
- lane allocation;
- backpressure and starvation detection;
- Work Packet integration;
- explainable dispatch records.

Exit: available safe capacity fills without owner task assignment.

## Wave 3 — Verification and bounded repair fabric

- independent verifier role;
- failure taxonomy;
- repair-loop controller;
- circuit breakers;
- acceptance-tier routing;
- rollback/recovery evidence.

Exit: routine failures repair or terminate cleanly without blind retries.

## Wave 4 — Admin operator workhorse integration

- canonical roadmap projection (#883);
- leverage telemetry (#884);
- budget/capacity governance (#885);
- portfolio scheduler surfaces (#886);
- lane/critical-path/exception views;
- protected browser acceptance through existing Admin gates.

Exit: owner can operate the engineering factory from Admin by exception.

## Wave 5 — Product factories and shared-platform migration

- WordPress factory;
- Android factory;
- web/SaaS factory;
- static-site factory;
- Unity/game factory;
- shared SDK propagation and drift detection.

Exit: incremental products increasingly become configuration + domain logic rather than greenfield builds.

## Wave 6 — Self-maintenance and autonomous governance

- dependency maintenance;
- architecture drift detection;
- stale evidence/config detection;
- cleanup of dead branches/workflows;
- recurring security/recovery/governance checks;
- provider/host health-driven scheduling.

Exit: routine maintenance enters the same autonomous lifecycle as feature work.

## Wave 7 — Legacy retirement and terminal proof

- remove superseded schedulers/queues/duplicate state stores;
- retire manual reconciliation paths;
- chaos/failure drills;
- sustained workload proof;
- measured 100x/150x/300x checkpoint assessments without redesigning the architecture.

Exit: one canonical control plane remains, sustained accepted throughput is bottleneck-aware, and owner attention is exception-dominated.

## Planning estimate

Initial full-system estimate: roughly **1,025–1,650 conventional engineering-equivalent hours**, midpoint about **1,300h**. Real wall-clock completion depends primarily on safe parallelism, integration/migration proof and reliability hardening rather than raw coding time.
