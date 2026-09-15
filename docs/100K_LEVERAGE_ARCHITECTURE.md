# 100K Effective-Leverage Architecture

## Objective

Preserve strong sustained owner-attention leverage across mixed engineering while making **50k-100k effective/burst leverage** possible for repeatable portfolio/product-family operations.

The current measured operating baseline is approximately **86x average effective engineering throughput**. The existing **300x sustained** stage remains the next major checkpoint, not the ceiling. The mature architecture should continue improving mixed-work leverage as reuse, deterministic execution, micro-sharding, context compilation, verification capacity, repair memory and product-family factories compound.

The mechanism is compounding reuse, not unlimited agent count.

The supporting second-pass cross-sector audit, engineering-hour estimates and phase-by-phase leverage model are maintained in [`AI_AGENT_100K_ACCELERATION_AUDIT.md`](AI_AGENT_100K_ACCELERATION_AUDIT.md).

## Decision order

Every coding/maintenance task should attempt the cheapest safe path first:

1. **Exact reuse** — content-addressed accepted solution for the same immutable source/policy/environment identity.
2. **Deterministic transform** — known codemod/recipe applied without model reasoning.
3. **Retrieval-assisted execution** — compact dependency slice plus proven prior solutions/repairs.
4. **Novel reasoning** — bounded local coding model/agent.
5. **Speculative fan-out** — multiple candidates only when expected value/risk/novelty justifies extra verifier load.

## AI-agent operating rule

The control plane should optimize AI-agent work around **typed work packets**, not free-form repo exploration. The platform should deterministically provide objective, constraints, immutable source identity, capability/product-family context, mutation scope, dependencies, policy version, risk class, acceptance contract, rollback profile and required evidence. Agents should infer only what cannot be known mechanically.

## Compounding primitives

### Solution CAS
Key accepted solutions by normalized task class/spec, immutable source fingerprint, dependency slice, environment and policy version. Store evidence/artifact lineage, confidence and reusable tags.

### Artifact cache
Cache deterministic build/test/index/package outputs by exact inputs/toolchain/environment. Invalidations are explicit and tags are secondary to content identity.

### Semantic code graph
Maintain repository/product/file/symbol/dependency/test relationships. Context compilation selects the smallest relevant slice rather than sending entire repositories to models.

### Transform registry
Known migrations and maintenance operations are encoded as deterministic transformations. Declarative transforms are restart-persistent; arbitrary function-backed transforms are runtime-only unless promoted through a reviewed adapter.

### Repair memory
Failure fingerprints map to previously accepted repair strategies and artifacts. Repair memory provides retrieval context; verification remains mandatory.

### Trajectory harvester
Sanitized accepted/rejected task trajectories become training/eval material. Secrets/private transcripts are excluded. Held-out evals remain separate from training.

### Product-family planner
Shared SaaS/mobile/plugin foundations are versioned once. New products and cross-portfolio changes are computed as deltas from a canonical baseline.

### Replayable execution history
Durable events reconstruct task/claim/acceptance projections after restart and support audit/debug/recovery. Replayed projections do not resurrect expired authority.

### Maintenance fan-out
One approved deterministic change can be batched across many repositories with exact source fingerprints, bounded concurrency and parent-level reporting.

### Bottleneck optimizer
Throughput is governed by the current bottleneck: reasoning, worker capacity, verification, repair, composition, merge or deployment. Adding implementation lanes while verification is saturated is prohibited.

## Micro-lane multiplier

Large work can be decomposed into patch shards. Weak machines can process mechanical edits/tests/indexing while strong machines handle novel reasoning. Composition produces one integration branch and parent acceptance contract.

This enables throughput to scale with available PCs/servers without multiplying PR/review overhead.

## Product-family multiplier

Portfolio size becomes leverage only when repeated products are represented as **baseline + delta** rather than separately reasoned implementations. The target execution shape is:

`one accepted capability mutation -> family baseline update -> deterministic regeneration -> impact-selected verification -> staged release across every applicable product`

This is the main path from high hundreds or low thousands of sustained leverage toward **50K-100K effective/burst leverage** on standardized work.

## Safety requirements

- immutable source SHA for exact reuse and deterministic precomputed writes;
- no direct worker mutation of `main`;
- lease/fencing validation before publication;
- mutation-scope enforcement and before-hash checks;
- independent verification after every reuse/transform/shard composition path;
- caches/indexes/training stores remain disposable acceleration layers;
- high-risk production/provider mutations retain human/policy gates;
- local organization runners are the only permitted GitHub Actions compute path.

## Vetted permissive reference projects

Patterns were reviewed from permissive projects including Tree-sitter, ast-grep, Temporal and Hatchet; their repositories currently expose MIT licenses. The Maxxed runtime does not require these projects. Adapters may be introduced later with license/provenance records and local fallbacks.

## Success criteria

The leverage fabric succeeds when:

- novel reasoning becomes a minority path for standardized work;
- accepted throughput rises without corresponding growth in owner intervention, verifier debt, rollback rate or infrastructure spend;
- semantic duplicate work trends toward zero;
- deterministic/reuse paths dominate repeated portfolio operations;
- verification remains independent and evidence-bound;
- net portfolio complexity per accepted capability declines as the portfolio grows;
- measured leverage replaces modeled leverage at every stage checkpoint.
