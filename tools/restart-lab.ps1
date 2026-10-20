# Restart the lab, all the way down and all the way up. Elevated.
#
# Why this exists: on 2026-10-20 the lab had been running since 16:01 while the source had
# moved on, so a fix that was green in `npm run selftest` (the search rule: `q` now filters
# instead of answering the whole catalog) was not the code the phone was talking to. A green
# suite proves the source, never the process. `POST /__lab/reload` does not help here either:
# it re-reads `config.json` only, so every code change needs this.
#
# Why it is elevated and why it kills by port rather than by name: the lab binds :53, so it
# runs as Administrator. A non-elevated prompt cannot stop it (`Accesso negato`, measured), and
# `Get-CimInstance Win32_Process` shows an **empty CommandLine** for it from a non-elevated
# caller - so a kill that looks for `src/main.mjs` in the command line finds nothing, kills
# nothing, and would report success. The ports are what identify the process here.
#
#   1. find the processes that own 80, 443, 8899 (tcp) and 53 (udp), refuse to touch anything
#      that is not node,
#   2. stop them, and wait until the ports are actually free,
#   3. start `node src/main.mjs` detached, with its own log under logs/,
#   4. wait for /__lab/status to answer and for the listeners to reappear, and write the
#      outcome to logs/lab-restart.txt - the report is a file because the elevated window
#      closes on its own.
#
# Run it through the wrapper, which raises the UAC prompt by itself:
#
#   tools\restart-lab.cmd
#
# ...or from an already-elevated prompt:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\restart-lab.ps1

param(
  [string]$Config = 'config.json',
  [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$logDir = Join-Path $root 'logs'
if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$labLog = Join-Path $logDir "lab-$stamp.log"
$labErr = Join-Path $logDir "lab-$stamp.err.log"
$report = Join-Path $logDir 'lab-restart.txt'
$pidFile = Join-Path $logDir 'lab.pid'

$lines = New-Object System.Collections.Generic.List[string]
function Say([string]$m) { $lines.Add($m); Write-Host $m }
function Save { Set-Content -LiteralPath $report -Value ($lines -join "`r`n") -Encoding UTF8 }

Say ("restart-lab  " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Say ("root         " + $root)
Say ("config       " + $Config)

$elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
Say ("elevated     " + $elevated)

# --- 1. who owns the lab's ports -------------------------------------------------------
# PID -> the ports it holds, so a foreign holder can be named instead of mistaken for the lab.
$holders = @{}
$ports = @(80, 443, 8899)
foreach ($p in $ports) {
  $conns = @(Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue)
  foreach ($c in $conns) {
    if ($c.OwningProcess -gt 4) {
      if (-not $holders.ContainsKey([int]$c.OwningProcess)) { $holders[[int]$c.OwningProcess] = @() }
      $holders[[int]$c.OwningProcess] += ("" + $p + "/tcp")
    }
  }
}
# The DNS listener is UDP, which Get-NetTCPConnection never reports. Port 53 needs its own
# reading, and it is the one that produced a false abort: Windows ICS parks a svchost on
# 0.0.0.0:53 while the lab binds the LAN address (192.168.0.220:53) - so port 53 has TWO
# owners on this machine, and only one of them is the lab.
$udp = @(Get-NetUDPEndpoint -LocalPort 53 -ErrorAction SilentlyContinue)
foreach ($u in $udp) {
  if ($u.OwningProcess -gt 4) {
    if (-not $holders.ContainsKey([int]$u.OwningProcess)) { $holders[[int]$u.OwningProcess] = @() }
    $holders[[int]$u.OwningProcess] += ("53/udp " + $u.LocalAddress)
  }
}

$labPids = @()
foreach ($procId in @($holders.Keys | Sort-Object)) {
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  $on = ($holders[$procId] -join ', ')
  if (-not $proc) { Say ("old          pid " + $procId + " vanished before the stop (was on " + $on + ")"); continue }
  if ($proc.ProcessName -ne 'node') {
    # Never touched: this is a system service sharing the port (see above), not the lab.
    Say ("old          pid " + $procId + " " + $proc.ProcessName + " holds " + $on + " - system, left alone")
    continue
  }
  $labPids += $procId
}

if ($labPids.Count -eq 0) {
  Say 'old          no node process on the lab ports - nothing to stop'
} else {
  foreach ($procId in $labPids) {
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    $started = ''
    try { $started = $proc.StartTime.ToString('yyyy-MM-dd HH:mm:ss') } catch { }
    try {
      Stop-Process -Id $procId -Force -ErrorAction Stop
      Say ("old          pid " + $procId + " stopped (started " + $started + ", on " + ($holders[$procId] -join ', ') + ")")
    } catch {
      Say ("old          pid " + $procId + " stop failed: " + $_.Exception.Message)
      & taskkill.exe /F /PID $procId 2>&1 | ForEach-Object { Say ("             " + $_) }
    }
  }
}
Save

# --- 2. wait for the lab's TCP ports to be free ----------------------------------------
# Only 80/443/8899 are checked: a svchost on 53/udp is not the lab and is not going away.
$busy = @()
$deadline = (Get-Date).AddSeconds(10)
do {
  $busy = @()
  foreach ($p in $ports) {
    if (@(Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue).Count -gt 0) { $busy += $p }
  }
  if ($busy.Count -eq 0) { break }
  Start-Sleep -Milliseconds 300
} while ((Get-Date) -lt $deadline)
if ($busy.Count -gt 0) {
  Say ("ports        still busy after 10s: " + ($busy -join ', '))
  Say 'result       ABORTED - the old lab is still holding its ports (run this elevated)'
  Save
  exit 3
}
Say 'ports        80/443/8899 free'

# --- 3. start it ------------------------------------------------------------------------
$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) { Say 'result       ABORTED - node not found in PATH'; Save; exit 1 }
$proc = Start-Process -FilePath $node.Source -ArgumentList @('src/main.mjs', "--config=$Config") `
  -WorkingDirectory $root -WindowStyle Hidden `
  -RedirectStandardOutput $labLog -RedirectStandardError $labErr -PassThru
Say ("new          pid " + $proc.Id)
Say ("log          " + $labLog)
Say ("errlog       " + $labErr)
Set-Content -LiteralPath $pidFile -Value $proc.Id -Encoding ASCII
Save

# --- 4. readiness -----------------------------------------------------------------------
$statusUrl = 'http://127.0.0.1:8899/__lab/status'
$ready = $false
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
  if ($proc.HasExited) { break }
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri $statusUrl -TimeoutSec 2
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
  Start-Sleep -Milliseconds 400
}

if ($proc.HasExited) {
  Say ("result       FAILED - the process exited with code " + $proc.ExitCode)
  if (Test-Path -LiteralPath $labErr) { Get-Content -LiteralPath $labErr -Tail 15 | ForEach-Object { Say ("             " + $_) } }
  if (Test-Path -LiteralPath $labLog) { Get-Content -LiteralPath $labLog -Tail 15 | ForEach-Object { Say ("             " + $_) } }
  Save
  exit 1
}
if (-not $ready) {
  Say ("result       FAILED - /__lab/status did not answer within " + $TimeoutSeconds + "s")
  if (Test-Path -LiteralPath $labLog) { Get-Content -LiteralPath $labLog -Tail 15 | ForEach-Object { Say ("             " + $_) } }
  Save
  exit 1
}

Say 'status       /__lab/status 200'
foreach ($p in $ports) {
  $conns = @(Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue)
  $mine = @($conns | Where-Object { $_.OwningProcess -eq $proc.Id })
  Say ("listen " + $p.ToString().PadRight(6) + $mine.Count.ToString() + " socket(s) owned by pid " + $proc.Id)
}
$udp53 = @(Get-NetUDPEndpoint -LocalPort 53 -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $proc.Id })
Say ("listen 53/udp " + $udp53.Count + " socket(s) owned by pid " + $proc.Id)

# What the process is actually serving, so a restart that did not pick up the source is
# visible rather than assumed.
try {
  $state = (Invoke-WebRequest -UseBasicParsing -Uri $statusUrl -TimeoutSec 3).Content | ConvertFrom-Json
  if ($state.startedAt) { Say ("serving      startedAt " + $state.startedAt) }
} catch { }

Say 'result       OK'
Save
exit 0
