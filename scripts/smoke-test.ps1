param(
    [string]$InstallPath = "$env:LOCALAPPDATA\Programs\OpenCode Dev",
    [string]$ExePath = $null,
    [int]$WaitSeconds = 10,
    [switch]$KeepOpen = $false
)

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logDir = "D:\App\OpenCode\opencode\.smoke"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

# Kill any prior instance
Get-Process -Name "OpenCode*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "opencode-cli*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# Locate the binary
if (-not $ExePath) {
    $ExePath = Get-ChildItem $InstallPath -Filter "OpenCode.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $ExePath -or -not (Test-Path $ExePath)) {
    $ExePath = "D:\App\OpenCode\opencode\packages\desktop\src-tauri\target\release\OpenCode.exe"
}
if (-not (Test-Path $ExePath)) {
    Write-Host "OpenCode.exe not found at $ExePath"
    exit 1
}

Write-Host "=== OpenCode Smoke Test ==="
Write-Host "Timestamp: $timestamp"
Write-Host "ExePath:   $ExePath"
Write-Host "LogDir:    $logDir"
Write-Host "Wait:      ${WaitSeconds}s"
Write-Host ""

# Launch
$stdoutLog = "$logDir\stdout-$timestamp.log"
$stderrLog = "$logDir\stderr-$timestamp.log"
Write-Host "Launching..."
$proc = Start-Process -FilePath $ExePath -PassThru -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
Write-Host "Started PID=$($proc.Id)"

# Wait for grace period
Start-Sleep -Seconds $WaitSeconds

# Outcome
if ($proc.HasExited) {
    Write-Host ""
    Write-Host "STATUS: CRASHED"
    Write-Host "Exit code: $($proc.ExitCode)"
    Write-Host ""
    Write-Host "=== STDERR (last 30 lines) ==="
    if (Test-Path $stderrLog) { Get-Content $stderrLog -Tail 30 | ForEach-Object { Write-Host $_ } }
    Write-Host "=== STDOUT (last 30 lines) ==="
    if (Test-Path $stdoutLog) { Get-Content $stdoutLog -Tail 30 | ForEach-Object { Write-Host $_ } }
    exit 1
}

$mem = [math]::Round($proc.WorkingSet64 / 1MB, 1)
Write-Host ""
Write-Host "STATUS: ALIVE"
Write-Host "PID=$($proc.Id)  Memory=${mem}MB"

# Sidecar detection
$sidecar = Get-Process -Name "opencode-cli*" -ErrorAction SilentlyContinue
if ($sidecar) {
    Write-Host "SIDECAR ALIVE: $($sidecar.Name) PID=$($sidecar.Id)"
} else {
    Write-Host "SIDECAR: NOT FOUND"
}

# Window detection
$mainWindow = (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue).MainWindowTitle
if ($mainWindow) {
    Write-Host "WINDOW: '$mainWindow'"
} else {
    Write-Host "WINDOW: NONE (webview may be loading or hidden)"
}

# Tauri logs
$tauriLogDirs = @(
    "$env:APPDATA\com.opencode.dev\logs",
    "$env:APPDATA\OpenCode\logs",
    "$env:LOCALAPPDATA\com.opencode.dev\logs",
    "$env:LOCALAPPDATA\OpenCode\logs"
) | Where-Object { Test-Path $_ }
foreach ($dir in $tauriLogDirs) {
    Write-Host "=== Tauri logs: $dir ==="
    Get-ChildItem $dir -Filter "*.log" -ErrorAction SilentlyContinue | Select-Object -First 3 | ForEach-Object {
        Write-Host "  [file: $($_.Name)]"
        Get-Content $_.FullName -Tail 20 | ForEach-Object { Write-Host "    $_" }
    }
}

# Cleanup
if (-not $KeepOpen) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Get-Process -Name "opencode-cli*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host ""
    Write-Host "Cleaned up. Use -KeepOpen to inspect manually."
} else {
    Write-Host ""
    Write-Host "Kept open. PID=$($proc.Id). Stop manually with: Stop-Process -Id $($proc.Id) -Force"
}

Write-Host ""
Write-Host "Smoke test complete. Logs: $logDir"
