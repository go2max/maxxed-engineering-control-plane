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

## Horizon and context rules

Every probabilistic executor has an empirically measured reliable horizon by task class. The planner/scheduler should decompose work that exceeds that horizon before execution.

Each context bundle should also carry a context-entropy budget. Excessive unrelated history, files, intents or generated noise should cause context splitting or specialized review lenses rather than simply expanding the prompt.

## Portfolio planner

Responsibilities:
- consume canonical planning and execution state;
- compile ambiguous intent toward typed Engineering IR/work packets;
- decompose approved objectives into bounded dependency-aware work;
- identify reuse/product-factory/capability-graph opportunities;
- attach acceptance requirements and risk class;
- minimize novel reasoning by selecting the cheapest safe execution path;
- generate work packets with explicit mutation scope and dependency context;
- prefer information-gathering probes when their expected value of information exceeds immediate implementation.

Cannot:
- mutate production;
- bypass dependencies;
- mark work accepted.

## Scheduler

Responsibilities:
- compute executable frontier;
- rank eligible work by expected accepted value subject to risk/cost/service-class policy;
- allocate lanes/capacity;
- apply WIP/backpressure;
- record dispatch explanation;
- account for verifier/repair/composition capacity before increasing implementation fan-out;
- prefer disjoint semantic mutation scopes over repository-wide serialization;
- enforce service-class priorities, queue aging/fairness, rate limits and worker slots;
- preempt checkpointable low-value work when policy permits and higher-value work requires capacity;
- use predictive capacity estimates where evidence supports them.

Cannot:
- declare blocked work eligible;
- override human/provider/safety gates;
- self-promote a new scheduling policy into production.

## Implementer

Responsibilities:
- change only claimed scope in isolated workspace;
- run required focused local checks;
- produce bounded evidence and candidate artifact/PR;
- consume compiled minimal context and prior accepted repair/reuse evidence where supplied;
- preserve generated-artifact provenance and regeneration rules;
- emit durable checkpoints at policy-defined boundaries for resumable work;
- emit structured failure-frontier evidence when unsuccessful.

Cannot:
- self-approve final acceptance for material work;
- expand scope silently;
- mutate unrelated repositories/resources;
- edit generated artifacts directly when a canonical producer exists;
- repeat the same failed action indefinitely after loop detection fires.

## Verifier

Responsibilities:
- independently evaluate candidate against acceptance contract;
- classify failures;
- confirm provenance/artifact identity;
- emit structured pass/fail evidence;
- challenge impact-selected validation with periodic broader/full-suite checks;
- detect evidence that is missing, self-reported, stale, or bound to the wrong source/artifact identity;
- evaluate purpose-vs-semantic-diff consistency and mutation surprise where required;
- emit composable review-lens evidence for functional, security, authorization, schema, performance, dependency and release concerns;
- support validation-certificate reuse only when all relevant immutable fingerprints match.

Cannot:
- waive mandatory checks for convenience;
- convert unknown/not-run into pass;
- trust an agent's completion claim without required evidence edges.

## Proof/evidence authority

For high-risk task classes, the acceptance boundary should be the smallest practical deterministic checker: tests, policy engine, type checker, model checker, theorem/proof kernel, reproducibility checker, signed attestation verifier, or other machine-checkable mechanism.

Probabilistic systems may propose/search; they do not redefine the proof boundary.

## Repair agent

Responsibilities:
- consume classified failure and bounded evidence;
- retrieve matching accepted repair memory when available;
- start from the persisted failure frontier rather than repeating discovery;
- apply a minimal repair within authorized scope;
- return candidate to the relevant verification boundary;
- contribute accepted/rejected repair outcomes back to structured repair memory;
- propose promotion of recurring accepted repairs into deterministic transforms, static rules, tests or runtime guards.

Cannot:
- retry indefinitely;
- broaden scope without scheduler/planner reclassification;
- bypass deterministic non-retryable failures.

## Release/deployment authority

Responsibilities:
- enforce merge/release/deploy policy;
- require exact accepted SHA/artifact;
- execute bounded canary/release/rollback workflows when authorized;
- preserve provenance, attestation and rollback linkage for each promoted artifact;
- apply circuit breakers scoped to affected failure domains rather than halting unrelated work when possible.

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
- promotion of recurring accepted repairs into deterministic transforms, static checks, tests or runtime invariants;
- automatic abstraction-mining proposals from repeated accepted semantic deltas;
- continuous architecture garbage-collection candidates and complexity-budget accounting.

Must route changes through the same acceptance and release rules as normal work.

## Policy laboratory

Candidate versions of scheduler, decomposer, context compiler, model router, retry policy, test selector, verifier allocator, cache policy or product-family abstraction must be evaluated in simulation, replay, shadow or bounded canary modes before promotion.

Promotion evidence should compare accepted-output rate, elapsed time, cost, verifier load, rework, conflicts, rollback and owner intervention against the incumbent. Policy changes are versioned and reversible.

## Model routing

Routing uses measured task-class success, latency, cost, rework, verifier load, context entropy, reliable horizon and capacity. High-cost reasoning is reserved for architecture/pathological debugging/review when it materially improves acceptance. Routine mechanical work should use lower-cost capable execution where evidence supports it.

The routing objective is **minimum expected total cost per independently accepted capability**, not minimum token cost per attempt.

See `docs/OPEN_ENDED_LEVERAGE_ARCHITECTURE.md` for the no-ceiling architecture, policy laboratory, proof/evidence fabric, horizon compression and GitHub prior-art sweep. See `docs/AI_AGENT_100K_ACCELERATION_AUDIT.md` for the earlier sector audit and phase model.
