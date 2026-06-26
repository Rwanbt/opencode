#requires -Version 5.1
<#
.SYNOPSIS
    OpenCode smoke test with runtime error detection.

.DESCRIPTION
    Launches the OpenCode desktop binary, captures stdout/stderr for the configured
    uptime window, then greps for known-bad runtime patterns. Exits non-zero if any
    pattern is found in stderr — catches context violations (Kobalte/Solid), thrown
    errors, and SolidJS warnings before they manifest as user-visible bugs.

.PARAMETER InstallPath
    Default lookup root for OpenCode.exe.

.PARAMETER ExePath
    Explicit path to OpenCode.exe. Overrides InstallPath lookup.

.PARAMETER WaitSeconds
    Initial grace period before first check (default 10).

.PARAMETER UptimeSeconds
    Total wall-clock time to keep the process alive while sampling stderr (default 60).

.PARAMETER SampleSeconds
    Polling interval for stderr pattern check (default 5).

.PARAMETER KeepOpen
    Do not kill the process at the end; useful for manual inspection.

.EXAMPLE
    .\smoke-test.ps1 -WaitSeconds 5 -UptimeSeconds 30
#>

param(
    [string]$InstallPath = "$env:LOCALAPPDATA\Programs\OpenCode Dev",
    [string]$ExePath = $null,
    [int]$WaitSeconds = 10,
    [int]$UptimeSeconds = 60,
    [int]$SampleSeconds = 5,
    [switch]$KeepOpen = $false
)

$ErrorActionPreference = "Stop"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logDir = "D:\App\OpenCode\opencode\.smoke"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

# Kill any prior instance so we start clean
Get-Process -Name "OpenCode*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "opencode-cli*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# Resolve the binary path
if (-not $ExePath) {
    $ExePath = Get-ChildItem $InstallPath -Filter "OpenCode.exe" -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $ExePath -or -not (Test-Path $ExePath)) {
    $ExePath = "D:\App\OpenCode\opencode\packages\desktop\src-tauri\target\release\OpenCode.exe"
}
if (-not (Test-Path $ExePath)) {
    Write-Host "OpenCode.exe not found at $ExePath"
    exit 1
}

# Patterns we treat as runtime failures if seen in stderr.
# Each entry is matched case-sensitively against lines in stderr; one hit = fail.
$FailurePatterns = @(
    @{ Name = "ErrorPrefix";      Pattern = "Error:" },
    @{ Name = "ContextViolation"; Pattern = "must be used within" },
    @{ Name = "SolidWarning";     Pattern = "Warning: " }
)

function Test-FileForFailures {
    param([string]$Path, [hashtable[]]$Patterns)
    if (-not (Test-Path $Path)) { return @() }
    $hits = @()
    $lines = Get-Content $Path -ErrorAction SilentlyContinue
    foreach ($p in $Patterns) {
        foreach ($line in $lines) {
            if ($line -match [regex]::Escape($p.Pattern)) {
                $hits += [pscustomobject]@{
                    Pattern = $p.Name
                    Line    = $line.Trim()
                }
            }
        }
    }
    return $hits
}

Write-Host "=== OpenCode Smoke Test ==="
Write-Host "Timestamp:    $timestamp"
Write-Host "ExePath:      $ExePath"
Write-Host "LogDir:       $logDir"
Write-Host "Wait:         ${WaitSeconds}s"
Write-Host "Uptime:       ${UptimeSeconds}s (sample every ${SampleSeconds}s)"
Write-Host ""

$stdoutLog = "$logDir\stdout-$timestamp.log"
$stderrLog = "$logDir\stderr-$timestamp.log"
$verdictLog = "$logDir\verdict-$timestamp.json"

Write-Host "Launching..."
$proc = Start-Process -FilePath $ExePath -PassThru `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog
Write-Host "Started PID=$($proc.Id)"

Start-Sleep -Seconds $WaitSeconds

# Phase 1 — crash check
if ($proc.HasExited) {
    Write-Host ""
    Write-Host "STATUS: CRASHED"
    Write-Host "Exit code: $($proc.ExitCode)"
    Write-Host ""
    Write-Host "=== STDERR (last 30 lines) ==="
    if (Test-Path $stderrLog) { Get-Content $stderrLog -Tail 30 | ForEach-Object { Write-Host $_ } }
    Write-Host "=== STDOUT (last 30 lines) ==="
    if (Test-Path $stdoutLog) { Get-Content $stdoutLog -Tail 30 | ForEach-Object { Write-Host $_ } }

    @{ verdict = "FAIL"; reason = "crash"; exitCode = $proc.ExitCode; uptimeSec = $WaitSeconds } |
        ConvertTo-Json -Depth 3 | Set-Content -Path $verdictLog
    exit 1
}

# Phase 2 — periodic stderr scan during uptime window
$elapsed = $WaitSeconds
$fatalHits = @()
$sampleTimes = @()

while ($elapsed -lt $UptimeSeconds) {
    Start-Sleep -Seconds $SampleSeconds
    $elapsed += $SampleSeconds

    $hits = Test-FileForFailures -Path $stderrLog -Patterns $FailurePatterns
    if ($hits.Count -gt 0) {
        $fatalHits = $hits
        $sampleTimes += $elapsed
        break
    }
}

$finalHits = if ($fatalHits.Count -gt 0) {
    $fatalHits
} else {
    # One last scan at end of uptime
    Test-FileForFailures -Path $stderrLog -Patterns $FailurePatterns
}

# Process status snapshot
$stillAlive = -not $proc.HasExited
$mem = if ($stillAlive) { [math]::Round($proc.WorkingSet64 / 1MB, 1) } else { 0 }
$sidecar = Get-Process -Name "opencode-cli*" -ErrorAction SilentlyContinue
$mainWindow = if ($stillAlive) {
    (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue).MainWindowTitle
} else { $null }

Write-Host ""
Write-Host "=== Snapshot @ ${elapsed}s ==="
Write-Host "STATUS:    $(if ($stillAlive) { 'ALIVE' } else { 'EXITED' })"
if ($stillAlive) {
    Write-Host "PID=$($proc.Id)  Memory=${mem}MB"
}
if ($sidecar) {
    Write-Host "SIDECAR:   $($sidecar.Name) PID=$($sidecar.Id)"
} else {
    Write-Host "SIDECAR:   NOT FOUND"
}
if ($mainWindow) {
    Write-Host "WINDOW:    '$mainWindow'"
} else {
    Write-Host "WINDOW:    NONE"
}

Write-Host ""
if ($finalHits.Count -gt 0) {
    Write-Host "=== FAIL — runtime pattern(s) detected in stderr ==="
    foreach ($h in $finalHits | Select-Object -First 20) {
        Write-Host "  [$($h.Pattern)] $($h.Line)"
    }
    Write-Host ""
    Write-Host "First failure observed @ sample-time $(if ($sampleTimes) { $sampleTimes[0] } else { 'end-of-uptime' })s"
    Write-Host "Stderr log: $stderrLog"
} else {
    Write-Host "=== PASS — no Error:/must-be-used-within/Warning: patterns in stderr ==="
}

# Tauri log dump (last 20 lines per log)
$tauriLogDirs = @(
    "$env:APPDATA\com.opencode.dev\logs",
    "$env:APPDATA\OpenCode\logs",
    "$env:LOCALAPPDATA\com.opencode.dev\logs",
    "$env:LOCALAPPDATA\OpenCode\logs"
) | Where-Object { Test-Path $_ }
foreach ($dir in $tauriLogDirs) {
    Write-Host ""
    Write-Host "=== Tauri logs: $dir ==="
    Get-ChildItem $dir -Filter "*.log" -ErrorAction SilentlyContinue |
        Select-Object -First 3 | ForEach-Object {
            Write-Host "  [file: $($_.Name)]"
            Get-Content $_.FullName -Tail 20 | ForEach-Object { Write-Host "    $_" }
        }
}

# Cleanup
if (-not $KeepOpen) {
    if ($stillAlive) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
    Get-Process -Name "opencode-cli*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host ""
    Write-Host "Cleaned up. Use -KeepOpen to inspect manually."
} else {
    Write-Host ""
    Write-Host "Kept open. PID=$($proc.Id). Stop manually with: Stop-Process -Id $($proc.Id) -Force"
}

# Verdict JSON for downstream tooling (CI, dashboards)
$verdict = [ordered]@{
    verdict       = if ($finalHits.Count -gt 0) { "FAIL" } else { "PASS" }
    patternHits   = @($finalHits)
    uptimeSec     = $elapsed
    crashed       = -not $stillAlive
    exitCode      = if (-not $stillAlive) { $proc.ExitCode } else { 0 }
    stderrLog     = $stderrLog
    stdoutLog     = $stdoutLog
    timestamp     = $timestamp
}
$verdict | ConvertTo-Json -Depth 4 | Set-Content -Path $verdictLog

Write-Host ""
Write-Host "Verdict:    $(if ($finalHits.Count -gt 0) { 'FAIL' } else { 'PASS' })"
Write-Host "VerdictLog: $verdictLog"
Write-Host "Smoke test complete."

if ($finalHits.Count -gt 0) { exit 1 }
exit 0