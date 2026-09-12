# Cost and Capacity Policy

## Principle

Throughput is increased by architecture, reuse, scheduling and local capacity before cloud spend. No service receives a budget increase merely because a higher leverage target exists.

## Initial engineering-platform policy

| Resource | Policy |
|---|---|
| GitHub Actions hosted compute | **$0 target. Self-hosted runners only.** |
| Fly.io Kalshi/prediction host | Separate/excluded workload. Do not scale for engineering automation. |
| Cloudflare | Keep flat unless measured saturation/reliability evidence justifies change. |
| Neon/PostgreSQL | Initial engineering-platform target **<= $40/month**. Optimize before scale-up. |
| Vercel | Keep current capacity until measured pressure exists. |
| Hostinger | Keep current capacity until orchestration/service evidence shows a bottleneck. |
| Claude / ChatGPT subscriptions | Baseline fixed model costs; exhaust included capacity first. |
| Additional model/API usage | Must be separately attributable, budgeted and linked to accepted output. |
| Windows/Mac/self-hosted machines | Preferred elastic build/test/worker capacity when safe and available. |

Actual dollar values belong in the versioned planning manifest/config and may be updated without changing the architectural rule.

## Scale-decision order

Before recommending paid capacity:

1. eliminate duplicate work, polling and write/read amplification;
2. batch, cache and debounce;
3. archive cold history and precompute summaries;
4. improve indexes/query plans and connection pooling;
5. rebalance work across existing local/self-hosted capacity;
6. correct scheduler/backpressure inefficiency;
7. confirm the resource is the measured bottleneck;
8. only then propose a bounded paid capacity increase with expected throughput impact.

## Required cost states

`NORMAL | WATCH | SOFT_LIMIT | HARD_LIMIT | UNKNOWN | EXCLUDED`

Unknown or partial provider evidence must never render as a precise complete total.

## Capacity evidence

### Runners
Track availability, CPU, RAM, disk, concurrent jobs, queue depth, queue wait, productive utilization, failure/retry rate and platform/tool compatibility.

### PostgreSQL
Track compute utilization, connection pressure, storage growth, hot-table growth, query fingerprints, slow/heavy queries, rows read vs returned where available, write amplification and rollup/cache effectiveness.

### Model capacity
Track rate/provider failures, task success by class, queue wait and whether higher-cost routing materially improves acceptance.

## Safety boundary

A cost limit may delay ordinary work but must never silently disable mandatory security, recovery or acceptance checks. Budget/safety conflict becomes an explicit policy decision.
