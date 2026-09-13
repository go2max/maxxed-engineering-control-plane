param(
  [Parameter(Mandatory=$true)][string]$ControlAdminToken,
  [Parameter(Mandatory=$true)][string]$FabricAdminToken,
  [string]$GitHubToken = '',
  [string]$FabricUrl = 'http://127.0.0.1:7788',
  [string]$RepoPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$ControlHome = (Join-Path $HOME '.maxxed-control-plane'),
  [string]$TaskName = 'Maxxed Autonomous Coding Control Plane',
  [int]$BaselineConcurrency = 2,
  [double]$TargetMultiplier = 2,
  [int]$MaxConcurrency = 8,
  [int]$MaxVerifierBacklog = 8,
  [double]$MaxFailureRate = 0.20,
  [int]$LoopMs = 2000,
  [string]$ControlHost = '127.0.0.1',
  [int]$ControlPort = 7790
)

$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22+ is required.' }
$major = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($major -lt 22) { throw 'Node.js 22+ is required.' }
if ($BaselineConcurrency -lt 1) { throw 'BaselineConcurrency must be at least 1.' }
if ($TargetMultiplier -lt 1) { throw 'TargetMultiplier must be at least 1.' }
if ($MaxConcurrency -lt $BaselineConcurrency) { throw 'MaxConcurrency must be >= BaselineConcurrency.' }
if ($MaxFailureRate -lt 0 -or $MaxFailureRate -gt 1) { throw 'MaxFailureRate must be between 0 and 1.' }

New-Item -ItemType Directory -Path $ControlHome -Force | Out-Null
$configPath = Join-Path $ControlHome 'autonomous-coding.json'
$secretsPath = Join-Path $ControlHome 'autonomous-coding.secrets.json'
$statePath = Join-Path $ControlHome 'state.json'

$config = [ordered]@{
  version = 1
  fabricUrl = $FabricUrl
  controlHost = $ControlHost
  controlPort = $ControlPort
  statePath = $statePath
  baselineConcurrency = $BaselineConcurrency
  targetMultiplier = $TargetMultiplier
  maxConcurrency = $MaxConcurrency
  maxVerifierBacklog = $MaxVerifierBacklog
  maxFailureRate = $MaxFailureRate
  loopMs = $LoopMs
}
$config | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 $configPath

function Protect-Text([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
  return ConvertTo-SecureString $Value -AsPlainText -Force | ConvertFrom-SecureString
}

$secrets = [ordered]@{
  version = 1
  controlAdminToken = Protect-Text $ControlAdminToken
  fabricAdminToken = Protect-Text $FabricAdminToken
  githubToken = Protect-Text $GitHubToken
}
$secrets | ConvertTo-Json -Depth 3 | Set-Content -Encoding UTF8 $secretsPath

$launcher = Join-Path $RepoPath 'scripts\start-autonomous-coding.ps1'
if (-not (Test-Path $launcher)) { throw "Launcher not found: $launcher" }
$pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $pwsh) { $pwsh = (Get-Command powershell -ErrorAction Stop).Source }

$escapedLauncher = $launcher.Replace("'", "''")
$escapedRepo = $RepoPath.Replace("'", "''")
$escapedConfig = $configPath.Replace("'", "''")
$escapedSecrets = $secretsPath.Replace("'", "''")
$arg = "-NoProfile -ExecutionPolicy Bypass -Command `"& '$escapedLauncher' -RepoPath '$escapedRepo' -ConfigPath '$escapedConfig' -SecretsPath '$escapedSecrets'`""

$action = New-ScheduledTaskAction -Execute $pwsh -Argument $arg
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "Installed '$TaskName'."
Write-Host "Target concurrency: $BaselineConcurrency x $TargetMultiplier (max $MaxConcurrency)."
Write-Host "Secrets are DPAPI-encrypted for Windows user '$env:USERNAME' and are not stored in the scheduled-task command."
Write-Host "Start now with: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Emergency stop: Stop-ScheduledTask -TaskName '$TaskName'"
