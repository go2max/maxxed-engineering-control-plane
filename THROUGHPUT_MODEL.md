# Throughput and Leverage Model

## Headline metric

`engineering_leverage = accepted_human_equivalent_hours / owner_active_intervention_hours`

This is the primary owner-attention leverage metric. It is not wall-clock speed and is not a claim that AI literally codes hundreds of times faster than a conventional engineer.

## Accepted-output rules

Count only work that satisfies the applicable completion contract. Open PRs, generated code, retries, failed deployments, superseded branches and issue churn do not count.

Each accepted unit records:

- canonical task/issue/work-packet identifier;
- repository/product family;
- source and accepted/final SHA;
- acceptance evidence;
- human-equivalent estimate low/base/high;
- estimation methodology version and confidence;
- rework/repair/rollback history;
- accepted timestamp.

## Owner-attention rules

Owner attention means active intervention or decision time, not elapsed runtime. It may be captured by explicit operator sessions, semantic approval actions or manual correction. Wall-clock waiting must never be substituted for owner attention.

## Supporting KPIs

- autonomous completion rate;
- first-pass acceptance rate;
- second-pass acceptance rate;
- interventions per accepted task/packet;
- repair-loop success rate;
- rework and rollback rate;
- median accepted cycle time;
- productive concurrent lanes;
- verification utilization and queue wait;
- repair utilization and queue wait;
- queue starvation;
- human/provider blocked time;
- merge-ready-to-merge latency;
- deployment acceptance latency;
- cost per accepted human-equivalent hour.

## Stage checkpoints

These are acceptance checkpoints, not architecture targets.

### 10x
- 2-4 consistently productive lanes;
- dependency/claim reliability established;
- routine manual next-task selection removed.

### 20x
- 5-8 productive lanes;
- bounded repair loops;
- most ordinary work requires no owner intervention.

### 50x
- 10-20 mixed implementation/verification/repair lanes;
- strong backpressure and Work Packet use;
- standardized product families showing factory leverage.

### 100x
- owner is primarily exception-driven;
- autonomous completion and verification are high enough that scaling lanes increases accepted throughput rather than review debt;
- routine portfolio scheduling is autonomous.

### 150-300x
- horizontally scalable scheduler;
- product factories and shared-platform reuse dominate new product work;
- owner mainly handles irreversible approvals, strategy and ambiguous product decisions.

### 500-1000x
Possible only on highly standardized, low-touch factory work. It is not a blended portfolio planning baseline.

## Anti-gaming

- Parent/program trackers create no output credit.
- Reverted output is removed or discounted by policy.
- Duplicate or superseded work creates no credit.
- No credit for validation bypass or incomplete acceptance.
- Model identity is UNKNOWN unless execution provenance proves it.
- Historical monthly leverage retains the methodology used at the time; methodology changes create a new version rather than silently rewriting history.
