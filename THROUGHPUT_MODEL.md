# Throughput and Leverage Model

## Primary metric

`engineering_leverage = accepted_human_equivalent_hours / owner_active_intervention_hours`

This remains the sustained owner-attention metric for the mixed portfolio. It is not wall-clock speed and is not measured by commits, agents, tokens or lane count.

**Current measured operating baseline (2026-09-15): ~86x average effective engineering throughput.**

## Secondary effective-leverage metric

For standardized product-family operations, also measure:

`effective_factory_leverage = accepted_human_equivalent_hours / novel_reasoning_owner_equivalent_hours`

This captures cases where one accepted novel solution is safely reused, transformed or fanned out across many products. It must be reported separately from sustained portfolio leverage.

## Accepted-output rules

Count only artifacts satisfying the applicable acceptance contract. Reverted, duplicate, superseded, unverified, stale-cache and failed-deployment work receives no output credit.

Each accepted unit records source SHA, accepted/final SHA, task/product family, acceptance evidence, human-equivalent estimate, methodology version/confidence, reuse/transform lineage, repair/rollback history and accepted timestamp.

## Compounding leverage accounting

Track reasoning avoided, not only work produced:
- exact solution-cache hit rate;
- deterministic-transform hit rate;
- retrieval-assisted vs novel-reasoning rate;
- artifact/test/build cache hit rate;
- product-family baseline reuse ratio;
- average dependency-slice size vs repository size;
- micro-shard coordination overhead;
- patches accepted per novel solution;
- repair-memory reuse rate;
- training/eval improvement by task class.

A cache hit counts only if immutable source identity, policy/environment compatibility and acceptance requirements remain valid.

## Stage checkpoints

### 86x measured baseline
Current observed operating average. This is the comparison point for future control-plane measurements.

### 300x sustained checkpoint
Autonomous portfolio scheduling, bounded coding/repair, local compute fabric, independent verification and product-family reuse allow the owner to remain primarily exception-driven.

### 1,000-3,000x effective / high mixed-work leverage
Semantic slicing, content-addressed solution/artifact caches and routine deterministic transformations eliminate repeated discovery/build/reasoning work. Mature mixed-work leverage should increasingly enter this range as agent context compilation, conflict avoidance and verification capacity improve.

### 3,000-7,500x mature mixed-work target band
This is an aspirational mature architecture band for a portfolio where exact reuse, deterministic transforms, micro-sharding, repair memory, impact-selected verification and family baselines are broadly deployed. It is not a claim that every novel task reaches this band.

### 3,000-15,000x effective standardized work
Known maintenance/migration classes become model-free codemods; product-family delta generation and repair memory dominate standardized work.

### 15,000-50,000x effective
Most repeated work is reuse/transform/verify; specialist models handle the remaining frequent reasoning classes; outcome harvesting continuously improves routing and repair.

### 50,000-100,000x effective/burst
Possible only for highly repetitive, product-family or portfolio-wide operations where one novel solution safely produces hundreds or thousands of accepted derivative changes. This is not a general-purpose software-engineering promise.

See `docs/AI_AGENT_100K_ACCELERATION_AUDIT.md` for the second-pass 1,600-perspective simulated sector review, deduplicated findings, phase-by-phase engineering-hour estimates and cumulative leverage ranges.

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
- Historical leverage retains the methodology version used at the time.
