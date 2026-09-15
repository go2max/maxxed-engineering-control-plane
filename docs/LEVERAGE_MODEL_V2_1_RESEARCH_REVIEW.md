# Leverage Model v2.1 — Research and Review Accounting

This document extends `THROUGHPUT_MODEL.md` v2.0. It does not replace accepted-semantic-capability accounting; it decomposes conventional human-equivalent effort so research and review are no longer hidden inside an implementation-only estimate.

## Total conventional-equivalent effort

For every accepted semantic capability, report three independently modeled components:

`H_total = H_implementation + H_research + H_review`

Where:

- `H_implementation` is the conventional human-equivalent effort to design/build/test the accepted change itself;
- `H_research` is the conventional human-equivalent effort that would normally be spent investigating the codebase/domain, reading prior art/docs, reproducing the problem, comparing alternatives, checking licenses/dependencies and establishing the correct approach;
- `H_review` is the conventional human-equivalent effort normally spent on code review, security/reliability review, verification-result review, CI/build/test interpretation, integration review, merge readiness and follow-up review.

These components are output-equivalent effort, not agent wall-clock runtime. They must not be inferred from PR count alone when PR-level evidence is available.

## Implementation component

Continue to use the v2 semantic-capability baseline:

`H_implementation = H_band × R × I × V × N × D`

The existing XS/S/M/L/XL/XXL semantic bands and restrained risk/integration/verification/novelty/dependency modifiers remain authoritative.

## Research component

Research should be scored separately rather than folded into the novelty modifier.

`H_research = H_implementation × Q_research`

Recommended starting ranges:

| Research class | Evidence | Q_research |
|---|---|---:|
| R0 | mechanical/local change; solution already known | 0.05 |
| R1 | normal repo investigation and API/docs lookup | 0.15 |
| R2 | cross-system investigation, reproduction, prior-art/library comparison | 0.25 |
| R3 | architecture/security/economic/domain research with multiple plausible approaches | 0.40 |
| R4 | novel or poorly documented problem requiring broad experimental research | 0.60 |

Persist the research class and evidence used to select it. Reuse-first discovery, benchmark work, incident reproduction, dependency/license investigation and domain-specific research all belong here when a conventional engineer would have performed them.

Do not count repeated research twice when several PRs reuse the same investigation. Attribute shared research to the parent capability or amortize it across the dependent composition group.

## Review component

Review is also explicit:

`H_review = H_implementation × Q_review`

Recommended starting ranges:

| Review class | Evidence | Q_review |
|---|---|---:|
| V0 | tiny low-risk mechanical change with narrow checks | 0.10 |
| V1 | normal code review + focused tests/lint/typecheck | 0.20 |
| V2 | broader integration/build/regression review | 0.30 |
| V3 | security/reliability/data-integrity/economic review, independent verification | 0.45 |
| V4 | release-critical/multi-authority review, canary/rollback/production verification | 0.60 |

The review component is not the same as the existing `V` verification-burden modifier. `V` adjusts implementation complexity because verification requirements change how the capability must be engineered; `H_review` accounts for the separate conventional human effort of inspecting evidence and deciding whether the result is acceptable.

Prevent double counting by keeping execution of tests/builds inside implementation/verification burden and counting human-equivalent interpretation, inspection, review and acceptance work in `H_review`.

## Review/research evidence sources

Prefer observed evidence over defaults. Useful signals include:

- issue/PR investigation notes and explicit prior-art/library searches;
- incident reproduction and root-cause analysis;
- number and breadth of touched subsystems, repositories and external contracts;
- test/build/security/economic evidence referenced in the PR;
- review rounds, requested changes and follow-up repairs;
- independent verifier/evidence-graph coverage;
- canary, rollback and production-verification requirements;
- reuse declarations and avoided-work estimates;
- accepted-outcome telemetry and task-class history.

When those signals are unavailable, use a documented provisional class and lower confidence rather than silently assuming zero research or review.

## Bridge estimate for historical charts

Historical v1 charts used approximately `13.9 h/PR`. That value cannot be treated as a true v2.1 total because it did not independently classify implementation, research and review.

For continuity-only charts before PR-level v2.1 rescoring is complete, use a clearly labeled bridge model:

- legacy implementation proxy: `13.9 h/PR`;
- provisional research allowance: `20%` of implementation;
- provisional review allowance: `20%` of implementation;
- provisional total: `19.46 h/PR`.

`13.9 × (1 + 0.20 + 0.20) = 19.46`

This bridge is intentionally conservative and must be labeled **modeled bridge estimate**, never observed engineering time. It is superseded as soon as semantic PR/capability evidence is scored.

## Reporting

Daily/weekly reports should show at minimum:

- observed accepted PR/capability count;
- implementation-equivalent hours;
- research-equivalent hours;
- review-equivalent hours;
- total conventional-equivalent hours;
- engineering capacity multiplier (`H_total / 8` for a one-day interval);
- owner-attention leverage when owner-intervention telemetry exists;
- confidence and observed-vs-modeled coverage;
- methodology version (`v2.1`).

For a partial current day, label the timestamp explicitly and never annualize/project the partial value unless the projection is separately identified.

## Calibration after landing

As outcome and lifecycle telemetry accumulates, replace fixed research/review classes with learned task-class calibration. Candidate calibration changes still follow the control plane's existing offline replay -> shadow -> benchmark -> canary -> independent promotion gate.

The objective remains independently verified production value per owner-attention hour. Research and review are included because conventional engineering effort is not only typing code; investigation and acceptance work are material parts of the displaced workload.