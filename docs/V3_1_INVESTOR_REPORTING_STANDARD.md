# v3.1 Investor Reporting Standard

Status: FINAL
Effective date: 2026-09-15
Applies to: public, investor, diligence, board, partner, and internal executive reporting that uses Maxxed engineering-leverage metrics.

## Purpose

This standard removes ambiguity from investor-facing reporting. It defines exactly what may be presented as observed, modeled, quality-adjusted, economic, or estimated; how historical periods are compared; how incomplete evidence is handled; and how every headline metric is reconciled to source evidence.

The goal is not to maximize a multiplier. The goal is to publish metrics that are reproducible, conservative, auditable, and difficult to game.

## Canonical reporting layers

Every reported metric belongs to exactly one layer.

1. **Observed** — directly measured from source systems. Examples: merged PR count, commit SHA, CI duration, token count, provider charge, deployment timestamp, rollback event, production latency, owner-timer event.
2. **Derived** — deterministic arithmetic over observed fields. Examples: PRs/day, cost/request, test pass rate, elapsed cycle time, cache savings.
3. **Modeled** — an estimator converts evidence into a conventional-engineering equivalent. Examples: human-equivalent implementation/research/review effort.
4. **Counterfactual** — value or cost under a defensible alternative world. Examples: avoided conventional labor, replacement payroll, work avoided through deterministic reuse.
5. **Quality-adjusted** — accepted modeled output reconciled against production survival, defects, rollback, incidents, verifier escapes, and rework.
6. **Economic** — quality-adjusted replacement value divided by attributable owner, model, compute, CI, infrastructure, and external-service cost.

A single number may not silently mix layers. Public dashboards must expose the layer next to the number or in an immediately visible methodology note.

## Canonical headline metrics

### Observed delivery

Report raw delivery independently from model output.

- merged PRs
- accepted capabilities
- accepted capabilities/day
- releases/deployments
- cycle-time percentiles
- production-survival counts

PR count is an observed activity/delivery metric only. It is never itself the value metric.

### Quality-adjusted engineering output

`H_quality_adjusted = Q × reconcile(H_implementation + H_research + H_review + H_integration + H_release + H_recovery)`

The reconciliation step removes duplicate semantic credit, stale retries, rework counted as fresh output, deterministic fanout counted as authored output, and dependent PR-chain inflation.

### Verified economic engineering leverage

`VEEL = quality_adjusted_conventional_replacement_value / total_attributable_system_cost`

This is the primary investor-facing efficiency metric once the numerator and denominator meet the evidence-coverage gate below.

### Owner-attention leverage

`owner_attention_leverage = quality_adjusted_human_equivalent_hours / observed_owner_active_hours`

Only observed owner-active time may be used in the primary metric. Inferred owner time is reported separately as a sensitivity case.

## Evidence-coverage gate

Every aggregate receives an evidence coverage report.

At minimum, score coverage separately for:

- identity and time
- implementation
- research
- review/verification
- integration/release
- production outcome
- model/API cost
- CI/infrastructure cost
- owner attention
- labor replacement rate
- commercial attribution where used

Investor-grade status requires:

- deterministic source lineage for the aggregate;
- no favorable default for missing evidence;
- modeled inputs clearly isolated from observed inputs;
- contradictory sources reconciled or marked unresolved;
- methodology and rate-card versions fixed for the report;
- confidence interval or explicit sensitivity range for modeled values;
- mature production windows clearly separated from censored/newer work.

Coverage percentages must be reported as observed / derived / modeled / counterfactual / missing.

## Historical reporting from May 2026 onward

The historical series begins 2026-05-01 because this is the practical start of the scaled AI-native development ramp.

Historical reports must retain two simultaneous views:

1. **As-reported view** — the methodology and rate card used when the report was originally generated.
2. **Restated view** — historical source evidence rescored under the current model and current rate card.

Restatement never overwrites the original value. Both remain reproducible.

For periods where capability-level evidence is incomplete, the historical bridge may be used only if explicitly labeled `bridge-model estimate`. Bridge estimates may not be presented as direct measured labor time.

## Research and review accounting

Research and review are first-class effort components and may not be hidden inside implementation.

Direct evidence takes precedence over fixed percentages. Relevant evidence includes repository/code search, files inspected, dependency tracing, reproduction attempts, diagnostic probes, prior-art/library research, documentation consultation, review rounds, reviewer comments, tests selected/executed, CI duration, security/architecture/data/economic verification, canary evidence, and independent proof coverage.

Where direct historical evidence is unavailable, a bridge estimate is permitted but must remain visibly labeled and excluded from any claim that implies direct observation.

## Production maturity

A merged change is not automatically permanent value.

Capabilities mature through defined windows:

- merge accepted
- deployed/production verified
- 1-day survival
- 7-day survival
- 30-day survival
- 90-day survival

Reports must distinguish immature/censored work from mature work. A capability that later rolls back, causes a regression, creates an incident, or requires a hotfix receives a quality reduction and/or explicit rework charge.

## Anti-gaming rules

The model must be invariant, within tolerance, to superficial workflow changes.

- Splitting one capability across more PRs cannot increase credited output.
- Combining unrelated capabilities into one PR cannot reduce independent credit.
- LOC, commits, files, tests, tokens, agents, lanes, and tool calls are explanatory features only.
- Failed/rejected attempts are cost/rework, not fresh output.
- Deterministic fanout is avoided work/factory leverage, not duplicate authored work.
- Reverts and rollback repairs are reconciled against the original capability lineage.
- Cross-repository work for one semantic outcome is grouped into one capability family where appropriate.

## Conservative public-reporting policy

Public and investor-facing pages must use conservative wording.

Allowed:

- `observed merged PRs`
- `modeled conventional-equivalent engineering hours`
- `quality-adjusted accepted engineering value`
- `estimated conventional replacement value`
- `verified attributable system cost`
- `bridge-model estimate`

Not allowed without direct evidence:

- `actual human hours saved`
- `employees replaced`
- `true labor hours`
- `guaranteed replacement value`
- `revenue caused by` when only correlation exists

If a number is modeled, say modeled. If it is observed, say observed. If it is counterfactual, say counterfactual.

## Investor stress standard

Every headline leverage result must be reproducible under at least these sensitivity cases:

- human-equivalent effort -25%, -50%, -75%
- owner-active time x2 and x4
- model/API prices x2 and x4
- infrastructure cost x2
- zero avoided-work credit
- zero research/review bridge credit when direct evidence is absent
- production-verified-only output
- 7d-, 30d-, and 90d-survivor-only output
- doubled rollback/rework penalties
- conservative labor-rate case
- largest provider/model/host removed

The dashboard should show base and conservative cases side by side.

## Rate-card policy

AI/provider pricing, labor benchmarks, cloud/CI pricing, and any external economic inputs are versioned rate cards with source, effective date, retrieval date, currency, unit, and notes.

Historical economics may be shown using both contemporaneous rates and current replacement rates. The selected rate basis must be explicit.

## Public dashboard contract

Every investor/public dashboard must show:

- reporting window and timezone;
- observed delivery metrics;
- modeled or quality-adjusted metrics with status label;
- evidence coverage/confidence;
- methodology version;
- production maturity status;
- cost basis/rate-card version when economics are shown;
- sensitivity/conservative case where a leverage multiple is shown;
- a methodology link or expandable explanation.

The primary page should be concise. The supporting diligence view may expose the full feature registry, source lineage, capability records, and stress cases.

## May-present canonical series

For public historical storytelling, use the exact GitHub query scope `is:pr is:merged author:go2max` with explicit date windows. Preserve the returned count and query timestamp. GitHub date qualifiers are date-bucket evidence; when exact local-time bucketing matters, use individual `merged_at` timestamps and bucket in America/Los_Angeles.

The reporting layer must never mix `author:go2max` with repository-owner qualifiers such as `user:go2max`.

## Completion definition

The reporting model is considered complete when:

1. the methodology and reporting rules are versioned and merged;
2. public language cannot confuse observed activity with modeled equivalent effort;
3. historical May-present reporting has deterministic query scope;
4. evidence, confidence, maturity, and cost basis are explicit;
5. anti-double-counting and production reconciliation are mandatory;
6. conservative sensitivity cases are part of the reporting contract;
7. all future estimator or rate changes can restate history without destroying the original report.

This standard is the final reporting contract for v3.1. Future changes require a version increment and preserved historical methodology.