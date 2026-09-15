# Throughput and Leverage Model

## Methodology

Current methodology: **v2.0 (2026-09-15)**.

The historical **~86x** figure is preserved as a v1 comparison point. It is not a fixed calibration target. v2 reports must be recomputed from accepted semantic output rather than raw PR count times one flat hours-per-PR constant.

## Primary metrics

### Engineering capacity multiplier

`engineering_capacity_multiplier = accepted_human_equivalent_hours / standard_engineer_day_hours`

For daily reporting, `standard_engineer_day_hours = 8` unless otherwise stated. This answers: **how many conventional engineer-days of accepted output were produced in the interval?**

### Owner-attention leverage

`engineering_leverage = accepted_human_equivalent_hours / owner_active_intervention_hours`

This is the sustained owner-attention metric for the mixed portfolio. It is not wall-clock speed and is not measured by commits, PRs, agents, tokens, lanes or API calls. Until owner-intervention telemetry is complete, capacity multiplier and owner-attention leverage must be reported separately.

### Effective factory leverage

`effective_factory_leverage = accepted_human_equivalent_hours / novel_reasoning_owner_equivalent_hours`

Use this for standardized product-family operations where one accepted novel solution is safely reused, transformed or fanned out across many products. Report it separately from sustained portfolio leverage.

## Accepted semantic capability is the accounting unit

The atomic output unit is an **accepted semantic capability**, not a pull request. One capability may arrive as one PR, several dependent PRs, one micro-shard composition, a deterministic transform fan-out or another bounded execution form.

Count only artifacts satisfying the applicable acceptance contract. Reverted, duplicate, superseded, unverified, stale-cache, failed-deployment and rejected speculative work receives no output credit.

Each accepted unit should record source SHA, final SHA, capability/task/product-family identity, acceptance evidence, semantic band, modifiers, human-equivalent estimate, confidence interval, methodology version, reuse/transform lineage, dependency/composition group, repair/rollback history, owner-intervention time when available, relevant policy/runtime versions, accepted timestamp and production outcome.

## v2 semantic-equivalent-hours model

For each accepted capability:

`H_capability = H_band × R × I × V × N × D`

Where:

- `H_band` = conventional human baseline for semantic scope;
- `R` = engineering/security/reliability risk modifier;
- `I` = integration breadth modifier;
- `V` = verification burden modifier;
- `N` = novelty modifier;
- `D` = dependency/correlation adjustment.

### Starting semantic bands

| Band | Typical accepted capability | Baseline hours |
|---|---|---:|
| XS | tiny CI/docs/config correction or mechanical fix | 2 |
| S | bounded bugfix/refactor or small tested behavior change | 5 |
| M | normal tested feature/module or moderate repair | 10 |
| L | cross-cutting feature, subsystem wiring or substantial reliability work | 20 |
| XL | architectural/security boundary change or major subsystem slice | 36 |
| XXL | multi-module subsystem capability with broad verification/integration burden | 56 |

The band represents semantic engineering scope, not changed lines, commits or PR size.

### Modifier guidance

Modifiers stay intentionally restrained so the semantic band carries most of the estimate:

- `R`: normally `1.00-1.35`; upper range for security, authorization, money movement, destructive state, release authority and similarly high-consequence work.
- `I`: normally `1.00-1.25`; cross-runtime, cross-repository, persistence, protocol or multi-authority integration.
- `V`: normally `1.00-1.20`; unusually heavy independent verification, migration proof, chaos testing, rollback proof or high-dimensional regression burden.
- `N`: normally `1.00-1.20`; meaningful new design/reasoning rather than routine adaptation.
- `D`: normally `0.65-1.00`; discount tightly dependent follow-ups so staged wiring and PR slicing do not multiply one capability's credit.

Modifiers must be evidence-backed and persisted. They are not rewards for perceived importance.

## Composition and dependency accounting

When several accepted changes jointly implement one capability, score the capability first and reconcile child units against it.

1. Tightly dependent PR chains do not receive full independent credit for the same semantic work.
2. Wiring/follow-up PRs may receive incremental credit for real integration risk and verification, but not duplicate the primitive already credited.
3. One large PR must not automatically earn more credit than the same capability split into smaller PRs.
4. Deterministic fan-out is credited only for independently accepted derivative value that a conventional engineer would otherwise have produced.
5. Bisection, repair and retry effort is recorded as rework/cost, not fresh output, unless it delivers a separate accepted capability.

Recommended reconciliation check:

`abs(sum(child_estimates) - capability_estimate) / capability_estimate <= 0.15`

Outside that tolerance, regroup or reclassify.

## Confidence and uncertainty

Aggregates should include a confidence range, for example:

`168x capacity [145x-192x, medium confidence]`

Confidence reflects acceptance/proof coverage, source/final SHA lineage, observed-vs-modeled lifecycle coverage, semantic-band uncertainty, modifier uncertainty, missing owner-attention telemetry, unresolved composition grouping and production-outcome maturity.

Modeled values must never be silently presented as observed values.

## Baseline recalibration

The historical ~86x baseline was produced under the previous methodology and remains a versioned historical reference only. Before comparing v2 performance against an earlier period, rerun at least the prior 2-4 weeks through v2 semantic-capability classification when data is available.

Do not compare a v2 weighted numerator against a v1 flat-PR baseline and call the difference an uplift.

Each reported aggregate should store interval, methodology version, accepted-capability count, semantic-equivalent hours, capacity multiplier, owner-attention leverage when measured, confidence interval, observed-vs-modeled coverage, composition adjustment, rejected/reverted/reworked effort and rollback/escape rate.

## Post-landing improvements enabled by current control-plane capabilities

The control plane now has enough instrumentation to reduce subjectivity progressively:

- **Execution-evidence calibration:** shard lifecycle telemetry, engineering traces, accepted outcome records, evidence graphs and proof certificates should calibrate semantic bands against observed repair rate, verifier burden, conflict rate, integration difficulty and production outcome.
- **Task-class learning:** learn band/modifier calibration by task class, executor/model, mutation surface, dependency depth, context entropy and verifier cost. Candidate scoring policies must still pass offline replay -> shadow -> benchmark -> canary -> independent promotion gate before production use.
- **Composition-aware dedupe:** parent/child lineage and evidence-graph identity should collapse micro-shards and dependent PRs back to one accepted parent capability.
- **Economic quality:** track `cost_per_accepted_capability`, `accepted_equivalent_hours_per_owner_hour`, `accepted_equivalent_hours_per_compute_dollar` and `accepted_equivalent_hours_per_model_dollar`.
- **Counterfactual savings:** report reuse, deterministic transforms, proof reuse, checkpoint resume and targeted verification as causal work avoided, separately from newly authored output.
- **Owner-attention telemetry:** record active steering/approval/debugging minutes against capabilities or intervals, excluding unattended wall time. This is the largest remaining denominator improvement.

A higher multiplier accompanied by materially worse rollback, security, cost or verifier-escape rates is not an improvement.

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
- repair-memory reuse rate;
- failure-frontier reuse rate;
- durable-checkpoint recovery savings;
- training/eval improvement by task class;
- abstraction-mining promotions;
- complexity deleted per accepted capability;
- duplicate-work suppression;
- targeted-verification savings vs challenge-suite escapes;
- owner approvals/exceptions per accepted capability.

A cache/certificate/reuse hit counts only if immutable source identity, policy/environment compatibility and acceptance requirements remain valid.

## Open-ended leverage rule

There is no terminal multiplier. Named values are measurement milestones, not architectural ceilings.

`historical v1 ~86x -> v2 recalibrated baseline -> 300x -> 1K -> 3K -> 10K -> 30K -> 100K -> 300K -> 1M -> ...`

Historical results retain the methodology/version under which they were measured.

The control plane continues:

`measure -> bottleneck -> candidate improvement -> simulation/shadow -> canary -> independent verification -> promotion -> outcome harvest -> next bottleneck`

## Additional no-ceiling KPIs

- executor reliable horizon by task class;
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
- Speculative candidates count only the accepted result; rejected candidates are compute/rework cost.
- Increasing agents, tokens, commits, PRs, tasks, API calls or logical concurrency alone creates no leverage credit.
- A lower-quality or less-safe result cannot be credited as leverage because it completed faster.
- Historical leverage retains the methodology version used at the time.
