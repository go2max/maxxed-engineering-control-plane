# Task Contract

Every executable unit must be bounded enough that a worker can determine exactly what it may change and how completion will be judged.

## Required fields

- stable task key;
- canonical repository/product;
- objective;
- allowed scope/resources;
- prohibited scope/actions;
- dependencies and prerequisite evidence;
- risk class;
- task class/size;
- platform/tool requirements;
- expected artifacts;
- acceptance contract reference;
- rollback/recovery expectation;
- human/provider gates;
- dedupe key;
- planning source reference where applicable.

## Eligibility requirements

A task is executable only when:
- dependencies are accepted;
- target repository/environment is available;
- no conflicting scope claim exists;
- risk/policy allows autonomous execution;
- required tool/model/host capacity exists;
- task size fits configured execution budgets;
- no unresolved human/provider gate blocks the task.

Large epics are decomposed rather than repeatedly submitted above execution/context budgets.

## Work Packets

Tightly related same-repository tasks may be grouped only through the canonical Work Packet policy. Member tasks remain independently traceable and accepted. Security, payment, migration, infrastructure or human-gated work may require separate packets or opt out.

## Completion

A worker finishing implementation does not equal task completion. Completion requires the applicable acceptance contract, accepted artifact/SHA and final disposition recorded by the authoritative workflow.
