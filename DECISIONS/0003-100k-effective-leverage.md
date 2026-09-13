# ADR 0003 — 100k Effective Leverage

## Status
Accepted.

## Decision
The platform distinguishes sustained portfolio engineering leverage from burst/effective leverage on highly standardized work.

The long-range optimization target is up to **100,000x effective throughput** for repeatable product-family and deterministic transformation workloads. This is not a claim of 100,000x general software-engineering speed and must never replace the canonical sustained owner-attention metric.

## Required strategy order
For each task, prefer:

1. exact immutable-source solution reuse;
2. deterministic transformation;
3. repair/solution retrieval and compact context compilation;
4. bounded local-model reasoning;
5. speculative candidates only when expected value exceeds compute/verification cost.

## Guardrails
- accepted output, not generated activity, creates leverage credit;
- cache hits are valid only against immutable source/environment identities and still obey policy-defined verification;
- acceleration state is non-authoritative and rebuildable;
- validation, human/provider gates, leases and fencing are never weakened to improve leverage;
- implementation fan-out contracts automatically when verification/composition capacity is saturated.

## Consequence
Scaling is driven primarily by reuse, transformations, micro-sharding and learning from accepted outcomes rather than by simply multiplying coding agents.
