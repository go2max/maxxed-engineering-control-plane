param(
  [string]$RepoPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$ConfigPath = (Join-Path $HOME '.maxxed-control-plane\autonomous-coding.json'),
  [string]$SecretsPath = (Join-Path $HOME '.maxxed-control-plane\autonomous-coding.secrets.json')
)

$ErrorActionPreference = 'Stop'

function Unprotect-Text([string]$CipherText) {
  if ([string]::IsNullOrWhiteSpace($CipherText)) { return '' }
  $secure = ConvertTo-SecureString $CipherText
  return [System.Net.NetworkCredential]::new('', $secure).Password
}

if (-not (Test-Path $ConfigPath)) { throw "Autonomous coding config not found: $ConfigPath" }
if (-not (Test-Path $SecretsPath)) { throw "Autonomous coding secrets not found: $SecretsPath" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22+ is required.' }
$major = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($major -lt 22) { throw 'Node.js 22+ is required.' }

$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$secrets = Get-Content -Raw $SecretsPath | ConvertFrom-Json

$env:MAXXED_CONTROL_ADMIN_TOKEN = Unprotect-Text $secrets.controlAdminToken
$env:MAXXED_FABRIC_ADMIN_TOKEN = Unprotect-Text $secrets.fabricAdminToken
$githubToken = Unprotect-Text $secrets.githubToken
if (-not [string]::IsNullOrWhiteSpace($githubToken)) { $env:MAXXED_GITHUB_TOKEN = $githubToken }
else { Remove-Item Env:MAXXED_GITHUB_TOKEN -ErrorAction SilentlyContinue }

$env:MAXXED_FABRIC_URL = [string]$config.fabricUrl
$env:MAXXED_CONTROL_HOST = [string]$config.controlHost
$env:MAXXED_CONTROL_PORT = [string]$config.controlPort
$env:MAXXED_CONTROL_STATE_PATH = [string]$config.statePath
$env:MAXXED_BASELINE_CONCURRENCY = [string]$config.baselineConcurrency
$env:MAXXED_TARGET_MULTIPLIER = [string]$config.targetMultiplier
$env:MAXXED_MAX_CONCURRENCY = [string]$config.maxConcurrency
$env:MAXXED_MAX_VERIFIER_BACKLOG = [string]$config.maxVerifierBacklog
$env:MAXXED_MAX_FAILURE_RATE = [string]$config.maxFailureRate
$env:MAXXED_CODING_LOOP_MS = [string]$config.loopMs

Push-Location $RepoPath
try { & node 'src/service/main.js' }
finally {
  Pop-Location
  Remove-Item Env:MAXXED_CONTROL_ADMIN_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:MAXXED_FABRIC_ADMIN_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:MAXXED_GITHUB_TOKEN -ErrorAction SilentlyContinue
}
