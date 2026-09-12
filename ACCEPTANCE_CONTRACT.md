# Acceptance Contract

Accepted work must prove the change is correct for its risk and product class.

## Baseline acceptance dimensions

- source/branch provenance and expected base;
- build/compile;
- lint/static checks;
- unit tests;
- integration/contract tests;
- security/secret/boundary checks;
- package/artifact integrity where applicable;
- browser/device/accessibility/performance checks when relevant;
- rollback/recovery evidence when risk requires it;
- exact accepted SHA/artifact identity;
- explicit handling of human/provider gates.

## Evidence states

`PASS | FAIL | BLOCKED | NOT_APPLICABLE | UNKNOWN`

`UNKNOWN` and `NOT_RUN` are never silently treated as PASS.

## Tiering

Validation intensity may be tiered by risk/change class, but required checks are policy-controlled. Cost pressure cannot silently suppress mandatory security, data-integrity, release or recovery checks.

## Independent verification

Material implementation must be verified by a distinct verification step/role. The implementer may run focused preflight checks but cannot alone declare final acceptance.

## Reverification

Any change after accepted verification invalidates evidence whose scope includes the changed artifact. Repair loops return to the earliest required verification boundary, not merely the last failing command.

## Completion record

Final accepted record includes task/work-packet IDs, exact SHA/artifact, test/evidence references, risk class, verifier identity/class, acceptance timestamp and any remaining explicit external gate.
