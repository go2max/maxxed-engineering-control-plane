# Security and Governance

## Authority model

Automation authority is explicit, scoped and policy-driven. No generic shell, SQL, filesystem, provider mutation or unrestricted command endpoint is exposed through Admin.

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

Every operator action requires:
- authenticated/authorized actor;
- exact target/scope;
- expected state/version/generation;
- idempotency key;
- replay protection;
- reason where disruptive;
- policy validation;
- auditable result.

## Approval validity

Approvals are scoped to the artifact/state they reviewed. Material change to SHA, artifact, policy version, risk class or provider state invalidates stale approval when applicable.

## Secrets and sensitive data

Do not persist or expose:
- credentials/tokens;
- raw local paths when avoidable;
- private prompts/transcripts;
- unredacted customer data;
- signing/encryption secrets;
- unrestricted provider payloads.

Evidence must use sanitized references and checksums where possible.

## Fail-closed rules

New claims fail closed when:
- authorization cannot be verified;
- dependency state is contradictory/stale;
- lease/fencing state is uncertain;
- required acceptance evidence is stale or missing;
- target environment identity cannot be proven.

Independent unaffected work may continue.

## Emergency stop

Emergency stop is independently available, audited and does not depend on the normal scheduler being healthy. Resumption requires reconciliation and current policy validation.
