# Leverage Model Feature Schema

## Goal

The leverage model should use every reliably observable data point that can improve estimation of conventional human-equivalent engineering effort, while preventing noisy or duplicated signals from inflating the result. The model must distinguish **observed facts**, **derived features**, **modeled estimates**, and **counterfactuals**.

The accounting unit remains the accepted semantic capability. Pull requests, commits, shards, reviews, tests, workflows and model calls are evidence attached to that capability, not independent output units.

## Core decomposition

For each accepted capability:

`H_total = H_implementation + H_research + H_review + H_integration + H_release + H_recovery`

Then apply quality and composition reconciliation rather than multiplying every raw signal independently:

`H_accepted = reconcile(H_total, dependency_lineage, reuse_lineage, rework, production_outcome)`

The model should emit a point estimate plus confidence interval, not false precision.

## 1. Identity and time

Capture:
- repository, owner/org, product, product family, capability id, task id, issue id, PR id, commit SHA, base SHA, final SHA, branch, release/deployment id;
- creation, first-claim, first-output, first-commit, PR-open, review-start, review-complete, merge, deploy, production-verification and rollback timestamps;
- wall-clock elapsed time, active execution time, queue time, blocked time, review wait, CI wait, deployment wait, owner wait and external dependency wait;
- timezone-normalized UTC timestamps plus reporting-day timezone;
- partial-day flag and data-as-of timestamp.

## 2. Change-size and mutation-surface evidence

Capture, but never use LOC alone as the value metric:
- additions, deletions, net lines, changed files, changed directories, commits, generated vs handwritten files;
- language/file-type mix;
- touched modules/packages/services/repos;
- public API changes, schema/migration changes, auth/permission changes, payment/economic surfaces, scheduled/retry/fan-out surfaces, infra/config/workflow changes;
- symbols/functions/classes/contracts changed;
- dependency-graph depth and breadth;
- cross-repo and cross-runtime edges;
- mutation-surface entropy and purpose-vs-diff surprise;
- new files vs modifications vs deletions;
- complexity deleted as well as complexity added;
- source-of-truth consolidation, duplicate code removed, dead code removed and architectural simplification.

## 3. Semantic scope

Capture:
- semantic band XS/S/M/L/XL/XXL;
- capability type: bugfix, feature, refactor, security, reliability, migration, performance, data, CI/CD, architecture, documentation, research, operational repair, release, recovery;
- novelty score;
- ambiguity score;
- task-class and cognition class;
- number of acceptance criteria;
- number of independent user/system behaviors changed;
- number of invariants/contracts introduced or modified;
- blast radius and reversibility;
- risk class and mutation-surprise class;
- whether work is primitive-wave, wiring-wave, migration-wave, cleanup-wave or production-hardening.

## 4. Research and discovery effort

Capture observed research signals wherever possible:
- repository/code searches performed;
- files/modules inspected before mutation;
- documentation/specification pages consulted;
- prior-art/internal-reuse searches;
- external library/package/GitHub research;
- license/provenance checks;
- issue/PR/history archaeology;
- architecture/dependency tracing;
- reproduction attempts and diagnostic probes;
- hypotheses generated, rejected and unresolved;
- failure-frontier depth;
- commands/tool calls used for investigation;
- research elapsed time and active research time;
- research context tokens/model calls when attributable;
- reused solution found vs novel solution required;
- confidence gained from research and value-of-information of probes.

Research class should be learned from these signals rather than permanently fixed at a percentage of implementation.

## 5. Implementation effort

Capture:
- coding/model execution attempts;
- accepted vs rejected patches;
- number and size of shards;
- shard decomposition depth;
- first-pass acceptance rate;
- repair attempts;
- tool calls and command executions;
- context tokens, output tokens and model calls;
- model/provider/tier used;
- model escalation/de-escalation;
- deterministic transforms used;
- generated artifacts and code;
- edit/compile/test loops;
- checkpoint resumes vs restarts;
- parallel lanes and actual overlap;
- idle/wait vs productive execution time;
- local vs remote execution;
- implementation active time, wall time and compute time.

## 6. Verification and review effort

Capture:
- reviewers/review agents involved;
- review comments, inline comments, requested changes, approvals and review rounds;
- files/lines inspected when available;
- review lenses run: functional, architecture, security, auth, schema/data, performance, dependency/supply-chain, release/rollback, economics;
- tests selected, tests executed, test duration, full-suite vs affected-only;
- challenge-suite runs and blind spots found;
- lint/typecheck/build/static-analysis/security-scan results;
- unit/integration/e2e/contract/load/chaos tests;
- test count added/modified/removed;
- coverage delta where available;
- verifier independence and proof-certificate coverage;
- economic verification and canary evidence;
- failures found during review and whether they changed the implementation;
- review active time, review wait time and CI wall time;
- number of re-review cycles;
- production-readiness and rollback review burden.

## 7. CI, build and infrastructure burden

Capture:
- workflow/job count;
- job duration and queue time;
- runner type, availability, CPU, RAM, disk and utilization;
- cache hits/misses;
- dependency install time;
- build duration;
- flaky/retried jobs;
- failed checks before final green;
- self-hosted vs hosted compute;
- deployment pipeline stages;
- artifact sizes and transfer time;
- DB migration count/time;
- infra/resource changes;
- CI parallelism and critical-path duration.

## 8. Integration and composition burden

Capture:
- number of dependent PRs/shards/capabilities;
- parent/child composition lineage;
- dependency depth;
- semantic conflicts detected;
- raw merge/rebase conflicts;
- hot-symbol contention;
- composition bisection attempts;
- stale-base retries;
- cross-repository synchronization;
- API/schema/version compatibility work;
- migration/backfill coordination;
- integration tests required;
- number of downstream consumers affected;
- wiring complexity vs primitive complexity.

Use these signals both to estimate integration effort and to prevent double counting across dependent PR chains.

## 9. Reuse, compression and avoided work

Capture:
- internal component reuse;
- external permissively licensed reuse;
- solution-cache hits;
- repair-memory hits;
- failure-frontier reuse;
- deterministic-transform reuse;
- proof/certificate reuse;
- artifact/build/test cache hits;
- product-family baseline reuse;
- fan-out count from one novel solution;
- avoided model calls;
- avoided tests/builds;
- avoided human-equivalent hours;
- duplicate work suppressed;
- context compression/token reduction;
- repository slice/context reduction;
- code deleted or consolidated.

Report avoided work separately from newly authored work, then include it in factory-leverage metrics only where the counterfactual is defensible.

## 10. Rework, failure and recovery

Capture:
- failed attempts;
- rejected patches;
- repair count;
- repeated-failure fingerprints;
- revert count;
- rollback count;
- regression escapes;
- post-merge hotfixes;
- security findings;
- failed deployments;
- incident/recovery work;
- mean time to detect and recover;
- work discarded due to stale base or duplicate implementation;
- loop-detection events;
- checkpoint recovery savings;
- owner interventions caused by failure.

Rework is cost, not fresh output, unless it independently delivers a new accepted capability.

## 11. Production outcome and quality

Capture after merge:
- deployment success;
- production verification;
- canary result;
- rollback/incident within defined windows;
- SLO/SLA impact;
- latency, error rate, throughput and saturation changes;
- cost delta;
- support/bug reports attributable to the change;
- security incidents/findings;
- verifier escapes;
- user/business acceptance signal where available;
- measured performance improvement;
- reliability improvement;
- technical-debt/complexity delta;
- outcome maturity window and confidence.

A capability with poor production outcome should have its historical estimate reconciled downward or its rework charged explicitly.

## 12. Economic and compute data

Capture:
- model/API cost;
- token cost;
- CI/runner compute cost;
- cloud compute/storage/egress cost;
- database cost impact;
- third-party API cost;
- developer-tool subscription allocation only when meaningfully attributable;
- cost per accepted capability;
- accepted equivalent hours per compute dollar;
- accepted equivalent hours per model dollar;
- recurring-cost amplification;
- projected vs observed economic impact;
- cost of failed/rejected work.

## 13. Human/owner attention

Capture active human time separately from autonomous wall time:
- prompt/specification time;
- architecture decisions;
- approvals;
- review time;
- debugging/intervention time;
- conflict resolution;
- deployment/release decisions;
- credentials/permission/infrastructure actions;
- manual testing;
- exception handling;
- interruption count and context switches;
- owner-active minutes per accepted capability.

This denominator is required for true owner-attention leverage.

## 14. Scheduler and queue context

Capture:
- queue depth;
- wait time;
- service class;
- priority;
- critical-path position;
- dependency unlock value;
- worker availability;
- lane occupancy;
- backpressure state;
- saturation stage;
- forecasted bottleneck;
- preemption count;
- starvation/aging score;
- scheduling policy version;
- value-of-information score;
- actual vs counterfactual scheduler rank.

## 15. Model/executor performance

Capture by executor/model/task class:
- acceptance rate;
- first-pass success;
- repair rate;
- hallucination/error proxy rate;
- verifier escape rate;
- latency;
- token usage;
- tool-call count;
- cost;
- reliable task horizon;
- shard-size calibration;
- context entropy sensitivity;
- escalation frequency;
- local-vs-frontier success delta;
- observed production outcome.

## 16. Confidence and provenance

Every feature should carry:
- source system;
- source record id;
- observed/modelled/derived/counterfactual class;
- timestamp;
- freshness;
- completeness;
- confidence;
- methodology/model version;
- immutable source/final SHA binding where relevant.

Missing evidence must lower confidence rather than silently defaulting to a favorable value.

## Estimation strategy

Do not hand-multiply every feature. That would overcount correlated signals such as files changed, LOC, commits and tests. Use a layered model:

1. **Rule-based semantic prior** from band, task class, risk and integration surface.
2. **Observed sub-effort estimates** for research, implementation, review, integration, release and recovery.
3. **Composition/reuse reconciliation** to remove duplicate credit and isolate avoided work.
4. **Outcome correction** using rework, rollback, escape and production evidence.
5. **Statistical calibration** from historical accepted outcomes, grouped by task class and executor, with regularization to control correlated features.
6. **Confidence interval** widened for missing evidence, novel task classes and immature production outcomes.

Recommended statistical calibration candidates include regularized linear/elastic-net regression, gradient-boosted trees for nonlinearity, and quantile models for uncertainty. Promotion of a learned estimator must follow offline replay -> shadow -> benchmark -> canary -> independent promotion gate.

## Required outputs

Per capability and aggregate period, report:
- observed accepted capabilities;
- implementation-equivalent hours;
- research-equivalent hours;
- review/verification-equivalent hours;
- integration/release/recovery-equivalent hours;
- total human-equivalent hours;
- avoided-work equivalent hours separately;
- rework/failure cost separately;
- owner-active hours;
- engineering capacity multiplier;
- owner-attention leverage;
- effective factory leverage;
- compute/model dollars and efficiency ratios;
- confidence interval and evidence coverage;
- rollback/escape/production-quality indicators;
- methodology/model version and data-as-of timestamp.

## Anti-gaming constraints

Raw PR count, commit count, LOC, test count, tool calls, model calls, tokens, agents and parallel lanes are explanatory features only. None creates output credit by itself. Output credit requires accepted semantic capability evidence. Repeated splitting, duplicate fan-out, generated churn, unnecessary tests, retries, speculative branches and failed work cannot increase accepted-output credit.
