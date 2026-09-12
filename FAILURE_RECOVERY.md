# Failure Recovery

## Failure classes

Every failure is classified before retry:

- transient provider/network;
- deterministic code/test failure;
- dependency/precondition failure;
- environment/tooling failure;
- capacity/resource failure;
- authorization/credential failure;
- human/provider gate;
- conflicting/stale state;
- unknown.

## Retry policy

- Transient failures may retry within bounded policy.
- Deterministic failures route to repair once sufficient evidence exists.
- Dependency/precondition failures do not consume retry attempts; they return to blocked/waiting state.
- Auth/credential/human/provider gates stop autonomous execution and generate an exact required action.
- Repeated identical failures trip a circuit breaker and require a changed repair fingerprint before requeue.
- Unknown failures receive bounded diagnostic enrichment, then stop rather than looping indefinitely.

## Repair loop

`failure -> classify -> repair scope -> apply minimal change -> focused checks -> required verification boundary -> accept or repeat within limit`

Repair history is durable and associated with task, attempt, failure fingerprint and resulting SHA.

## Orphan/stale recovery

On stale worker/host/lease:

1. stop new conflicting claims;
2. reconcile remote branch/PR/workspace evidence;
3. preserve recoverable workspace/artifacts;
4. determine whether the attempt is resumable, repairable or terminal;
5. release/advance fencing generation atomically;
6. only then allow a conflicting scope to be claimed.

## State consistency

GitHub, execution ledger, local worker state and Admin projection must converge on one canonical lifecycle. Contradiction is an explicit degraded/reconciliation state, never silently resolved by choosing the most convenient source.

## Required chaos scenarios

Before high concurrency is considered production-ready, prove:
- worker process death mid-change;
- host loss mid-lease;
- delayed/reordered heartbeat;
- duplicate delivery of the same event;
- verification service outage;
- provider rate limit/outage;
- database transient outage;
- stale branch/head SHA;
- repair repeatedly reproducing the same failure;
- merge-ready artifact becoming outdated before merge;
- deployment failure with known-good rollback.
