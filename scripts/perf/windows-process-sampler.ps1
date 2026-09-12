#!/usr/bin/env pwsh
# Windows process sampler (carte A02).
# Échantillonne les processus Windows via WMI/CIM sans lancer l'app Unifia.
# Sortie JSON stable, gestion propre des PIDs inexistants.
#
# Usage:
#   pwsh scripts/perf/windows-process-sampler.ps1 -SelfTest
#   pwsh scripts/perf/windows-process-sampler.ps1 -Pids 1234,5678
#   pwsh scripts/perf/windows-process-sampler.ps1 -InputFile path/to/input.json
#   pwsh scripts/perf/windows-process-sampler.ps1 -Pids 1234 -OutFile out.json

[CmdletBinding()]
param(
    [int[]]$Pids = @(),
    [string]$InputFile = "",
    [string]$OutFile = "",
    [switch]$SelfTest
)

# Snapshot d'un processus par son PID via CIM/WMI.
# Retourne un ordered hashtable (forme JSON stable) ou $null si absent.
function Get-WinProcessSnapshot {
    param([int]$ProcessId)

    $proc = $null
    try {
        $proc = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    } catch {
        return $null
    }

    if ($null -eq $proc) {
        return $null
    }

    $pws = if ($null -eq $proc.PrivateWorkingSetSize) { 0 } else { [double]$proc.PrivateWorkingSetSize }

    return [ordered]@{
        pid             = [int]$proc.ProcessId
        name            = [string]$proc.Name
        path            = if ($null -eq $proc.ExecutablePath) { "" } else { [string]$proc.ExecutablePath }
        workingSetMb    = [math]::Round([double]$proc.WorkingSetSize / 1MB, 2)
        privateBytesMb  = [math]::Round($pws / 1MB, 2)
        threads         = [int]$proc.ThreadCount
        handles         = [int]$proc.HandleCount
        parentPid       = [int]$proc.ParentProcessId
    }
}

# Sérialisation JSON stable (respecte l'ordre de [ordered]@{}).
function ConvertTo-StableJson {
    param($Payload, [int]$Depth = 10)
    return $Payload | ConvertTo-Json -Depth $Depth
}

# Lit un fichier JSON { "pids": [...] } et retourne la liste.
function Read-PidsFromFile {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        throw "Input file not found: $Path"
    }
    $content = Get-Content -Path $Path -Raw -Encoding utf8
    $data = $content | ConvertFrom-Json
    if ($null -ne $data.pids) {
        return @($data.pids | ForEach-Object { [int]$_ })
    }
    return @()
}

if ($SelfTest) {
    $cases = @()

    # 1. PID inexistant retourne $null
    $ghost = Get-WinProcessSnapshot -ProcessId 999999
    $cases += [ordered]@{ name = "non-existent-pid"; passed = ($null -eq $ghost) }

    # 2. PID courant retourne un snapshot valide
    $self = Get-WinProcessSnapshot -ProcessId $PID
    $cases += [ordered]@{ name = "self-pid"; passed = ($null -ne $self -and $self.pid -eq $PID) }

    # 3. Sortie stable : deux appels consécutifs produisent la même forme JSON
    $a = (Get-WinProcessSnapshot -ProcessId $PID) | ConvertTo-StableJson
    $b = (Get-WinProcessSnapshot -ProcessId $PID) | ConvertTo-StableJson
    $cases += [ordered]@{ name = "stable-output"; passed = ($a -eq $b) }

    # 4. Ordre des clés déterministe (ordered hashtable + 8 clés obligatoires)
    $keys = (Get-WinProcessSnapshot -ProcessId $PID).Keys -join ","
    $expected = "pid,name,path,workingSetMb,privateBytesMb,threads,handles,parentPid"
    $cases += [ordered]@{ name = "key-order"; passed = ($keys -eq $expected) }

    $allOk = ($cases | Where-Object { -not $_.passed }).Count -eq 0
    $payload = [ordered]@{
        selftest   = $cases
        allPassed  = $allOk
    }
    ConvertTo-StableJson -Payload $payload -Depth 5
    exit $(if ($allOk) { 0 } else { 1 })
}

# Mode normal : échantillonne les PIDs demandés (Pids ou InputFile)
$requestPids = @()
if ($InputFile -ne "") {
    $requestPids += Read-PidsFromFile -Path $InputFile
}
if ($Pids.Count -gt 0) {
    $requestPids += $Pids
}

$snapshots = @()
$missing = @()
foreach ($p in $requestPids) {
    $snap = Get-WinProcessSnapshot -ProcessId $p
    if ($null -eq $snap) {
        $missing += $p
    } else {
        $snapshots += $snap
    }
}

$payload = [ordered]@{
    timestamp  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    requested  = $requestPids.Count
    found      = $snapshots.Count
    missing    = $missing
    processes  = $snapshots
}

$json = ConvertTo-StableJson -Payload $payload -Depth 10
if ($OutFile -ne "") {
    $json | Out-File -FilePath $OutFile -Encoding utf8 -NoNewline
} else {
    Write-Output $json
}
