# Autonomous Coding Runbook

This runbook activates the local-first coding loop at a guarded throughput target with automatic Patch Fabric micro-lanes when decomposition is profitable.

> Driving a large batch of issues through parallel subagents (implement → wire live → verify
> → merge)? See [`MULTI_AGENT_ORCHESTRATION_PLAYBOOK.md`](./MULTI_AGENT_ORCHESTRATION_PLAYBOOK.md)
> for the process this repo now uses.

## Safety boundary

The loop never writes directly to `main`.

Ordinary path:

`task -> fenced control-plane claim -> compatible compute worker -> isolated worktree -> bounded model/deterministic edits -> independent worker verification -> final lease renewal -> task-branch push -> control-plane acceptance/repair -> GitHub PR`

Micro-lane path:

`parent task -> adaptive shard plan -> fenced shard tasks on available workers -> verified immutable patch bundles -> central composition -> one integration task -> full parent acceptance -> one parent PR`

Repository merge policy remains authoritative after PR creation.

## Reuse-first gate

Before any coding task that writes net-new infrastructure or framework-level code is dispatched,
[`docs/REUSE_FIRST_CHECKLIST.md`](REUSE_FIRST_CHECKLIST.md) runs: existing Maxxed code first, then
mature public GitHub projects, before writing custom code for anything but the remaining
Maxxed-specific delta. This applies to the autonomous coding loop exactly as it applies to human
engineering — the loop's PR must carry a `reuse:` line per
[`.github/pull_request_template.md`](../.github/pull_request_template.md), and
`npm run validate:reuse-gate` enforces it in CI. A duplicate internal implementation found during
the scan is a refactor signal, not something to build around a second time.

## Preconditions

- Node.js 22+ on the control-plane host and coding workers.
- Compute-fabric controller running and reachable from the control-plane host.
- At least one enrolled worker configured with `coding-agent` capability.
- At least one reachable local model advertised with `coding` capability for reasoning-backed work.
- Coding workers can resolve required repositories by `owner/repo` identity from configured local repository roots/cache. A host-specific `repoPath` remains an optional backward-compatible override, not a fleet requirement.

## Install the control plane on Windows

Run from an elevated PowerShell only when your local scheduled-task policy requires it:

```powershell
.\scripts\install-autonomous-coding-task.ps1 `
  -ControlAdminToken '<control-plane-admin-token>' `
  -FabricAdminToken '<fabric-admin-token>' `
  -GitHubToken '<github-token-with-pr-access>' `
  -FabricUrl 'http://127.0.0.1:7788' `
  -BaselineConcurrency 2 `
  -TargetMultiplier 2 `
  -MaxConcurrency 8
```

Tokens are encrypted with Windows DPAPI for the installing user. They are not embedded in the scheduled-task command.

Start immediately:

```powershell
Start-ScheduledTask -TaskName 'Maxxed Autonomous Coding Control Plane'
```

## Enable a coding worker

After one-time worker enrollment, configure automatic startup:

```powershell
.\scripts\install-worker-task.ps1 `
  -ControllerUrl 'http://127.0.0.1:7788' `
  -EnableCodingAgent `
  -ModelEndpoint 'http://127.0.0.1:8080' `
  -ModelName 'local-coder'
```

A worker may advertise coding capability without hosting the model itself. In that case omit `-ModelEndpoint`; the control plane may route the coding task to another advertised local inference endpoint.

For portable repository resolution, configure existing repository roots or permit a managed cache on each worker. The compute-fabric `REPOSITORY_RESOLUTION.md` document defines `MAXXED_REPOSITORY_ROOTS`, `MAXXED_REPO_CACHE_ROOT`, controlled auto-fetch and opt-in auto-clone behavior.

## Submit a coding task

Use the authenticated control-plane endpoint `POST /coding/tasks` with a bounded contract containing:

- `key`
- `repository` as `owner/repo`
- exact immutable `ref` when exact reuse, deterministic transforms or micro-sharding are desired
- `objective`
- acceptance checks
- independent `testCommands`
- optional `repoPath` only for backward-compatible host-specific execution
- optional `microSharding` plan/units for reasoning-backed independent shards

The coding model cannot execute commands directly. Verification commands are executed by the worker under a restricted policy after model editing completes.

## Automatic micro-lanes

The continuous loop can micro-shard an exact-SHA parent when either:

- a deterministic transform materialized multiple independent precomputed writes; or
- the task supplies explicit independent `microSharding.units` with bounded file/symbol/resource scopes.

The shard planner estimates serial execution time against decomposition, worker execution, composition and verification overhead. It leaves the task single-lane when projected savings are not positive or downstream verifier/composer capacity is insufficient.

Critical/destructive/release/payment/migration risk classes remain single-lane under the current policy.

Each accepted shard must return a patch bundle bound to the exact base SHA and lease generation. The worker rejects out-of-scope mutations. The central composer checks conflicts and before/after hashes. Targeted shard checks never satisfy parent acceptance; one composed integration task runs the parent acceptance suite.

## Throughput behavior

The baseline/target multiplier remains policy-driven. The governor contracts toward baseline automatically when:

- verifier backlog exceeds the configured threshold;
- recent terminal/escalated failure rate exceeds the configured threshold;
- runtime readiness is degraded;
- available worker capacity is lower than the desired target;
- micro-shard verifier/composer capacity is insufficient for profitable fan-out.

## Emergency controls

Pause dispatch without stopping the service:

`POST /operator/command`

```json
{
  "commandId": "incident-pause-<unique-id>",
  "action": "pause-dispatch",
  "input": {}
}
```

Immediate Windows process stop:

```powershell
Stop-ScheduledTask -TaskName 'Maxxed Autonomous Coding Control Plane'
```

To reduce load without stopping the service, edit `%USERPROFILE%\.maxxed-control-plane\autonomous-coding.json` and set `targetMultiplier` to `1`, then restart the scheduled task.

## Acceptance rule

Worker completion is not engineering acceptance. A shard is not parent acceptance. A branch is eligible for PR promotion only after the control-plane verifier accepts the applicable full evidence bundle. Repairable failures create a repair task; uncertain external state enters reconciliation; stale claims and stale patch generations are ignored/rejected.
