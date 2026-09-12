#!/usr/bin/env pwsh
# Process tree walker (carte D10).
# Walks the Win32_Process tree starting from RootPid, returning a JSON
# representation of the descendant hierarchy. Read-only: only queries WMI,
# never spawns or kills. Used by desktop-crash-matrix.ps1 to identify the
# subtree that a given crash scenario would affect.
#
# Usage:
#   pwsh scripts/perf/process-tree.ps1 -RootPid 1234
#   pwsh scripts/perf/process-tree.ps1 -RootPid $PID  # self (testing)

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [int]$RootPid
)

function Get-ProcessSubtree {
    param([int]$TargetPid)

    $proc = $null
    try {
        $proc = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $TargetPid" -ErrorAction SilentlyContinue
    } catch {
        return $null
    }

    if ($null -eq $proc) {
        return $null
    }

    $children = @()
    try {
        $kids = Get-CimInstance -ClassName Win32_Process -Filter "ParentProcessId = $TargetPid" -ErrorAction SilentlyContinue
        foreach ($child in $kids) {
            $sub = Get-ProcessSubtree -TargetPid $child.ProcessId
            if ($null -ne $sub) { $children += $sub }
        }
    } catch {
        # Best-effort: return what we have so far.
    }

    [pscustomobject]@{
        pid        = [int]$proc.ProcessId
        name       = [string]$proc.Name
        parentPid  = [int]$proc.ParentProcessId
        children   = $children
    }
}

$result = Get-ProcessSubtree -TargetPid $RootPid
if ($null -ne $result) {
    $result | ConvertTo-Json -Depth 20
}
