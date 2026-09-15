# Throughput and Leverage Model

## Primary metric

`engineering_leverage = accepted_human_equivalent_hours / owner_active_intervention_hours`

This remains the sustained owner-attention metric for the mixed portfolio. It is not wall-clock speed and is not measured by commits, agents, tokens or lane count.

**Current measured operating baseline (2026-09-15): ~86x average effective engineering throughput.**

## Secondary effective-leverage metric

For standardized product-family operations, also measure:

`effective_factory_leverage = accepted_human_equivalent_hours / novel_reasoning_owner_equivalent_hours`

This captures cases where one accepted novel solution is safely reused, transformed or fanned out across many products. It must be reported separately from sustained portfolio leverage.

## Open-ended leverage rule

There is no terminal multiplier in this model. Named leverage values are **measurement milestones**, not architectural ceilings.

Milestone ladder:

`86x measured -> 300x -> 1K -> 3K -> 10K -> 30K -> 100K -> 300K -> 1M -> ...`

New milestones may be inserted or methodology may evolve, but historical results must retain the methodology/version under which they were measured.

The control plane should continue this loop indefinitely:

`measure -> bottleneck -> candidate improvement -> simulation/shadow -> canary -> independent verification -> promotion -> outcome harvest -> next bottleneck`

## Accepted-output rules

Count only artifacts satisfying the applicable acceptance contract. Reverted, duplicate, superseded, unverified, stale-cache and failed-deployment work receives no output credit.

Each accepted unit records source SHA, accepted/final SHA, task/product family, acceptance evidence, human-equivalent estimate, methodology version/confidence, reuse/transform lineage, repair/rollback history and accepted timestamp.

Each accepted unit should progressively also bind the policy, scheduler, decomposer, context-compiler, model-router, verifier-profile, transform-registry and environment/toolchain versions that materially influenced the result.

## Compounding leverage accounting

Track reasoning avoided, not only work produced:
- exact solution-cache hit rate;
- deterministic-transform hit rate;
- retrieval-assisted vs novel-reasoning rate;
- semantic-reuse candidate acceptance rate;
- artifact/test/build cache hit rate;
- validation-certificate reuse rate;
- product-family baseline reuse ratio;
- capability fan-out per novel solution;
- average dependency-slice size vs repository size;
- context-entropy score;
- micro-shard coordination overhead;
- patches accepted per novel solution;
- repair-memory reuse rate;
- failure-frontier reuse rate;
- durable-checkpoint recovery savings;
- training/eval improvement by task class;
- abstraction-mining promotions;
- complexity deleted per accepted capability.

A cache/certificate/reuse hit counts only if immutable source identity, policy/environment compatibility and acceptance requirements remain valid.

## Milestone checkpoints

### 86x measured baseline
Current observed operating average. This is the comparison point for future control-plane measurements.

### 300x milestone
Autonomous portfolio scheduling, bounded coding/repair, local compute fabric, independent verification and product-family reuse allow the owner to remain primarily exception-driven.

### 1K milestone
Semantic slicing, content-addressed solution/artifact caches, deterministic transforms, stronger work packets and impact-selected verification materially reduce rediscovery and repeated reasoning.

### 3K milestone
Context/horizon compression, micro-sharding, repair memory, capability reuse and low-rework parallel execution are broadly effective across mixed work.

### 10K milestone
Standardized maintenance/migration/product-family operations are dominated by deterministic transforms, exact/semantic reuse, validation-certificate reuse and shared baselines.

### 30K milestone
Capability graphs, product factories, learned routing, durable checkpoints and abstraction mining make one novel solution produce many independently accepted results.

### 100K milestone
Highly repetitive portfolio/family operations can safely turn one novel solution into hundreds or thousands of accepted derivatives with little additional reasoning. This is a major milestone, not a stopping point and not a promise for arbitrary novel engineering.

### 300K milestone
Requires additional measured improvements beyond the 100K milestone—for example higher capability fan-out, stronger proof/evidence reuse, better automatic abstraction discovery, lower verifier duplication, more deterministic execution and lower coordination entropy.

### 1M+ milestones
Not assumed or guaranteed. They remain valid research/measurement goals when independently accepted-output accounting demonstrates the required compounding leverage without weakening constraints.

See `docs/OPEN_ENDED_LEVERAGE_ARCHITECTURE.md` for the latest 100-perspective adversarial review, GitHub sweep and no-ceiling architecture. See `docs/AI_AGENT_100K_ACCELERATION_AUDIT.md` for the earlier 1,600-perspective sector review and detailed engineering-hour phase model.

## Additional no-ceiling KPIs

- executor reliable-horizon by task class;
- task-shrink/decomposition success rate;
- probabilistic stages per accepted capability;
- proof/evidence graph completeness;
- purpose-vs-diff mismatch rate;
- mutation surprise rate;
- loop-detection terminations;
- checkpoint resume vs full restart ratio;
- shadow-policy uplift vs incumbent;
- policy-canary rollback rate;
- value-of-information probes that prevented larger failed execution;
- preemption recovery efficiency;
- service-class SLA attainment;
- queue aging/fairness;
- predictive autoscaling error;
- inter-agent tokens per accepted capability;
- context tokens per accepted capability;
- net complexity per accepted capability.

## Micro-lane KPIs

- shard execution vs decomposition/composition time;
- accepted shards per second/minute;
- conflict/rebase rate;
- stale-base rejection rate;
- targeted-test escape rate caught by integration tests;
- average mutation scope size;
- weak-host utilization;
- parent cycle-time improvement from sharding.

## Anti-gaming

- Parent/program trackers create no output credit.
- Duplicate fan-out is not multiplied unless each derivative artifact is independently accepted and represents real human-equivalent work.
- Cache reuse against mutable or unproven source identity creates no leverage credit.
- Validation bypass creates no credit.
- Speculative candidates count only the accepted result; rejected candidates are compute cost.
- Merely increasing agents, tokens, commits, tasks, API calls or logical concurrency creates no leverage credit.
- A lower-quality or less-safe result cannot be credited as leverage because it completed faster.
- Historical leverage retains the methodology version used at the time.
