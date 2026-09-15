# Continuous Investor Metrics Accounting Standard

## Status

Current reporting extension: **v3.2 continuous investor accounting**.

This standard makes engineering and economic leverage reporting an always-on operating requirement. Every material accepted engineering event must update the cumulative investor case rather than waiting for an ad-hoc retrospective.

## Canonical public reporting layers

Investor-facing reporting must use only six explicitly named layers:

1. **Observed** - direct source evidence such as merged PRs, timestamps, model-token records, CI runs, deployments, incidents and owner-activity events.
2. **Derived** - deterministic arithmetic over observed data.
3. **Modeled** - estimator outputs such as conventional-equivalent engineering hours.
4. **Quality-adjusted** - modeled output reconciled against production survival, rework, rollback, incidents and verifier escapes.
5. **Economic** - conventional replacement value and attributable system cost using versioned, current rate cards.
6. **Counterfactual** - avoided work, replacement-team scenarios and sensitivity cases. Counterfactual values must never be presented as observed spend or realized cash savings.

No unlabeled mixture of these layers is permitted in investor-facing material.

## Continuous update rule

Any accepted work that changes one or more of the following must trigger a metric refresh:

- merged PR or accepted semantic capability;
- material commit or cross-repo composition event;
- review, verification or CI result;
- deployment, canary, production verification, rollback, revert, regression, incident or hotfix;
- model/API request with attributable token or tool cost;
- infrastructure, runner, database, storage, egress or external-service cost;
- owner intervention, approval, architecture decision, debugging, release action or manual test;
- reusable component, proof, cache, deterministic transform or avoided-work event;
- commercial outcome tied to an accepted capability.

The reporting ledger is append-only. Historical source evidence is never rewritten. New methodology versions may rescore historical records, but original methodology/version outputs must remain reproducible.

## Canonical GitHub evidence scope

For the owner-authored historical throughput series, use:

`is:pr is:merged author:go2max merged:<explicit date window>`

Do not substitute `user:go2max` for author scope. For exact local-day reporting, use each PR's `merged_at` timestamp and bucket in the reporting timezone.

## Current verified historical counts

As of the v3.2 standard creation window on 2026-09-15, the verified owner-authored merged-PR series is:

- May 2026: 5
- June 2026: 185
- July 2026: 481
- August 2026: 1,235
- September 1-15, 2026: refreshed at report generation time

The September value must be refreshed immediately before any published investor report so the report includes the work used to generate the report itself where applicable.

## Engineering-equivalent accounting

Historical continuity reporting may use the v2.1 bridge only when capability-level evidence is unavailable:

- implementation-equivalent effort: 13.9 h per merged PR;
- research-equivalent effort: 20% of implementation;
- review/verification-equivalent effort: 20% of implementation;
- historical continuity total: 19.46 modeled conventional-equivalent h per merged PR.

This bridge is a modeled continuity series, not literal human clock time. v3 capability-level scoring supersedes it wherever direct semantic evidence exists.

## Economic conversion

Every public dollar value must identify its basis and effective date.

### Conventional labor replacement value

Default national benchmark for broad investor reporting:

- U.S. BLS Professional and Technical Services, June 2026: $51.88 wages + $24.10 benefits = **$75.98 fully-loaded employer compensation per hour**.

For software-role sensitivity reporting, retain the U.S. BLS May 2025 software-developer median annual wage of **$135,980** and software QA/tester median annual wage of **$104,300** as separate role benchmarks.

`fully_loaded_replacement_value = quality_adjusted_conventional_equivalent_hours x applicable_fully_loaded_hourly_rate`

If a capability has a defensible role mix, use role-specific rates. Otherwise use the national professional-and-technical-services benchmark and label it as such.

### Model/API cost

Use actual attributable token/tool records only. Never fabricate token volume from PR count, modeled hours or elapsed time.

Current reference rate cards must be versioned by effective date. Examples at the 2026-09-15 snapshot include:

- OpenAI GPT-5.6 Sol: $4.00/M input, $0.40/M cached input, $20.00/M output.
- OpenAI GPT-5.6 Terra: $2.00/M input, $0.20/M cached input, $12.00/M output.
- OpenAI GPT-5.6 Luna: $0.20/M input, $0.02/M cached input, $1.20/M output.
- Anthropic Claude Sonnet 5: $2.00/M input, $10.00/M output.
- Anthropic Claude Opus 4.8: $5.00/M input, $25.00/M output.

Actual AI spend may be reported only when attributable usage records exist. If usage evidence is absent, investor-facing reports omit the spend total rather than insert a placeholder or inferred number.

## Mandatory investor-facing totals

Every cumulative investor report must show, at minimum:

- reporting period and data-as-of timestamp;
- observed merged PRs and accepted capabilities where available;
- cumulative modeled conventional-equivalent hours;
- equivalent 8-hour engineer-days;
- average equivalent engineer-days produced per calendar day;
- conventional fully-loaded replacement value in dollars;
- salary-only software-developer sensitivity value where useful;
- 25%, 50% and 75% haircut cases for modeled engineering-equivalent output and replacement value;
- current-period throughput rate normalized by day;
- evidence coverage and methodology version;
- quality maturity status for 1d/7d/30d/90d windows where available;
- actual attributable AI/model spend only if sourced;
- actual attributable compute/infrastructure spend only if sourced;
- owner-active hours only if directly observed or clearly labeled inferred;
- VEEL only when both the quality-adjusted numerator and complete attributable-cost denominator have sufficient evidence.

## Public wording standard

Use direct language:

- "Observed merged PRs" for GitHub count evidence.
- "Modeled conventional-equivalent engineering hours" for estimator outputs.
- "Fully-loaded conventional replacement value" for the rate-card conversion.
- "Equivalent engineer-days" for modeled hours divided by 8.

Do not use "actual human hours", "saved payroll", "cash saved" or "literal engineers replaced" unless direct evidence supports those claims.

Do not publish "TBD", "placeholder", "coming soon", "estimated spend" without a measured basis, or internal/admin workflow text in investor-facing artifacts.

## Anti-gaming and completeness

PRs, commits, lines of code, tests, tokens, agents and parallel lanes are evidence, not independent value units. Splitting one semantic capability into many PRs cannot increase accepted-output credit. Rework, failed attempts, reverts and rollback costs are charged separately and cannot inflate output.

Missing evidence lowers confidence; it never defaults to a favorable value.

## Refresh sequence

Before generating any investor-facing report:

1. refresh observed GitHub counts through the report data-as-of time;
2. refresh accepted-capability lineage and deduplication;
3. refresh production-quality/rework evidence;
4. refresh model/API usage and versioned rate cards;
5. refresh infrastructure/compute costs;
6. refresh owner-attention evidence;
7. recompute modeled, quality-adjusted, economic and sensitivity outputs;
8. stamp methodology version, rate-card versions and data-as-of time;
9. generate investor-facing artifact from the canonical ledger;
10. treat work performed to create/merge the reporting change itself as new evidence and refresh once more before publication.

This final self-inclusion refresh is mandatory so published totals do not lag behind the work that produced the report.
