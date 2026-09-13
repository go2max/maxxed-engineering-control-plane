# Autonomous Coding Runbook

This runbook activates the local-first coding loop at a guarded 2x baseline target.

## Safety boundary

The loop never writes directly to `main`.

The path is:

`task -> fenced control-plane claim -> preferred compute worker -> isolated worktree -> bounded model edits -> independent worker verification -> final lease renewal -> task-branch push -> control-plane acceptance/repair -> GitHub PR`

Repository merge policy remains authoritative after PR creation.

## Preconditions

- Node.js 22+ on the control-plane host and coding workers.
- Compute-fabric controller running and reachable from the control-plane host.
- At least one enrolled worker configured with `coding-agent` capability.
- At least one reachable local model advertised with `coding` capability.
- Local repositories required for coding tasks are present on the worker hosts at their configured `repoPath` values.

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

## Submit a coding task

Use the authenticated control-plane endpoint `POST /coding/tasks` with a bounded contract containing:

- `key`
- `repository`
- `repoPath`
- `objective`
- acceptance checks
- independent `testCommands`

The coding model cannot execute commands directly. Verification commands are executed by the worker under a restricted policy after model editing completes.

## Throughput behavior

Default target:

- baseline concurrency: 2
- target multiplier: 2x
- desired healthy concurrency: 4

The governor contracts toward baseline automatically when:

- verifier backlog exceeds the configured threshold;
- recent terminal/escalated failure rate exceeds the configured threshold;
- runtime readiness is degraded;
- available worker capacity is lower than the desired target.

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

Worker completion is not engineering acceptance. A branch is eligible for PR promotion only after the control-plane verifier accepts the evidence bundle. Repairable failures create a repair task; uncertain external state enters reconciliation; stale claims are ignored.
