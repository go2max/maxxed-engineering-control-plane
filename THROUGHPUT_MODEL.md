# Throughput and Leverage Model

## Methodology

Current methodology: **v3.0 investor-grade evidence model (draft, 2026-09-15)**.

Historical methodology is preserved for reproducibility:

- **v1**: flat PR-volume proxy, approximately 13.9 modeled engineering hours per merged PR and historical ~86x comparison baseline.
- **v2.0**: accepted semantic capability accounting with scope/risk/integration/verification/novelty/dependency modifiers.
- **v2.1 bridge**: explicit implementation + research + review accounting while richer evidence is backfilled.
- **v3.0**: evidence-first capability accounting, current replacement-cost economics, production-quality reconciliation, owner-attention leverage, model/provider cost, capital efficiency, resilience, commercial outcomes and investor diligence.

No historical result may be silently rescored without preserving the methodology version and source evidence used at the time. v1/v2 values remain historical reference points, not calibration targets.

## Objective

The purpose of v3 is not to maximize a multiplier. It is to produce an engineering/economic leverage measurement that can survive hostile investor diligence.

The model must be reproducible from source evidence, explicitly distinguish observed facts from modeled estimates and counterfactuals, expose uncertainty, allow conservative assumption haircuts, and remain useful if a skeptical reviewer cuts every favorable assumption substantially.

The accounting unit is the **accepted semantic capability**. PRs, commits, shards, agents, tokens, tests, reviews and workflow runs are evidence attached to a capability. They do not create output credit by themselves.

## Core effort decomposition

For each accepted capability:

`H_total = H_implementation + H_research + H_review + H_integration + H_release + H_recovery`

Then reconcile quality, duplication, reuse and production outcome:

`H_accepted = reconcile(H_total, dependency_lineage, reuse_lineage, rework, production_outcome)`

Separately calculate defensible avoided work:

`H_avoided = counterfactual_avoided_human_work(reuse, deterministic_transforms, cache/proof reuse, baseline fanout, duplicate suppression)`

Avoided work is never silently added to newly authored output. It is reported separately and may contribute to factory-leverage metrics only where the counterfactual is defensible.

## Primary metrics

### Engineering capacity multiplier

`engineering_capacity_multiplier = quality_adjusted_accepted_human_equivalent_hours / standard_engineer_day_hours`

For daily reporting, `standard_engineer_day_hours = 8` unless otherwise stated.

### Owner-attention leverage

`owner_attention_leverage = quality_adjusted_accepted_human_equivalent_hours / owner_active_intervention_hours`

Owner-active intervention excludes unattended autonomous wall time. It includes active prompting/specification, architecture decisions, approvals, manual review, debugging/intervention, conflict resolution, deployment decisions, credential/permission actions, manual testing and exception handling.

### Effective factory leverage

`effective_factory_leverage = (quality_adjusted_accepted_human_equivalent_hours + defensible_avoided_human_equivalent_hours) / novel_reasoning_owner_equivalent_hours`

Use this for standardized operations where one accepted novel solution is safely reused, transformed or fanned out across multiple independently accepted outputs.

### Verified economic engineering leverage

`verified_economic_engineering_leverage = quality_adjusted_conventional_replacement_value / total_attributable_system_cost`

Where attributable system cost includes owner labor, model/API usage, compute, infrastructure, CI/build cost, external services and attributable operating expense.

This is the primary investor-facing efficiency metric because it combines output, quality, cost and human dependency.

### AI cost efficiency

`accepted_equivalent_hours_per_model_dollar = quality_adjusted_accepted_human_equivalent_hours / attributable_model_api_cost`

`replacement_value_per_model_dollar = quality_adjusted_conventional_replacement_value / attributable_model_api_cost`

### Capital efficiency

`automation_capital_efficiency = cumulative_quality_adjusted_replacement_value / cumulative_cash_invested_in_automation_stack`

Track cumulative owner labor and capital separately so cash efficiency and founder-time efficiency are not conflated.

## Capability evidence record

Every accepted capability should carry, when available:

- repository, owner/org, product, product family, capability id, issue id, task id, PR id, commit/base/final SHAs, branch, release/deployment id;
- create, first-claim, first-output, first-commit, PR-open, review-start, review-complete, merge, deploy, production-verification and rollback timestamps;
- wall time, active execution time, queue time, blocked time, review wait, CI wait, deployment wait, owner wait and external dependency wait;
- semantic band, capability type, novelty, ambiguity, cognition/task class, acceptance criteria count, changed behaviors/invariants/contracts, blast radius, reversibility and risk class;
- additions, deletions, changed files/directories/modules/packages/services/repos, generated-vs-handwritten content, language mix, public API/schema/auth/payment/infra/scheduled/retry/fanout surfaces, changed symbols/contracts and dependency-graph breadth/depth;
- research evidence, implementation evidence, review/verification evidence, integration evidence, release evidence and recovery evidence;
- reuse/transform lineage, dependency/composition group, repair/rollback history, production outcome and owner-active time;
- model/provider usage and costs, CI/build/infrastructure costs and commercial/product outcome links;
- observed/derived/modeled/counterfactual class, data source, source record id, freshness, completeness, confidence and methodology version.

Missing evidence lowers confidence. It must never silently default to a favorable value.

## Semantic prior

Semantic scope remains a useful prior, not the final estimate.

| Band | Typical accepted capability | Starting human-equivalent prior |
|---|---|---:|
| XS | tiny CI/docs/config correction or mechanical fix | 2 h |
| S | bounded bugfix/refactor or small tested behavior change | 5 h |
| M | normal tested feature/module or moderate repair | 10 h |
| L | cross-cutting feature, subsystem wiring or substantial reliability work | 20 h |
| XL | architectural/security boundary change or major subsystem slice | 36 h |
| XXL | multi-module subsystem capability with broad verification/integration burden | 56 h |

The prior is calibrated from historical accepted outcomes and conventional role estimates. It is not multiplied mechanically by every observed feature.

## Research effort

Research is estimated from observed evidence wherever possible instead of a permanent percent-of-implementation assumption.

Track:

- repository/code searches;
- files/modules inspected before mutation;
- documentation/specification pages consulted;
- internal-reuse/prior-art searches;
- external library/package/GitHub research;
- license/provenance checks;
- issue/PR/history archaeology;
- architecture/dependency tracing;
- reproduction attempts and diagnostic probes;
- hypotheses generated, rejected and unresolved;
- failure-frontier depth;
- investigative commands/tool calls;
- active and elapsed research time;
- attributable research-context tokens/model calls;
- reuse found vs novel solution required;
- value-of-information of probes and confidence gained.

The v2.1 20% research uplift remains a historical bridge only where richer evidence is unavailable.

## Implementation effort

Track:

- coding/model execution attempts;
- accepted vs rejected patches;
- shard count/size and decomposition depth;
- first-pass acceptance rate;
- repair attempts and edit/compile/test loops;
- tool calls and command executions;
- context/output/reasoning tokens and model calls;
- provider/model/tier/effort level;
- model escalation/de-escalation;
- deterministic transforms;
- generated artifacts/code;
- checkpoint resumes vs restarts;
- parallel lanes and actual overlap;
- idle/wait vs productive execution time;
- local vs remote execution;
- implementation active time, wall time and compute time.

## Review and verification effort

Track:

- human/agent reviewers;
- requested reviews, comments, inline comments, approvals and requested changes;
- review rounds and re-review cycles;
- files/lines inspected where available;
- functional, architecture, security, auth, schema/data, performance, dependency/supply-chain, release/rollback and economic review lenses;
- tests selected/executed, duration and full-suite vs affected-only mode;
- challenge-suite runs and blind spots;
- lint/typecheck/build/static-analysis/security-scan results;
- unit/integration/e2e/contract/load/chaos tests;
- tests added/changed/removed and coverage delta;
- verifier independence and proof-certificate coverage;
- economic verification and canary evidence;
- failures found during review and whether they changed implementation;
- review active time, review wait time and CI wall time;
- production-readiness and rollback-review burden.

The v2.1 20% review uplift remains a historical bridge only where richer evidence is unavailable.

## Integration, release and recovery effort

Integration evidence includes dependent PR/shard/capability count, parent-child lineage, semantic/raw conflicts, hot-symbol contention, composition bisection, stale-base retries, cross-repo synchronization, API/schema/version compatibility, migration/backfill coordination, downstream consumers and integration-test burden.

Release evidence includes packaging, deployment, migration execution, release notes, environment promotion, canarying, production verification and rollback-readiness work.

Recovery evidence includes failed attempts, rejected patches, repeated-failure fingerprints, reverts, rollbacks, post-merge hotfixes, failed deployments, incidents, mean time to detect/recover, loop-detection events and checkpoint-recovery savings.

Recovery/rework is cost, not fresh output, unless it independently delivers a distinct accepted capability.

## Composition and anti-double-counting

When several changes jointly implement one capability, score the capability first and reconcile child records against it.

1. Tightly dependent PR chains do not receive full independent credit for the same semantic work.
2. Wiring/follow-up PRs receive only incremental credit for real integration/verification burden.
3. Splitting one capability into many PRs cannot increase total accepted-output credit.
4. Deterministic fanout earns avoided-work/factory-leverage credit only for independently accepted derivative outputs.
5. Generated churn, retries, speculative branches and duplicate work do not create output credit.
6. LOC, files, commits, tests, tokens, agents, lanes and tool calls are explanatory features only.

Recommended capability reconciliation tolerance:

`abs(sum(child_estimates) - capability_estimate) / capability_estimate <= 0.15`

Outside that tolerance, regroup, deduplicate or reclassify.

## Production quality reconciliation

Quality-adjusted output must account for production survival and verification quality.

Track:

- deployment success;
- production verification;
- canary result;
- rollback/incident within defined windows;
- SLO/SLA effect;
- latency/error/throughput/saturation change;
- cost delta;
- attributable support/bug reports;
- security findings/incidents;
- verifier escapes;
- measured performance/reliability improvement;
- technical-debt/complexity delta;
- 7d/30d/90d survival where available.

Use a bounded quality factor `Q` to reconcile accepted effort:

`H_quality_adjusted = H_accepted × Q`

`Q` must be evidence-backed and versioned. It cannot exceed policy bounds merely because the change is strategically important. Rollbacks, incidents, verifier escapes or significant regressions reduce quality-adjusted value and/or charge explicit rework cost.

## Conventional labor replacement-cost model

Every human-equivalent hour must be translatable to a conventional U.S. labor-cost range with role mix and provenance.

Role families should include at minimum:

- software developer/engineer;
- QA/test engineer;
- DevOps/platform/SRE;
- security engineer/reviewer;
- data/database engineer;
- architecture/technical research;
- release/operations;
- engineering management/review.

Use national U.S. benchmarks by default. Geographic or seniority adjustments are sensitivity scenarios, not favorable default assumptions.

### Current reference benchmarks (effective 2026-09-15 model snapshot)

Official U.S. BLS May 2025 Occupational Outlook Handbook values:

- Software developers national median annual wage: **$135,980**.
- Software QA analysts/testers national median annual wage: **$104,300**.

Official U.S. BLS Employer Costs for Employee Compensation, June 2026:

- Professional and technical services: **$51.88/hour wages + $24.10/hour benefits = $75.98/hour total compensation**.
- Management, professional and related occupations: **$54.06/hour wages**, with paid leave, supplemental pay, insurance, retirement/savings and legally required benefits tracked in the ECEC tables.

Persist each source, publication/effective date and rate-card version. Revalue historical work under both the contemporaneous historical rate and current replacement rate when useful.

### Role-mix replacement value

For capability `c`:

`replacement_value_c = Σ(role_hours_c,r × fully_loaded_hourly_rate_r)`

Report:

- salary-only replacement value;
- fully-loaded employer-compensation replacement value;
- conservative/base/upside percentile cases where supported;
- single-role and realistic multi-role-team counterfactuals;
- coordination/management/hiring/onboarding overhead only when separately defensible.

Do not convert every engineering hour with one generic rate if role evidence is available.

## Current AI/model cost ledger

Model cost must use actual attributable token usage and effective-date provider rate cards. Distinguish API/token usage from flat subscriptions and included plan usage.

### OpenAI current reference rates (effective 2026-09-15 snapshot)

Per 1M text tokens:

| Model | Input | Cached input | Output |
|---|---:|---:|---:|
| GPT-5.6 Sol | $4.00 | $0.40 | $20.00 |
| GPT-5.6 Terra | $2.00 | $0.20 | $12.00 |
| GPT-5.6 Luna | $0.20 | $0.02 | $1.20 |

Additional current rules to preserve in the rate card:

- GPT-5.6 Sol promotional pricing is stated as available at least through 2026-11-21.
- GPT-5.6 prompts above 272K input tokens are billed at 2x input and 1.5x output for the full request.
- GPT-5.6 cache writes are billed at 1.25x uncached input rate.
- Tool-specific charges such as web search must be captured separately when attributable.
- Standard vs fast/priority service tiers must be recorded when they alter cost.

### Anthropic current reference rates (effective 2026-09-15 snapshot)

Per 1M text tokens:

| Model | Input | Output |
|---|---:|---:|
| Claude Sonnet 5 | $2.00 | $10.00 |
| Claude Opus 4.8 | $5.00 | $25.00 |
| Claude Opus 5 | $5.00 | $25.00 |

Record prompt-cache reads/writes, batch discounts and fast-mode rates separately. Anthropic states Sonnet 5 can receive up to 90% savings with prompt caching and 50% with batch processing; Opus 4.8/5 fast mode is priced above base usage and must be treated as a separate service tier.

### Model-call cost formula

For each attributable request:

`model_cost = uncached_input_tokens × input_rate + cached_input_tokens × cached_input_rate + cache_write_tokens × cache_write_rate + output_tokens × output_rate + tool_charges + service_tier_premium`

Persist provider, model, model version, rate-card version, service tier, context size, token classes, request id, task/capability id, latency, failures/retries and accepted/rejected outcome.

Calculate:

- model cost per accepted capability;
- model cost per production-safe capability;
- accepted-equivalent hours per model dollar;
- replacement dollars per model dollar;
- escalation cost vs quality gain;
- failed/rejected token spend;
- cache savings;
- local-model substitution savings;
- provider/model concentration and outage sensitivity.

## Compute, CI and infrastructure economics

Track:

- workflow/job count;
- job queue time/duration/retries;
- runner type, CPU, RAM, disk, utilization and availability;
- cache hits/misses and dependency-install time;
- build duration and artifact transfer time;
- self-hosted vs hosted compute;
- deployment stages;
- DB migrations and runtime;
- cloud compute/storage/egress/database/API cost;
- cost of failed/rejected work;
- recurring-cost amplification and projected-vs-observed economic impact.

Unknown or partial provider evidence must be explicitly labeled incomplete rather than reported as a precise complete total.

## Human/owner attention and key-person dependency

Capture active human minutes for:

- specification/prompting;
- architecture decisions;
- approvals;
- review;
- debugging/intervention;
- conflict resolution;
- deployment/release decisions;
- credentials/permissions/infrastructure actions;
- manual testing;
- exception handling.

Also track interruption count, context switches, approvals per accepted capability, exceptions per capability and manual recovery events.

Investor-facing autonomy metrics should include:

- owner-active minutes per accepted capability;
- accepted-equivalent hours per owner-active hour;
- percent of accepted work completed without human intervention;
- autonomous continuity demonstrated over 1h/8h/24h/7d windows;
- work blocked exclusively on owner action;
- capabilities requiring non-delegable decisions;
- output retained under owner-absence scenarios.

## Reuse, learning and moat

Track proprietary compounding assets and reuse outcomes:

- accepted-outcome records;
- task-class calibration data;
- exact solution-cache hits;
- repair-memory and failure-frontier reuse;
- deterministic-transform hits;
- proof/certificate reuse;
- artifact/test/build cache hits;
- product-family baseline reuse;
- capability fanout per novel solution;
- reusable components promoted;
- abstraction-mining promotions;
- knowledge/RAG retrieval usage;
- scheduler/policy learning history;
- context compression/repository-slice reduction;
- duplicate-work suppression;
- complexity deleted and source-of-truth consolidation.

Investor-facing moat metrics should include percentage of accepted capabilities benefiting from proprietary historical learning, marginal acceptance/cost improvement as the evidence store grows and the fraction of output reproducible without proprietary accumulated state.

## Scheduler, queue and executor performance

Track:

- queue depth/wait;
- service class/priority;
- critical-path position;
- dependency unlock value;
- worker availability/lane occupancy;
- backpressure state;
- saturation stage and predicted bottleneck;
- preemption/starvation/aging score;
- scheduler-policy version;
- value-of-information score;
- actual vs shadow/counterfactual rank;
- acceptance/first-pass success/repair/verifier-escape rates by executor/model/task class;
- latency, token use, tool-call count, cost and reliable task horizon;
- shard-size calibration, context-entropy sensitivity and escalation frequency;
- local-vs-frontier success delta;
- production outcome by executor/model/task class.

## Resilience and concentration risk

Measure dependency concentration by:

- AI provider;
- model;
- cloud provider;
- runner/host;
- database;
- CI system;
- third-party API;
- repository/product criticality;
- owner/manual authority.

Calculate concentration indices where useful and simulate loss of a major provider/host/model. Report retained throughput/capability coverage under outage scenarios rather than merely counting dependencies.

## Commercial conversion

Link engineering evidence to business outcomes wherever evidence exists:

- product/release shipped;
- customer usage/adoption;
- conversion/revenue changes;
- churn/retention changes;
- support burden changes;
- operating-cost reduction;
- release velocity;
- experiment throughput;
- revenue-generating capability count;
- revenue or gross-profit contribution by capability/product family;
- time from intent to commercial value.

Commercial attribution must carry confidence and methodology. Correlation alone must not be silently reported as causation.

## Historical evidence backfill

The investor-grade ledger should be reconstructed from **2026-05-01 forward** where source evidence exists.

Required backfill sources include:

- GitHub PRs, commits, reviews, comments, issue lineage, labels and merge timing;
- code-change stats and semantic surfaces;
- CI/workflow runs, job/queue duration, retries, runner/cache/failure evidence;
- control-plane task/shard/outcome/evidence/proof records;
- model/provider/task-class usage and token/cost evidence;
- deployment, migration, release, rollback and production-verification events;
- owner/manual-intervention evidence where recoverable;
- product/repository/family mapping and commercial outcome links.

Preserve immutable source ids, UTC timestamps, reporting timezone, observed/derived/modeled/counterfactual classification, missing-data flags and deduplication lineage so future model versions can rescore history without rewriting source facts.

## 2,500+ data-point registry

The v3 feature store should maintain a normalized base ontology and support at least **2,500 addressable investor-relevant metric dimensions** without inventing meaningless combinations.

Expected structure:

- ~350-500 primary raw/base features;
- ~800-1,200 directly derived measures;
- ~1,500-3,000 useful time-series/cross-dimensional features;
- a small, curated set of primary investor KPIs.

Dimensions may include repository, product, product family, task class, capability type, model, provider, executor, risk class, semantic band, owner-intervention class, worker/host, release, time window and production outcome.

Every registry item must define canonical name, description, unit/type, source system/id, granularity, evidence class, historical availability, freshness/completeness, formula/transform, confidence, methodology version, anti-double-counting/correlation group, investor use case, dashboard exposure, retention and privacy/sensitivity class.

## Statistical calibration

Do not hand-multiply every raw signal. LOC, files, commits, tests, tokens, review rounds and execution attempts are correlated and would inflate output if treated as independent multipliers.

Use a layered estimator:

1. rule-based semantic prior from band/task class/risk/integration surface;
2. observed component-effort estimates for research/implementation/review/integration/release/recovery;
3. composition/reuse reconciliation;
4. production-quality/rework correction;
5. statistical calibration from historical accepted outcomes and conventional-role estimates;
6. uncertainty model/confidence interval.

Candidate calibrators include regularized linear/elastic-net regression for interpretability, gradient-boosted trees for nonlinearities and quantile/conformal models for uncertainty. Learned estimators must pass offline replay -> shadow -> benchmark -> canary -> independent promotion gate before production authority.

Calibration must be split by task class/executor where sample size supports it and regularized toward broader priors where evidence is thin.

## Confidence and provenance

Every metric and capability estimate carries:

- source system and source record id;
- observed/derived/modeled/counterfactual class;
- timestamp and freshness;
- completeness/evidence coverage;
- confidence;
- methodology/model version;
- immutable SHA/source binding where relevant.

Aggregates must report confidence ranges and evidence mix, for example:

`142x quality-adjusted capacity [118x-166x], 78% observed/calibrated evidence, 17% modeled, 5% counterfactual.`

Do not present modeled values as observed values.

## Investor rolling views

Report at minimum:

- 3h;
- 24h;
- 7d;
- 30d;
- 90d;
- May-2026-to-present cumulative.

For each window, include median/p10/p90 where sample size permits, throughput variance, cycle-time distribution, first-pass acceptance, rollback/escape rate, owner intervention, compute/model cost, replacement value, quality-adjusted output, evidence coverage and methodology version.

## Hostile-diligence sensitivity analysis

Every investor-facing report must support assumption haircuts. Recompute under scenarios such as:

- human-equivalent effort -25%, -50%, -75%;
- owner time +25%, +50%, +100%;
- model/API cost 2x and 4x;
- labor-rate reduction to conservative national benchmarks;
- research/review uplift removed where not directly observed;
- only production-verified capabilities counted;
- only capabilities surviving 7/30/90 days counted;
- stronger rollback/security/escape penalties;
- exclusion of avoided-work counterfactuals;
- loss of largest provider/model/host;
- current replacement pricing vs historical pricing.

The investment case should be judged partly by what survives these haircuts.

## Investor-facing output stack

### Layer 1 — Operating reality

Accepted capabilities, cycle time, first-pass acceptance, quality, production survival, rollback/escape rate, owner time, compute/model cost and evidence coverage.

### Layer 2 — Leverage

Human-equivalent component hours, quality-adjusted output, engineering capacity multiplier, owner-attention leverage, avoided work, effective factory leverage, replacement labor value and cost efficiency.

### Layer 3 — Enterprise value

Product/release velocity, commercial conversion, capital efficiency, resilience/concentration, proprietary-learning accumulation, revenue/gross-profit linkage where attributable and scenario-adjusted investor cases.

## Required per-period outputs

At minimum report:

- observed accepted capabilities;
- implementation-equivalent hours;
- research-equivalent hours;
- review/verification-equivalent hours;
- integration/release/recovery-equivalent hours;
- total and quality-adjusted human-equivalent hours;
- avoided-work hours separately;
- rework/failure cost separately;
- owner-active hours;
- engineering capacity multiplier;
- owner-attention leverage;
- effective factory leverage;
- salary-only and fully-loaded conventional replacement value;
- model/API, CI/compute and infrastructure cost;
- replacement value per system dollar;
- accepted hours per model dollar;
- cost per accepted/production-safe capability;
- capital efficiency;
- provider/host concentration risk;
- proprietary-learning/reuse share;
- confidence interval/evidence coverage;
- production-quality indicators;
- commercial linkage where available;
- methodology/rate-card version and data-as-of timestamp.

## Anti-gaming

- Parent/program trackers create no output credit.
- Raw PR, commit, LOC, test, token, agent, lane or tool-call counts never create output credit independently.
- Duplicate fanout does not multiply output unless derivative artifacts are independently accepted and represent real counterfactual human work.
- Cache/reuse credit requires immutable identity, environment/policy compatibility and valid acceptance evidence.
- Validation bypass creates no credit.
- Rejected/speculative candidates are compute/rework cost, not output.
- A lower-quality or less-safe result cannot earn more leverage merely because it finished faster.
- Historical results retain methodology and rate-card versions.
- Current pricing/wage benchmarks are versioned external inputs, not timeless constants.

## Governance and review

Changes to semantic priors, quality factors, labor rates, provider pricing, confidence rules or investor headline metrics must be versioned and reviewable. Historical raw evidence remains immutable; only the scoring layer changes.

The control plane continues:

`measure -> attribute -> deduplicate -> reconcile quality -> price -> calibrate -> stress test -> review -> promote -> outcome harvest -> next bottleneck`

The target is not a terminal multiplier. The target is progressively more defensible, lower-cost, higher-quality accepted output with decreasing owner dependency and increasing commercial conversion.
