# Security and Governance

## Authority model

Automation authority is explicit, scoped and policy-driven. No generic shell, SQL, filesystem, provider mutation or unrestricted command endpoint is exposed through Admin or coding workers.

## Human-controlled gates remain binding for

- destructive production changes;
- live payment/provider mutations where policy requires approval;
- production credentials/ownership changes;
- DNS/domain ownership;
- legal/accounting decisions;
- customer communications with material consequence;
- app-store submissions/signing where human ownership is required;
- physical-device acceptance;
- ambiguous product decisions;
- emergency override/force operations.

## Semantic actions

Every operator action requires authenticated/authorized actor, exact target/scope, expected state/version/generation, idempotency key, replay protection, disruptive-action reason where applicable, policy validation and auditable result.

## Coding and Patch Fabric boundaries

Workers may mutate only their assigned isolated workspace and declared mutation scopes. They never write directly to `main`.

Every shard/patch must prove:
- immutable base SHA;
- allowed file/symbol/resource scopes;
- before hashes;
- current lease/fencing generation;
- bounded targeted verification evidence.

Stale-base, stale-generation or out-of-scope writes are rejected. Patch composition requires parent-level verification after integration.

## Network egress

Coding workers should operate with deny-by-default or explicit allowlisted network egress appropriate to the task. Model endpoints, source hosts and approved package registries are separate capabilities. A prompt or generated file must never be able to expand network authority.

## Repository governance

Critical repositories must enforce protected `main` policy/rulesets when account/repository capabilities permit it. Direct unvalidated pushes/merges are not an acceptable long-term authority boundary. Required validation must execute only on approved organization-scoped local runners/workers.

## Cache and reuse safety

Solution/artifact caches are non-authoritative acceleration layers. Exact reuse requires immutable source identity plus compatible policy/environment/toolchain fingerprints. Cache corruption, missing provenance or ambiguity produces a miss, never a relaxed acceptance path.

## Training/model-data governance

Do not train from raw private chats, secrets, credentials or unrestricted workspace transcripts. Harvested trajectories require sanitization, provenance, schema version, source/revocation lineage and train/eval separation. Newly trained models cannot become production-preferred until held-out evaluation and shadow/canary evidence satisfy policy.

## Secrets and sensitive data

Do not persist or expose credentials/tokens, private prompts/transcripts, unredacted customer data, signing/encryption secrets or unrestricted provider payloads. Evidence should use sanitized references and checksums. Training export adds an explicit secret-scanning/redaction gate beyond ordinary runtime logging.

## Supply-chain provenance

Accepted build/release evidence should retain source SHA, toolchain versions, transform/model identity where relevant, dependency/SBOM references and artifact checksums. High-risk releases should support signed attestations as the release architecture matures.

## Fail-closed rules

New claims or acceptance fail closed when authorization, source identity, dependency state, fencing, required evidence, target environment or policy compatibility cannot be proven. Independent unaffected work may continue.

## Emergency stop

Emergency pause/drain is independently available and audited. Patch Fabric, autonomous coding, model inference and release lanes should be independently contractible. Resumption requires reconciliation and current policy validation.
