# End-State Architecture

## Logical flow

`Planning repository -> portfolio graph -> eligibility engine -> priority scorer -> capacity broker -> execution lanes -> verification lanes -> repair lanes -> acceptance gate -> merge/release authority -> production verification -> telemetry -> scheduler feedback`

Maxxed Admin is the protected operator surface over this loop. It does not become a second execution source of truth.

## Major components

### 1. Planning authority
Versioned architecture intent, roadmap milestones, ADRs, budget/capacity policy, leverage targets and cross-repo dependencies live in this repository and are projected into Admin by exact source SHA.

### 2. Portfolio graph
Normalizes repositories, products, issues, Work Packets, dependencies, blockers, risk and owner policy into a dependency-aware graph. It computes executable frontier, blocked frontier, critical path and dependency-unlock value.

### 3. Eligibility engine
Determines whether work may be claimed. Dependency completeness, stale-state checks, human/provider gates, WIP policy, risk policy and environment readiness are authoritative. Priority never overrides eligibility.

### 4. Priority scorer
Ranks only eligible work using configurable evidence such as business priority, launch proximity, dependency unlocks, revenue/valuation contribution, age, product-factory leverage, risk and estimated effort.

### 5. Capacity broker
Matches work to available lanes using repository/tool/platform requirements, CPU/RAM/disk, worker/model capability, current WIP, expected duration and verification/repair capacity.

### 6. Execution fabric
Each mutation runs in an isolated workspace/worktree/container or equivalent bounded environment. Claims, leases, fencing tokens and scope locks prevent conflicting writers.

### 7. Role-separated agents
Planning, implementation, verification, repair and release roles have distinct authority. Important work is not self-certified by the same execution step that created it.

### 8. Verification fabric
Deterministic acceptance contracts cover build, lint, tests, security, packaging, artifact integrity, browser/device checks where relevant, and product-specific completion evidence.

### 9. Repair controller
Failures are classified and routed through bounded repair loops. Deterministic/non-retryable failures stop immediately. Repair changes are reverified from the relevant acceptance boundary.

### 10. Merge/release authority
Existing canonical safety and approval policies remain authoritative. Production deployment stays serialized unless a later explicit architecture decision changes that rule.

### 11. Telemetry and economics
Accepted-output facts, intervention facts, lane utilization, queue wait, rework, repair success, cost/capacity and bottlenecks are aggregated incrementally and fed back into scheduling and Admin.

## Scalability rule

No core contract may assume one host, one model vendor, four workers, one verifier, one repository, one queue or manual lane feeding. Concurrency is policy- and capacity-driven.

## Backpressure

Implementation starts must be constrained by downstream capacity. If verification or repair becomes congested, scheduler capacity for new implementation contracts automatically. More implementation throughput is not considered progress if accepted throughput does not increase.

## Source-of-truth hierarchy

1. Product repository + canonical issue/PR/release evidence for implementation truth.
2. Execution ledger for active claim/lease/attempt truth.
3. Planning repository for strategic intent.
4. Admin as a derived operator projection and semantic-action surface.

Conflicts are surfaced explicitly; no layer silently overwrites another.
