# PR 017 — Runnable control-plane service

Turns the control-plane libraries into an authenticated Node.js 22 service. The runtime composes task graph, scheduler, claim authority, verification/repair and local-model routing; it can read worker capacity from the local compute fabric, ingest tasks, dispatch work, accept result evidence, expose status/claims, pause/resume scheduling, recover expired claims and persist state atomically.

The service binds to localhost by default and requires `MAXXED_CONTROL_ADMIN_TOKEN`. Compute-fabric integration is local/private and optional; without a fabric admin token the worker provider returns no workers rather than introducing an external dependency.

Engineering Control Plane Core advances from 68% to 82%.
