# Open-Ended Leverage Architecture

**Status:** canonical expansion of the Maxxed Engineering Control Plane leverage model

**Baseline:** ~86x measured average effective engineering throughput on 2026-09-15

**Principle:** **100K is a milestone, not a ceiling.**

The architecture must not encode a terminal leverage target. It must continually search for, evaluate, adopt, and retire mechanisms that increase independently verified production value per owner-attention hour while preserving security, provenance, rollback, correctness, and source-of-truth boundaries.

This document extends `docs/100K_LEVERAGE_ARCHITECTURE.md` and `docs/AI_AGENT_100K_ACCELERATION_AUDIT.md`.

---

# Review method

A new **100-perspective simulated adversarial panel** was run after the 1,600-perspective sector review. The perspectives intentionally overlapped disciplines that normally disagree: distributed systems, formal methods, compiler/build engineering, control theory, economics, security, queueing theory, ML systems, agent architecture, product factories, database systems, operating systems, developer productivity, reliability, organizational design, and adversarial testing.

The panel was instructed to search for **new primitives**, not restate the existing architecture. Findings were semantically deduplicated against the existing 100K audit before retention.

A broad GitHub sweep was then used to test the retained ideas against mature open-source systems. The goal was not to adopt a single framework, but to identify proven mechanisms that can be integrated into Maxxed's own control plane.

---

# 100-perspective panel: retained new findings

## 1. Horizon Compression Engine

Long agent tasks should be treated as a scheduling failure. The control plane should continuously estimate reliable task horizon by model, task class, risk, repository entropy, verification burden, and historical acceptance rate.

If a proposed packet exceeds the reliable horizon, the system should automatically decompose it before execution.

Required fields:

- estimated human-equivalent duration;
- expected tool-call count;
- dependency depth;
- mutation-surface size;
- context entropy;
- novelty score;
- historical executor success rate;
- predicted verification cost;
- maximum permitted agent horizon.

The scheduler should prefer **shrinking the task before upgrading the model**.

## 2. Reliability Budget

Probabilistic stages multiply failure probability. The system should explicitly budget reliability across an execution chain and minimize the number of probabilistic transitions.

Preferred shape:

`reason -> deterministic transform/guard -> reason only if unresolved -> independent verification`

Avoid chains such as:

`planner LLM -> coder LLM -> reviewer LLM -> QA LLM -> merger LLM -> audit LLM`

when deterministic machinery can replace any of those stages.

## 3. Engineering Intermediate Representation

Human intent and agent prompts should not be the canonical representation of work.

Introduce an Engineering IR with typed operations such as:

- `ChangeCapability`
- `CreateArtifact`
- `ModifyContract`
- `RepairFailure`
- `MigrateSchema`
- `PropagateBaseline`
- `DeprecateComponent`
- `ValidateRelease`
- `ChangeAuthorizationBoundary`

The control plane compiles:

`human intent -> intent IR -> capability resolution -> dependency graph -> work IR -> execution plan -> verification plan -> release plan`

Prompts become executor-specific code generation from IR rather than source-of-truth prose.

## 4. Proof-Carrying Work

A patch should increasingly carry machine-checkable evidence with it.

Evidence may include:

- exact source SHA;
- expected/actual mutation scope;
- type/lint/test results;
- architecture-policy proof;
- authorization-policy proof;
- migration proof;
- performance/query-plan bounds;
- reproducibility hash;
- artifact signature/attestation;
- theorem/model-checking result for critical invariants.

For high-risk classes, the creative agent may search freely while acceptance is controlled by a deterministic proof/checking kernel.

## 5. Evidence Graph

Replace binary `done=true` completion with a graph:

`intent -> work packet -> source SHA -> patch -> candidate SHA -> artifact -> validators -> attestation -> release -> production verification`

Every edge must be attributable and immutable enough to audit.

Completion is valid only when required graph edges exist and validate.

## 6. Context Entropy Budget

Context size alone is insufficient. Track how much unrelated information is mixed into an agent/reviewer context.

Potential entropy factors:

- unrelated files;
- number of independent intents;
- commit/history depth;
- benign-to-critical diff ratio;
- dependency spread;
- number of product families represented;
- generated-code noise.

High entropy should automatically trigger context splitting or specialized review lenses.

## 7. Review Lens Compiler

A large change should compile into separate review lenses:

- functional;
- architecture;
- security;
- authorization;
- schema/data;
- performance;
- dependency/supply-chain;
- release/rollback.

Each lens receives the minimum relevant context and emits composable evidence.

## 8. Purpose-vs-Diff Consistency Checker

Compare claimed work-packet intent with the actual semantic mutation.

Example:

`intent: change button text`

but actual semantic diff includes:

`authentication policy changed`

This must escalate automatically.

## 9. Mutation Surprise Score

Each packet declares expected files/symbols/packages/contracts. The runtime scores unexpected mutations by risk and semantic distance.

High surprise should block acceptance pending reclassification.

## 10. Failure Frontier Persistence

When an attempt fails, preserve structured knowledge:

- confirmed facts;
- rejected hypotheses;
- commands attempted;
- error fingerprints;
- files/symbols inspected;
- constraints discovered;
- successful intermediate outputs;
- unresolved hypotheses.

A replacement agent starts at the failure frontier, not at zero.

## 11. Action Loop Detection

Fingerprint repeated command/state/error combinations. Repeating the same failing action against the same source state beyond policy threshold should terminate or escalate the lane automatically.

## 12. Durable Checkpoints on Stateless Workers

Workers remain disposable, but work does not restart from scratch.

Checkpoint boundaries may include:

- source/context acquired;
- diagnosis accepted;
- mutation synthesized;
- focused validation passed;
- integration validation passed;
- artifact built;
- release prepared.

Another worker should resume safely from the latest valid checkpoint.

## 13. Counterfactual / Shadow Control Plane

New schedulers, decomposers, model routers, verifier policies, and admission rules should first run in shadow mode.

The production authority executes the incumbent decision while candidate policies record what they would have done.

Compare:

- acceptance rate;
- elapsed time;
- compute/model cost;
- verifier load;
- conflicts;
- rework;
- owner intervention.

Only evidence-backed policy promotion becomes authoritative.

## 14. Self-Optimizing Policy Laboratory

The control plane should be able to generate and test candidate versions of its own:

- scheduling policy;
- decomposition policy;
- context strategy;
- test selection;
- model routing;
- retry policy;
- cache policy;
- product-family abstraction;
- verifier allocation.

This is constrained self-improvement, not uncontrolled self-modification. Candidates run in simulation/shadow/canary and promote only through immutable evidence.

## 15. Causal Telemetry

Ordinary metrics show correlation. The platform should run controlled policy experiments to learn causality.

Examples:

- Did smaller shards reduce rework, or were they merely assigned easier tasks?
- Did a stronger model improve acceptance enough to justify cost?
- Did additional verification reduce escapes or only latency?

A/B, interleaving, shadow, and randomized bounded experiments should be supported where safe.

## 16. Dynamic Task Markets

Treat scarce execution resources as allocatable capital.

Each work packet may carry:

- expected business/product value;
- urgency/SLA;
- risk-reduction value;
- expected execution cost;
- expected verification cost;
- probability of acceptance;
- reuse multiplier;
- blocking impact.

The scheduler can rank by expected accepted value per constrained resource rather than static priority alone.

## 17. Value-of-Information Scheduling

Sometimes the best next task is not implementation but a cheap experiment that reduces uncertainty.

The scheduler should recognize diagnostic/probe work whose information value can prevent expensive wrong execution.

## 18. Preemption and Resume

Low-value indexing, scans, background generation, or maintenance work should yield to high-value incidents or release blockers.

Preempted work checkpoints and re-enters the queue without losing valid progress.

## 19. Service-Class Scheduling

Define classes such as:

- production incident;
- release critical;
- security critical;
- interactive owner request;
- normal product work;
- maintenance;
- backfill;
- speculative research.

Each class gets latency, cost, concurrency, and preemption policy.

## 20. Hierarchical Budget Delegation

A single policy authority can delegate bounded execution budgets to child schedulers:

- max workers;
- max frontier-model slots;
- max cost;
- allowed repositories;
- risk ceiling;
- verifier budget;
- runtime limit.

This enables scale without duplicating authority.

## 21. Capability Graph Above the Code Graph

The semantic code graph answers what code depends on what.

The capability graph answers:

`capability -> shared implementation -> product family -> product instances -> tests -> release channels`

This allows one capability improvement to be propagated automatically and makes portfolio size an output multiplier.

## 22. Automatic Abstraction Mining

Mine accepted work for repeated semantic structures that should become:

- shared SDK functions;
- transforms;
- product-family baselines;
- common validators;
- schemas;
- policy rules;
- generation templates.

The system should actively propose abstractions when repeated accepted deltas exceed a threshold.

## 23. Semantic Cache Beyond Exact Hashes

Exact content-addressed reuse remains safest. Add a second tier for **candidate semantic reuse**.

Semantic matches never bypass verification. They provide a candidate transformation or prior solution when source identity differs but task/capability structure is equivalent.

## 24. Validation Certificate Reuse

When a deterministic artifact is unchanged and all relevant input/policy/environment fingerprints match, reuse its prior validation certificate instead of rerunning equivalent checks.

Invalidate on any relevant dependency, toolchain, policy, or source change.

## 25. State-Machine Model Checking

Critical control-plane state machines—claims, leases, fencing, release promotion, credential rotation, rollback—should be exhaustively or symbolically checked where practical.

Look for impossible states, deadlocks, stale-authority resurrection, double ownership, and unsafe transition cycles before runtime.

## 26. Continuous Mutation Testing

Generate controlled code mutations to prove the verifier actually catches failures.

If a security/test/authorization validator fails to reject an injected defect, its confidence score drops and the gap becomes work.

## 27. Continuous Fuzzing / Adversarial Generation

Build fuzz lanes for:

- work-packet parsers;
- scheduler state transitions;
- event replay;
- migration logic;
- policy inputs;
- patch composition;
- agent tool contracts;
- artifact metadata.

Use agent-generated adversarial inputs as one source, while deterministic fuzz engines remain the arbiter.

## 28. Circuit Breakers by Failure Domain

Do not shut down the whole platform when one class regresses.

Trigger scoped admission stops on:

- rollback spike;
- verifier escape spike;
- model/task-class regression;
- abnormal mutation surprise;
- repeated portfolio-wide repair;
- credential/auth anomaly;
- cost anomaly;
- artifact mismatch.

Unrelated work continues.

## 29. Canary Policies and Canary Agents

Model, prompt, scheduler, decomposer, verifier, and transform changes should be rolled out to bounded traffic before global promotion.

## 30. Version Everything That Influences Behavior

Version:

- policy;
- prompt generator;
- Engineering IR schema;
- scheduler;
- decomposer;
- context compiler;
- model router;
- verifier profile;
- transform registry;
- product-family baseline;
- toolchain/environment.

Accepted results retain those version identities.

## 31. Heterogeneous Executor Fabric

Route work to the cheapest correct substrate:

- exact reuse -> CAS/database;
- deterministic transform -> CPU worker;
- AST transform -> specialized worker;
- build/test -> build hosts;
- low-novelty diagnosis -> smaller/local model;
- architecture/pathological debugging -> strongest reasoning model;
- high-risk verification -> specialist verifier;
- device work -> physical-device lane;
- highly restricted deterministic transforms -> WASM sandbox where useful.

## 32. Logical Concurrency != Physical Concurrency

The system may own hundreds of thousands or millions of durable logical tasks while running a bounded number of active executors.

This is essential for cost control and removes the false goal of “one agent per task.”

## 33. Adaptive Isolation

Select process/container/WASM/microVM/full VM/physical device isolation by trust, risk, privilege, toolchain, and expected duration.

## 34. Runtime Saturation Profiler

Continuously measure:

- CPU;
- memory;
- event-loop lag;
- database latency;
- queue depth;
- artifact I/O;
- model wait;
- verifier wait;
- worker startup latency.

Rewrite/migrate hot runtime paths only when measured saturation justifies it.

## 35. Queue-Aging and Fairness Controls

High-value work gets priority, but low-priority work must not starve indefinitely. Add aging and tenant/product-family fairness budgets.

## 36. Predictive Autoscaling

Scale from forecasted service demand, not only current queue depth. Use historical task-class arrival rates, estimated service times, scheduled releases, and verifier demand.

## 37. Optionality Preservation

When two designs are similarly viable, prefer the one that leaves more future execution paths open at lower reversal cost.

Represent reversibility/lock-in as a scheduling/planning attribute.

## 38. Complexity Budget / Entropy Tax

Every accepted capability should account for net additions of:

- unique code;
- workflow definitions;
- schemas;
- policies;
- services;
- dependencies;
- repositories;
- runbooks.

A capability that increases output while reducing these counts is disproportionately valuable.

## 39. Continuous Architecture Garbage Collection

The control plane should continuously identify:

- dead code;
- duplicate abstractions;
- stale docs;
- unused scripts;
- redundant workflows;
- obsolete compatibility paths;
- superseded repositories;
- redundant product variants.

Deletion is an acceleration feature.

## 40. Open-Ended Milestone Ladder

Do not encode an end state such as 100K. Maintain milestones only:

`86x -> 300x -> 1K -> 3K -> 10K -> 30K -> 100K -> 300K -> 1M -> ...`

A milestone is considered meaningful only when measured under a versioned methodology and independently accepted-output accounting.

The architecture's actual optimization loop is indefinite:

`measure -> identify bottleneck -> generate candidate improvement -> shadow/simulate -> canary -> verify -> promote -> harvest outcome -> repeat`

---

# Broad GitHub sweep: transferable mechanisms

The sweep found mature implementations of individual primitives but no single system that combines the entire Maxxed objective.

## Temporal — durable execution

Repository: `temporalio/temporal`

Transferable patterns:

- durable workflows;
- automatic recovery from intermittent failure;
- explicit workflow/worker separation;
- replayable execution semantics;
- durable workflow history.

Adopt the pattern, not necessarily the implementation. Maxxed already has domain-specific work-packet and claim semantics that should remain authoritative.

## Hatchet — high-throughput durable orchestration

Repository: `hatchet-dev/hatchet`

Transferable patterns:

- retries and backoff;
- priority;
- rate limits;
- worker affinity/labels;
- worker slots;
- fair/dynamic concurrency limits;
- event-triggered tasks;
- durable waits/sleeps;
- execution-history persistence;
- OpenTelemetry/Prometheus visibility;
- multi-tenant scheduling concepts.

Particularly relevant: treat worker slots, fairness, rate limits, and durable waits as first-class control-plane primitives rather than ad-hoc worker behavior.

## DBOS — checkpointed durable programs

Repository: `dbos-inc/dbos-transact-py`

Transferable patterns:

- checkpoint workflow state in a database;
- resume from last completed step;
- programmatic query/pause/resume/restart of large workflow sets;
- exactly-once event identity through idempotency/workflow IDs;
- queue concurrency/rate-limit/timeout/dedup/priority controls;
- durable notifications and sleeps.

Particularly relevant: **fork/restart from a specific failed step** rather than rerunning entire engineering workflows.

## LangGraph — persistent agent graphs

Repository: `langchain-ai/langgraph`

Transferable patterns:

- durable execution for agents;
- explicit state persistence;
- interrupts/human checkpoints;
- short- and long-term memory separation;
- traceable state transitions;
- subgraph composition.

Maxxed should use equivalent concepts while keeping its own acceptance and scheduler authority.

## OpenHands — backend-agnostic coding agents

Repository: `OpenHands/OpenHands`

Transferable patterns:

- one control surface over multiple agent backends;
- agents running locally, containers, VMs, remote infrastructure, or cloud;
- scheduled/webhook automation;
- explicit repository responsibility boundaries;
- agent protocol compatibility.

Maxxed should define its own executor/agent protocol so models and agent implementations are replaceable infrastructure.

## Ray — distributed task/actor/object primitives

Repository: `ray-project/ray`

Transferable patterns:

- stateless distributed tasks;
- stateful actors where state is genuinely necessary;
- immutable distributed objects;
- machine/cluster portability;
- distributed debugging/observability.

Maxxed should continue preferring stateless workers while allowing narrowly-scoped durable actors/controllers where ownership semantics require state.

## Dagger — typed, portable, content-addressed execution

Repository: `dagger/dagger`

Transferable patterns:

- typed system APIs rather than shell conventions;
- explicit host dependencies;
- sandboxed functions;
- typed/content-addressed artifacts;
- incremental execution keyed by inputs;
- local/CI parity;
- OpenTelemetry on every operation;
- schema-generated multi-language SDKs.

This strongly supports replacing portfolio shell glue with typed execution contracts.

## Bazel — incremental dependency-driven builds

Repository: `bazelbuild/bazel`

Transferable patterns:

- rebuild only what dependency analysis proves necessary;
- local/distributed caching;
- parallel execution;
- multi-language build graph;
- reusable build rules;
- explicit query interface over the build graph.

Maxxed's semantic impact graph should become similarly queryable by agents and the scheduler.

## Buck2 — hermetic critical-path execution and graph introspection

Repository: `facebook/buck2`

Transferable patterns:

- calculate and optimize the critical path;
- require declared inputs under hermetic execution;
- remote execution compatibility;
- language-agnostic core;
- build-graph introspection through automation APIs;
- filesystem virtualization/change awareness.

New Maxxed feature: expose a **control-plane graph query language/API** so agents can ask targeted dependency/impact questions without loading entire repositories.

## Nix — reproducibility as identity

Repository: `NixOS/nix`

Transferable pattern:

- reproducible, declarative environments.

Maxxed should treat environment identity as part of solution/artifact/validation identity and aggressively remove machine-local hidden state.

## OPA — policy as a separate programmable authority

Repository: `open-policy-agent/opa`

Transferable patterns:

- declarative policies separate from service code;
- query policy decisions from execution services;
- centralized/versioned context-aware rules;
- portable enforcement interfaces.

Maxxed should continue moving scheduler/security/release/admission rules into versioned policy objects rather than scattering them through implementation code.

## Wasmtime / WASI — restricted high-density execution

Repository: `bytecodealliance/wasmtime`

Transferable patterns:

- efficient concurrent isolated instances;
- explicit resource controls;
- capability-like host APIs through WASI;
- strong security/correctness emphasis;
- fuzzing and formal-verification practices.

Candidate use: deterministic transforms and other untrusted or highly constrained utilities that do not require full containers.

## Lean — proof-kernel boundary

Repository: `leanprover/lean4`

Transferable pattern:

- creative proof search is separate from trusted proof checking.

Generalize this principle: probabilistic AI may search for a solution, but high-risk acceptance should depend on the smallest practical deterministic checker/proof boundary.

## OSS-Fuzz — continuous adversarial validation

Repository: `google/oss-fuzz`

Transferable patterns:

- continuous distributed fuzzing;
- multiple fuzz engines;
- sanitizer-backed deterministic detection;
- security/stability testing as an always-on service.

Maxxed should maintain continuous fuzz/adversarial lanes for its control-plane parsers, state machines, replay logic, patch composition, policy inputs and tool contracts.

## Prefect — reactive resilient workflows

Repository: `PrefectHQ/prefect`

Transferable patterns:

- scheduling;
- retries;
- caching;
- event-triggered automations;
- dynamic branching;
- ephemeral execution clients.

## Dagster — asset lineage and control-plane metadata

Repository: `dagster-io/dagster`

Transferable patterns:

- declarative assets;
- integrated lineage;
- central metadata/catalog;
- observability tied to dependency graph;
- local/test/staging/production continuity.

New Maxxed feature: treat capabilities, products, baselines, artifacts, evidence bundles and release states as **engineering assets with lineage**, not merely queue records.

---

# New canonical architecture layers

The panel plus GitHub sweep imply the following additional layers above the existing leverage fabric.

## Intent Compiler

Produces Engineering IR and resolves capabilities/product families before work creation.

## Horizon Compressor

Keeps probabilistic tasks inside empirically reliable execution horizons.

## Context Compiler

Produces minimal, low-entropy, role-specific context bundles.

## Durable Workflow Kernel

Provides checkpoints, replay, exactly-once/idempotency identity, durable waits, resumable execution and programmatic recovery.

## Execution Fabric

Capability-addressed heterogeneous workers with adaptive isolation, slots, fair scheduling, rate limits, preemption and predictive capacity.

## Proof / Evidence Fabric

Produces and validates evidence graphs, validation certificates, attestations, proofs, fuzz results, model-checking results and production verification.

## Policy Engine

Versioned declarative admission/security/release/scheduling constraints separate from executors.

## Capability / Asset Graph

Combines semantic code graph, product-family graph, capability graph, artifact lineage and verification lineage.

## Learning Fabric

Learns routing, decomposition, repair, test selection and abstraction opportunities from accepted/rejected outcomes.

## Policy Laboratory

Runs shadow, simulation, canary and counterfactual experiments on the control plane's own policies.

## Complexity Collector

Continuously deletes or consolidates entropy introduced by previous work.

---

# Open-ended optimization function

The system should not optimize a fixed multiplier. It should maximize something conceptually equivalent to:

`accepted economic/product/risk-reduction value`

`/`

`(owner attention + elapsed time + model cost + compute cost + verifier cost + expected rework + expected rollback + net complexity added)`

subject to hard constraints for:

- acceptance integrity;
- security;
- authorization;
- provenance;
- rollback;
- policy compliance;
- source identity;
- fencing/ownership;
- data protection.

The exact scoring function may evolve, but changing it requires versioned policy and evidence-backed promotion.

---

# No-ceiling operating loop

The platform should permanently run this meta-cycle:

1. Measure accepted-output economics and bottlenecks.
2. Identify the dominant constraint or repeated reasoning class.
3. Generate candidate mechanisms to reduce that constraint.
4. Search internal reuse and external prior art.
5. Implement the smallest candidate mechanism.
6. Run simulation/shadow/counterfactual comparison.
7. Canary on bounded workloads.
8. Independently verify outcomes.
9. Promote if statistically/economically superior and safe.
10. Convert repeated successful behavior into deterministic infrastructure.
11. Delete the obsolete path.
12. Repeat.

The intended long-run behavior is:

- accepted output rises;
- owner intervention falls;
- novel reasoning share falls for repeated work;
- context per capability falls;
- inter-agent communication falls;
- rework falls;
- verification becomes more targeted and stronger;
- unique code/workflows/policies per capability fall;
- the next architecture improvement becomes cheaper to discover and deploy than the previous one.

That last property is the real route to an architecture with no planned ceiling.
