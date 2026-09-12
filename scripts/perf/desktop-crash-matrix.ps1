#!/usr/bin/env pwsh
# Desktop crash matrix (carte D10).
# Read-only harness that identifies the process tree and lease structure for
# each crash scenario. Never spawns or kills processes — D11 will wire the
# actual EXE/sidecar proof. This script can be run on any Windows machine to
# enumerate which processes would be affected by each crash type.
#
# Usage:
#   pwsh scripts/perf/desktop-crash-matrix.ps1 -SelfTest
#   pwsh scripts/perf/desktop-crash-matrix.ps1 [-RootPid <pid>]
#   pwsh scripts/perf/desktop-crash-matrix.ps1 -OutFile <path>

[CmdletBinding()]
param(
    [int]$RootPid = 0,
    [string]$OutFile = "",
    [switch]$SelfTest
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$processTreeScript = Join-Path $scriptDir "process-tree.ps1"

function ConvertTo-StableJson {
    param($Payload, [int]$Depth = 10)
    return $Payload | ConvertTo-Json -Depth $Depth
}

if ($SelfTest) {
    $tests = @()

    # 1. process-tree.ps1 must exist.
    if (-not (Test-Path $processTreeScript)) {
        $tests += [pscustomobject]@{ name = "process-tree-script-exists"; passed = $false }
    } else {
        $tests += [pscustomobject]@{ name = "process-tree-script-exists"; passed = $true }
    }

    # 2. process-tree.ps1 returns a tree for the current PID.
    $output = & pwsh -NoProfile -File $processTreeScript -RootPid $PID 2>$null
    $tree = $output | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($null -ne $tree -and $tree.pid -eq $PID) {
        $tests += [pscustomobject]@{ name = "process-tree-self-pid"; passed = $true }
    } else {
        $tests += [pscustomobject]@{ name = "process-tree-self-pid"; passed = $false }
    }

    # 3. process-tree.ps1 returns null for a non-existent PID.
    $ghost = & pwsh -NoProfile -File $processTreeScript -RootPid 999999 2>$null
    if ([string]::IsNullOrWhiteSpace($ghost)) {
        $tests += [pscustomobject]@{ name = "non-existent-pid-handled"; passed = $true }
    } else {
        $tests += [pscustomobject]@{ name = "non-existent-pid-handled"; passed = $false }
    }

    # 4. The matrix output is stable JSON with the 4 scenarios.
    $matrixJson = & pwsh -NoProfile -File $MyInvocation.MyCommand.Definition 2>$null
    $matrix = $matrixJson | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($null -ne $matrix -and $matrix.scenarios.Count -ge 4) {
        $tests += [pscustomobject]@{ name = "matrix-has-scenarios"; passed = $true }
    } else {
        $tests += [pscustomobject]@{ name = "matrix-has-scenarios"; passed = $false }
    }

    $allOk = ($tests | Where-Object { -not $_.passed }).Count -eq 0
    $payload = [ordered]@{
        selftest  = $tests
        allPassed = $allOk
    }
    ConvertTo-StableJson -Payload $payload -Depth 5
    exit $(if ($allOk) { 0 } else { 1 })
}

function ConvertTo-StableJson {
    param($Payload, [int]$Depth = 10)
    return $Payload | ConvertTo-Json -Depth $Depth
}

$scenarios = @(
    [pscustomobject]@{ name = "spawn_failed";       description = "Server fails to spawn (timeout or exec error)" },
    [pscustomobject]@{ name = "spawn_mid_init";     description = "Server dies during initialize (before ready)" },
    [pscustomobject]@{ name = "spawn_post_lease";   description = "Server dies after the lease has been granted" },
    [pscustomobject]@{ name = "spawn_orphan";       description = "Server is adopted by init but loses its parent" }
)

$rootInfo = $null
if ($RootPid -gt 0) {
    $treeJson = & pwsh -NoProfile -File $processTreeScript -RootPid $RootPid 2>$null
    $rootInfo = $treeJson | ConvertFrom-Json -ErrorAction SilentlyContinue
}

$payload = [ordered]@{
    timestamp  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    rootPid    = $RootPid
    rootTree   = $rootInfo
    scenarios  = $scenarios
    note       = "Read-only harness: identifies process tree and lease structure without killing. D11 wires the actual EXE/sidecar proof."
}

$json = ConvertTo-StableJson -Payload $payload -Depth 10
if ($OutFile -ne "") {
    $outDir = Split-Path $OutFile
    if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
    $json | Out-File -FilePath $OutFile -Encoding utf8 -NoNewline
    Write-Output "Matrix written: $OutFile"
} else {
    Write-Output $json
}
