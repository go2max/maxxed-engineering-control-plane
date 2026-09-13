# Work Packet Runtime Reuse

`reuse: internal-canonical`

The control plane consumes the already-accepted Work Packet contract from `go2max/Maxxed-Tech-Site` issue #485 rather than recreating packet membership or eligibility policy.

Canonical upstream schema: `maxxed.work-packet-contract.v1`.

The control plane is responsible only for runtime enforcement:

- validate that the supplied packet envelope matches the task and repository;
- carry packet branch/base/checkpoint metadata into dispatch explanations;
- enforce one active mutation claim for a packet;
- preserve packet scope through claim fencing and recovery;
- reject malformed or mismatched packet metadata fail-closed.

It does **not** independently decide whether tasks belong together. Security/payment/migration/infrastructure/release/human-gated opt-outs and dependency membership remain upstream #485 policy.

This slice also fixes two runtime constraints found during integration:

1. Whole-repository locking previously collapsed configured repository lane limits to one effective mutation lane. Tasks with explicit bounded mutation scopes may now run concurrently when their scopes are disjoint; tasks without scopes remain whole-repository locked.
2. Deployment work is globally serialized. Verification, repair, and unrelated implementation lanes remain eligible while a deployment is active.

Execution validation remains deferred to the approved self-hosted validation lane; repository review/mergeability is not execution proof.
