# Autonomous Local Validation

## Goal

Treat validation as first-class scheduled engineering work instead of coupling it exclusively to GitHub Actions availability.

The control plane can schedule exact-SHA validation jobs across the local compute fabric using the same portfolio scheduler, claims, fencing, pressure controls, and failover behavior used for coding work.

## Contract

`compileValidationTask(...)` produces a model-free task with:

- exact 40-character source SHA;
- repository identity;
- ordered bounded validation steps;
- inferred/explicit worker capability requirements;
- restartable execution semantics;
- acceptance checks matching the validation step names;
- promotion suppression;
- no model request.

Execution kind:

```text
validation-agent
```

## Autonomous scheduling

The continuous engineering loop dispatches both:

- `coding-agent`
- `validation-agent`

Validation tasks use the normal scheduler and claim authority. They therefore inherit:

- worker capability matching;
- capacity/pressure contraction;
- lease generation/fencing;
- offline reassignment;
- stale-result rejection;
- verifier evidence and ledger recording.

## Evidence

Worker validation results are normalized into the existing verifier evidence shape. Each step becomes a named check with success/failure, exit code, timeout, duration, stdout, and stderr. Exact source SHA and repository are retained as artifacts.

## Training boundary

Validation execution is not code generation. Validation tasks are deliberately excluded from solution-cache and trajectory harvest. Their worker outcomes may still improve worker-performance/specialization data.

## Publication boundary

Local validation is not permission to merge. The intended sequence is:

```text
exact source SHA
-> local fabric validation
-> accepted verifier evidence
-> org-scoped local GitHub Actions publication gate
-> repository merge policy
```

This keeps engineering throughput moving when GitHub Actions capacity is offline without weakening the final merge boundary.
