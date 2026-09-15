# Agent Roles and Authority

## Principle

Role separation reduces self-certification, limits blast radius and makes failures explainable. A role may be implemented by different models/providers over time; authority belongs to the role contract, not the vendor name.

## Agent execution order

AI agents are not the first execution path for repeatable work. For every eligible work packet, the control plane should attempt:

1. exact accepted reuse;
2. deterministic transform;
3. retrieval-assisted execution with compiled minimal context;
4. bounded novel reasoning;
5. speculative candidate fan-out only when expected value justifies verifier cost.

Every agent receives a typed work packet containing objective, immutable source identity, capability/product-family context, mutation scope, dependencies, policy version, risk class, acceptance requirements, rollback requirements and evidence requirements. Agents should not spend tokens rediscovering facts the control plane can provide deterministically.

## Portfolio planner

Responsibilities:
- consume canonical planning and execution state;
- decompose approved objectives into bounded dependency-aware work;
- identify reuse/product-factory opportunities;
- attach acceptance requirements and risk class;
- minimize novel reasoning by selecting the cheapest safe execution path;
- generate work packets with explicit mutation scope and dependency context.

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
- record dispatch explanation;
- account for verifier/repair/composition capacity before increasing implementation fan-out;
- prefer disjoint semantic mutation scopes over repository-wide serialization.

Cannot:
- declare blocked work eligible;
- override human/provider/safety gates.

## Implementer

Responsibilities:
- change only claimed scope in isolated workspace;
- run required focused local checks;
- produce bounded evidence and candidate artifact/PR;
- consume compiled minimal context and prior accepted repair/reuse evidence where supplied;
- preserve generated-artifact provenance and regeneration rules.

Cannot:
- self-approve final acceptance for material work;
- expand scope silently;
- mutate unrelated repositories/resources;
- edit generated artifacts directly when a canonical producer exists.

## Verifier

Responsibilities:
- independently evaluate candidate against acceptance contract;
- classify failures;
- confirm provenance/artifact identity;
- emit structured pass/fail evidence;
- challenge impact-selected validation with periodic broader/full-suite checks;
- detect evidence that is missing, self-reported, stale, or bound to the wrong source/artifact identity.

Cannot:
- waive mandatory checks for convenience;
- convert unknown/not-run into pass.

## Repair agent

Responsibilities:
- consume classified failure and bounded evidence;
- retrieve matching accepted repair memory when available;
- apply a minimal repair within authorized scope;
- return candidate to the relevant verification boundary;
- contribute accepted/rejected repair outcomes back to structured repair memory.

Cannot:
- retry indefinitely;
- broaden scope without scheduler/planner reclassification;
- bypass deterministic non-retryable failures.

## Release/deployment authority

Responsibilities:
- enforce merge/release/deploy policy;
- require exact accepted SHA/artifact;
- execute bounded canary/release/rollback workflows when authorized;
- preserve provenance, attestation and rollback linkage for each promoted artifact.

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
- recurring evidence checks;
- duplicate-authority, duplicate-schema, duplicate-workflow and obsolete-repository detection;
- promotion of recurring accepted repairs into deterministic transforms, static checks, tests or runtime invariants.

Must route changes through the same acceptance and release rules as normal work.

## Model routing

Routing uses measured task-class success, latency, cost, rework, verifier load and capacity. High-cost reasoning is reserved for architecture/pathological debugging/review when it materially improves acceptance. Routine mechanical work should use lower-cost capable execution where evidence supports it.

The routing objective is **minimum expected total cost per independently accepted capability**, not minimum token cost per attempt.

See `docs/AI_AGENT_100K_ACCELERATION_AUDIT.md` for the cross-sector AI-agent optimization findings and phased leverage model.
