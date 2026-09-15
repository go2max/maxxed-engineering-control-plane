# GitHub Resource Harvest for Local-Model Seeding

## Goal

Use GitHub as a continuously refreshed source of proven implementation patterns, evaluation systems, retrieval tooling, training infrastructure, security controls, scientific-computing references, and agent-runtime designs without turning the control plane into a dependency pile or a license-risk sink.

The canonical source registry is `training/sources/github-resource-catalog.json`. It separates four dispositions:

- **adopt** — code or package may be incorporated substantially after provenance/fit review.
- **adapt** — extract the algorithm, contract, test strategy, or architectural pattern into Maxxed-native code; preferred when a whole framework would create unnecessary dependency surface.
- **reference** — learn from the repository, use it for benchmark/reference design, or verify its license before any code incorporation.
- **reject** — explicitly do not use.

## Initial mined surface

The first harvest contains 50 high-value repositories spanning:

- agent orchestration, state graphs, multi-agent systems, and tool execution;
- RAG, indexing, hybrid retrieval, vector search, and retrieval evaluation;
- model evaluation, coding evaluation, agent evaluation, multimodal evaluation, and red-team evaluation;
- local inference, serving, batching, quantization, and model packaging;
- SFT, LoRA/QLoRA, PEFT, DPO/RLHF, and efficient fine-tuning;
- context engineering, observability, traces, and OpenTelemetry-style instrumentation;
- security reasoning, LLM threat taxonomies, static analysis, and semantic code analysis;
- numerical computing, symbolic mathematics, statistics/econometrics, graph theory, classical ML, and deep learning;
- distributed execution and code intelligence.

This is a substrate, not a frozen list. The registry is meant to grow through PRs and automated scans.

## High-priority adoption queue

### Adapt first

1. `run-llama/llama_index` — ingestion/index/retrieval abstractions. Do not import the framework wholesale; map useful contracts into the existing Maxxed source index, context compiler, and semantic graph.
2. `langchain-ai/langgraph` — durable state-graph patterns for long-running agent work. Compare against the current task graph, checkpoint, lease, and reconciliation primitives before adding any runtime dependency.
3. `The-Pocket/PocketFlow` — minimal graph/workflow ideas useful as a complexity baseline and for identifying code we can delete.
4. `AgentOps-AI/agentops` — trace/session concepts useful for agent observability; map into engineering traces and shard observability.
5. `SylphAI-Inc/AdalFlow` — optimization/evaluation patterns for prompt/program tuning; connect conceptually to score-benchmark, policy training, and promotion gates.
6. `modelscope/evalscope`, `evalplus/evalplus`, `THUDM/AgentBench`, and `beir-cellar/beir` — benchmark adapters and scoring patterns for model, coding, agent, and retrieval quality.

### Reference before implementation

High-value model/runtime projects such as `transformers`, `peft`, `trl`, `axolotl`, `unsloth`, `vllm`, `llama.cpp`, and `ollama` remain reference-only in this pass because their license metadata has not yet been independently captured into the registry. They are intentionally blocked from adoption by code.

The same rule applies to scientific and security references until the license-verification lane promotes them.

## Adoption contract

No external source may enter production code merely because it exists in the registry. For `adopt` or `adapt` disposition, all of the following are required:

1. license is independently verified and on the permissive allowlist;
2. repository is not archived;
3. exact source repository and source revision are recorded when code is copied or translated;
4. copied code retains required notices/attribution;
5. adaptation is compared against existing Maxxed implementation to avoid duplicate capability;
6. new dependency cost, attack surface, maintenance cost, and runtime cost are measured;
7. tests prove behavior against Maxxed contracts;
8. secret/privacy scanning passes;
9. benchmark or production evidence demonstrates positive value;
10. the normal PR/proof/promotion path remains authoritative.

Unknown, source-available, copyleft, custom, or otherwise non-allowlisted licenses are reference-only until explicitly reviewed.

## How this seeds the new model

The GitHub harvest should feed three different systems instead of one undifferentiated training corpus:

### 1. Knowledge/retrieval layer

Documentation, architecture explanations, APIs, algorithms, threat models, and benchmark descriptions are indexed with provenance. This information can change without retraining the base model.

### 2. Training layer

Only distilled, reviewable examples are converted into training records. High-value records include:

- correct architecture decisions and rejected alternatives;
- bug/failure -> diagnosis -> repair trajectories;
- code review examples with accepted fixes;
- retrieval/query decomposition examples;
- security findings and remediations;
- benchmark-driven optimization pairs;
- concise tool-selection and agent-routing examples.

Raw third-party repository source is not automatically copied into `training/train`. Source code must first pass licensing/provenance review and then be transformed into a purpose-built training artifact if appropriate.

### 3. Held-out evaluation layer

External benchmark suites are adapters or inspiration for held-out evaluation. Evaluation material must remain isolated from train data. The existing promotion gate remains authoritative and should eventually score a capability vector across coding, repository understanding, infrastructure diagnosis, security/reliability, business reasoning, orchestration/planning, retrieval/RAG, mathematics/statistics, and tool use.

## Continuous harvest loop

The intended steady state is:

`discover -> dedupe -> license verify -> capability map -> compare to existing Maxxed capability -> adopt/adapt/reference/reject -> test -> benchmark -> PR -> production evidence -> outcome store -> training/eval feedback`

The harvest must prefer deletion and reuse over framework accumulation. When an external project shows that an existing Maxxed subsystem can be made materially simpler, simplification counts as a successful harvest even if no external lines of code are copied.

## Machine enforcement

`src/training/github-resource-registry.js` implements the policy surface. `scripts/validate-github-resource-catalog.mjs` and `test/github-resource-registry.test.js` ensure:

- duplicate repositories are rejected;
- dispositions and priorities are valid;
- `adopt`/`adapt` cannot pass with an unverified or non-allowlisted license;
- archived sources cannot be adopted;
- high-priority sources receive an explicit next gate;
- sector coverage is measurable rather than anecdotal.

This intentionally turns GitHub research into a reusable control-plane primitive instead of a one-time document.
