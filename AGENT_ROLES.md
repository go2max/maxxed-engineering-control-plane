# Agent Roles and Authority

## Principle

Role separation reduces self-certification, limits blast radius and makes failures explainable. A role may be implemented by different models/providers over time; authority belongs to the role contract, not the vendor name.

## Portfolio planner

Responsibilities:
- consume canonical planning and execution state;
- decompose approved objectives into bounded dependency-aware work;
- identify reuse/product-factory opportunities;
- attach acceptance requirements and risk class.

Cannot:
- mutate production;
- bypass dependencies;
- mark work accepted.

## Scheduler

Responsibilities:
- compute executable frontier;
- rank eligible work;
- allocate lanes/capacity;
- apply WIP/backpressure;
- record dispatch explanation.

Cannot:
- declare blocked work eligible;
- override human/provider/safety gates.

## Implementer

Responsibilities:
- change only claimed scope in isolated workspace;
- run required focused local checks;
- produce bounded evidence and candidate artifact/PR.

Cannot:
- self-approve final acceptance for material work;
- expand scope silently;
- mutate unrelated repositories/resources.

## Verifier

Responsibilities:
- independently evaluate candidate against acceptance contract;
- classify failures;
- confirm provenance/artifact identity;
- emit structured pass/fail evidence.

Cannot:
- waive mandatory checks for convenience;
- convert unknown/not-run into pass.

## Repair agent

Responsibilities:
- consume classified failure and bounded evidence;
- apply a minimal repair within authorized scope;
- return candidate to the relevant verification boundary.

Cannot:
- retry indefinitely;
- broaden scope without scheduler/planner reclassification;
- bypass deterministic non-retryable failures.

## Release/deployment authority

Responsibilities:
- enforce merge/release/deploy policy;
- require exact accepted SHA/artifact;
- execute bounded canary/release/rollback workflows when authorized.

Cannot:
- infer approval from issue prose;
- bypass live provider/credential/human gates.

## Maintenance/governance agent

Responsibilities:
- dependency updates;
- architecture drift detection;
- stale policy/config detection;
- SDK propagation opportunities;
- dead branch/workflow cleanup proposals;
- recurring evidence checks.

Must route changes through the same acceptance and release rules as normal work.

## Model routing

Routing uses measured task-class success, latency, cost and capacity. High-cost reasoning is reserved for architecture/pathological debugging/review when it materially improves acceptance. Routine mechanical work should use lower-cost capable execution where evidence supports it.
