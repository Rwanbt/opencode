#!/usr/bin/env pwsh
# Bench orchestrator (carte A03).
# Appelle le sampler Windows (A02) N fois, agrège les temps d'exécution,
# calcule p50/p95/p99, et écrit un artifact conforme au schéma A01
# et au contrat A00 §3 (8 champs obligatoires).
#
# Usage:
#   pwsh scripts/perf/bench-startup.ps1 -Scenario startup.cold
#   pwsh scripts/perf/bench-startup.ps1 -Scenario startup.warm -N 5 -OutDir /tmp/test

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Scenario,

    [int]$N = 5,

    [string]$OutDir = "docs/perf-baselines/measurements",

    [string]$SamplerScript = "scripts/perf/windows-process-sampler.ps1",

    [string]$ExecutablePath = $env:UNIFIA_STARTUP_EXECUTABLE,

    [string]$Arguments = "",

    [string]$ReadyUrl = "http://127.0.0.1:4096/global/health",

    [int]$ReadyTimeoutSeconds = 60
)

if ([string]::IsNullOrWhiteSpace($ExecutablePath) -or -not (Test-Path -LiteralPath $ExecutablePath)) {
    throw "A real Unifia executable is required. Pass -ExecutablePath or set UNIFIA_STARTUP_EXECUTABLE; the harness refuses to benchmark sampler overhead."
}

# 1. Contexte de l'environnement
$commit = (& git rev-parse HEAD).Trim()
$shortSha = $commit.Substring(0, 7)
$date = (Get-Date).ToUniversalTime().ToString("yyyyMMdd")
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

# 2. N vrais démarrages Unifia, mesurés jusqu'au endpoint de readiness
$runs = @()
for ($i = 0; $i -lt $N; $i++) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $process = Start-Process -FilePath $ExecutablePath -ArgumentList $Arguments -PassThru
    $ready = $false
    $deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $ReadyUrl -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            if ($response.StatusCode -eq 200) { $ready = $true; break }
        } catch { }
        if ($process.HasExited) { break }
        Start-Sleep -Milliseconds 100
    }
    $sw.Stop()
    if (-not $ready) {
        if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
        throw "Unifia did not become ready at $ReadyUrl within ${ReadyTimeoutSeconds}s (run $($i + 1))."
    }
    $output = & pwsh -NoProfile -File $SamplerScript -Pids $process.Id
    $null = $output | ConvertFrom-Json
    $runs += [ordered]@{
        run = $i + 1
        elapsedMs = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
        pid = $process.Id
    }
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
}

# 3. Agrégation : p50/p95/p99 sur les elapsedMs
$elapsedSorted = @($runs | ForEach-Object { $_.elapsedMs }) | Sort-Object
function Get-Percentile {
    param($Sorted, [double]$P)
    $idx = [math]::Min([math]::Floor($Sorted.Count * $P), $Sorted.Count - 1)
    return [double]$Sorted[$idx]
}
$variance = [ordered]@{
        startupReadyMs = [ordered]@{
        p50 = Get-Percentile $elapsedSorted 0.50
        p95 = Get-Percentile $elapsedSorted 0.95
        p99 = Get-Percentile $elapsedSorted 0.99
    }
}

# 4. Contexte machine + toolchain
$machine = [ordered]@{
    hostname = $env:COMPUTERNAME
    os = "windows"
    cpu = if (Get-Command Get-CimInstance -ErrorAction SilentlyContinue) {
        (Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue).Name
    } else { "unknown" }
    ramMb = if (Get-Command Get-CimInstance -ErrorAction SilentlyContinue) {
        [math]::Round([double](Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue).TotalPhysicalMemory / 1MB, 0)
    } else { 0 }
    gpu = "n/a"
}

$toolchain = [ordered]@{
    pwsh = (pwsh --version) -replace "PowerShell ", ""
    bun = if (Get-Command bun -ErrorAction SilentlyContinue) { (& bun --version) -replace "bun ", "" } else { "n/a" }
}

# 5. Artifact conforme aux 8 champs obligatoires du contrat §3
$artifactPath = "$OutDir/$Scenario.$date.$shortSha.json"
$artifact = [ordered]@{
    source = "bench-startup.$Scenario.v1"
    commit = $commit
    machine = $machine
    toolchain = $toolchain
    N = $N
    variance = $variance
    timestamp = $timestamp
    artifact = $artifactPath
    scenario = $Scenario
    executable = (Resolve-Path -LiteralPath $ExecutablePath).Path
    readyUrl = $ReadyUrl
    runs = $runs
}

# 6. Écriture
$json = $artifact | ConvertTo-Json -Depth 10
if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
}
$json | Out-File -FilePath $artifactPath -Encoding utf8 -NoNewline
Write-Output "Artifact written: $artifactPath"
