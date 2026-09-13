# Failure Recovery

## Operating principle

The engineering factory must continue making safe progress when any non-authoritative component disappears. Loss of one worker, one host, one model endpoint, Admin, GitHub connectivity, or an external provider may reduce throughput, but must not corrupt durable state or require the entire system to stop.

No individual worker is authoritative or required for progress. Durable control-plane state is authoritative. Workers are replaceable executors operating under bounded leases and fencing generations.

## Non-negotiable invariants

1. Every executable mutation has exactly one durable task/work-packet identity.
2. Every active execution attempt owns a lease with an expiry and fencing generation.
3. A worker may commit execution evidence only while its lease and fencing generation remain current.
4. Expired or superseded workers cannot publish authoritative completion after a newer generation has been issued.
5. Operator commands carry durable command IDs and are deduplicated before side effects.
6. Dispatch never depends on Admin availability.
7. Admin never becomes execution authority; it projects current/stale/partial state and sends bounded semantic commands.
8. Read-path degradation never silently converts stale/partial data into current truth.
9. Retry is bounded and classified. Identical deterministic failures cannot loop indefinitely.
10. Recovery prefers replay/reconciliation over destructive cleanup.
11. The system may reduce concurrency automatically under uncertainty, but may not expand concurrency from stale capacity data.
12. A complete outage of optional providers or model backends must leave deterministic queue/recovery services available.

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

- Transient failures may retry within bounded policy with jitter/backoff.
- Deterministic failures route to repair once sufficient evidence exists.
- Dependency/precondition failures do not consume retry attempts; they return to blocked/waiting state.
- Auth/credential/human/provider gates stop autonomous execution and generate an exact required action.
- Repeated identical failures trip a circuit breaker and require a changed repair fingerprint before requeue.
- Unknown failures receive bounded diagnostic enrichment, then stop rather than looping indefinitely.
- Mutating calls are not blindly retried. They require a durable idempotency key/command ID and server-side deduplication before any automatic replay is permitted.

## Durable command deduplication

Operator and automation commands use a durable command ledger containing at minimum:
- `command_id` unique key;
- semantic action;
- normalized target/scope;
- payload hash;
- received timestamp;
- execution state;
- resulting transition/event IDs;
- response/result hash where applicable.

On duplicate `command_id`:
- identical action/target/payload returns the original result without re-executing side effects;
- conflicting payload for an existing ID is rejected as an integrity error.

## Repair loop

`failure -> classify -> repair scope -> apply minimal change -> focused checks -> required verification boundary -> accept or repeat within limit`

Repair history is durable and associated with task, attempt, failure fingerprint and resulting SHA.

## Worker/host loss

A worker heartbeat is advisory liveness; the lease is the durable ownership boundary.

On heartbeat loss:
1. mark worker suspect without immediately rewriting task truth;
2. stop assigning new work to that worker;
3. wait for the bounded lease to expire unless an explicit safe revocation path exists;
4. reconcile remote branch/PR/workspace/artifact evidence;
5. atomically advance fencing generation before reassigning conflicting scope;
6. requeue resumable work or create a new attempt;
7. reject any late completion from the old generation.

A returning worker re-registers capacity and cannot resume an expired attempt unless the scheduler explicitly reissues ownership.

## Orphan/stale recovery

On stale worker/host/lease:

1. stop new conflicting claims;
2. reconcile remote branch/PR/workspace evidence;
3. preserve recoverable workspace/artifacts;
4. determine whether the attempt is resumable, repairable or terminal;
5. release/advance fencing generation atomically;
6. only then allow a conflicting scope to be claimed.

## Database outage

During loss of durable state access:
- workers stop acquiring new authoritative work;
- already-running workers may finish local build/test work, but completion cannot become authoritative until durable state returns;
- completion evidence is written to a bounded local outbox/spool with checksum and task/attempt/fencing metadata;
- no lease renewal is assumed successful without durable acknowledgement;
- after recovery, the reconciler replays the outbox only if the recorded fencing generation is still current;
- expired generations become non-authoritative evidence only.

The system therefore fails closed on ownership while preserving useful work product.

## Model/provider outage

Model endpoints are replaceable capability providers, not scheduler dependencies.

If a model/provider disappears:
- do not stall deterministic queue/lease/reconciliation services;
- route eligible work to another compatible local model/provider when policy permits;
- downgrade to deterministic/non-LLM work where possible;
- block only tasks whose declared capability cannot currently be satisfied;
- continue build, test, scan, package, reconciliation, cleanup, and evidence processing on unaffected workers.

## Admin/bridge outage

Loss of `admin.techmaxxed.com` or its local bridge must not stop the control plane. The local runtime continues autonomously under last committed policy.

Admin displays `CURRENT | STALE | PARTIAL | INVALID | UNAVAILABLE | SUPERSEDED` and never fabricates current state from a stale cache. When degraded, expansive/resume/recovery actions fail closed while emergency-safe actions that only reduce work may remain available.

## Startup reconciliation

Every control-plane restart begins with reconciliation before normal dispatch expansion:
1. load durable active tasks/claims/leases/locks;
2. mark expired leases recoverable;
3. compare worker registrations/heartbeats with durable ownership;
4. reconcile branch/PR/deployment evidence;
5. drain valid local outboxes;
6. resolve command-ledger duplicates/incomplete transitions;
7. recompute capacity from fresh worker advertisements;
8. enable normal dispatch only after invariants pass.

Startup must be repeatable and safe if interrupted.

## State consistency

GitHub, execution ledger, local worker state and Admin projection must converge on one canonical lifecycle. Contradiction is an explicit degraded/reconciliation state, never silently resolved by choosing the most convenient source.

## Required chaos scenarios

Before high concurrency is considered production-ready, prove:
- worker process death mid-change;
- host loss mid-lease;
- worker returns after lease was reissued;
- delayed/reordered heartbeat;
- duplicate delivery of the same event;
- duplicate operator command with identical command ID;
- conflicting reuse of an existing command ID;
- verification service outage;
- model/provider outage;
- provider rate limit/outage;
- database transient outage during active work;
- control-plane restart with active claims;
- Admin/bridge outage while work continues;
- stale branch/head SHA;
- repair repeatedly reproducing the same failure;
- merge-ready artifact becoming outdated before merge;
- deployment failure with known-good rollback.

A scenario passes only when durable task truth remains correct, duplicate side effects are prevented, stale workers are fenced, and autonomous progress resumes without manual database surgery.
