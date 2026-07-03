#requires -Version 5.1
<#
.SYNOPSIS
    Static verification of SolidJS Context Provider scopes in OpenCode.

.DESCRIPTION
    Reads scripts/provider-scope.json (registry of Providers and their mount points)
    and verifies three structural invariants:

      1. MOUNTED   — every Provider declared in the registry is still referenced
                     in its declared mount file (catches accidental mount removal).
      2. SOURCED   — every Provider source file exists.
      3. CONSUMED  — every useXxx( callsite in packages/{app,ui}/src that looks
                     like a Provider hook (auto-detected from createSimpleContext
                     destructuring) maps to a hook registered in the registry.

    The CONSUMED check uses an auto-detection heuristic to avoid false positives
    on third-party hooks (useMutation from TanStack Query, useNavigate from
    @solidjs/router, etc.) and custom hooks (useFilteredList, useSessionLayout, ...).

    Scope mismatch (e.g. session-scoped hook used from a shell-only file) is reported
    as a warning, not a failure, because static analysis cannot reliably trace
    component import chains across files.

.PARAMETER RepoRoot
    Root of the OpenCode checkout. Defaults to the parent of this script's directory.

.PARAMETER Strict
    Treat warnings as failures (non-zero exit).

.EXAMPLE
    .\check-provider-scope.ps1
    .\check-provider-scope.ps1 -Strict
#>

param(
    [string]$RepoRoot = (Split-Path -Parent (Split-Path -Parent $PSCommandPath)),
    [switch]$Strict = $false
)

$ErrorActionPreference = "Stop"
$registryPath = Join-Path $PSScriptRoot "provider-scope.json"

if (-not (Test-Path $registryPath)) {
    Write-Host "Registry not found: $registryPath" -ForegroundColor Red
    exit 1
}

$registry = Get-Content $registryPath -Raw | ConvertFrom-Json
$srcRoot = $RepoRoot
$appSrc = Join-Path $srcRoot "packages\app\src"
$uiSrc = Join-Path $srcRoot "packages\ui\src"

if (-not (Test-Path $appSrc)) {
    Write-Host "packages/app/src not found at $appSrc" -ForegroundColor Red
    exit 1
}

$failures = @()
$warnings = @()
$passes = 0

function Add-Failure {
    param([string]$Category, [string]$Message)
    $script:failures += [pscustomobject]@{ Category = $Category; Message = $Message }
}

function Add-Warning {
    param([string]$Category, [string]$Message)
    $script:warnings += [pscustomobject]@{ Category = $Category; Message = $Message }
}

Write-Host "=== OpenCode Provider Scope Check ==="
Write-Host "Repo:    $RepoRoot"
Write-Host "Registry: $registryPath"
Write-Host ""

# --- Auto-detect createSimpleContext-derived hooks ---------------------------
# Pattern: `export const { use: useFoo, provider: FooProvider } = createSimpleContext(...)`
# This is the canonical Provider-hook shape. Any `useFoo()` callsite must have
# FooProvider in the registry.
Write-Host "[0/4] Auto-detecting createSimpleContext-derived hooks..."
$autoDetected = @{}
$srcDirs = @()
if (Test-Path $appSrc) { $srcDirs += $appSrc }
if (Test-Path $uiSrc) { $srcDirs += $uiSrc }

foreach ($dir in $srcDirs) {
    Get-ChildItem $dir -Recurse -Include "*.ts", "*.tsx" -ErrorAction SilentlyContinue | ForEach-Object {
        $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
        if (-not $content) { return }
        # Match: `use: useFoo` inside a destructuring assignment
        $matchesFound = [regex]::Matches($content, '\buse:\s*(use[A-Z][a-zA-Z0-9]*)')
        foreach ($m in $matchesFound) {
            $hookName = $m.Groups[1].Value
            $rel = $_.FullName.Substring($srcRoot.Length + 1) -replace '\\', '/'
            if (-not $autoDetected.ContainsKey($hookName)) {
                $autoDetected[$hookName] = $rel
            }
        }
    }
}
# Build a HashSet[string] for membership tests (KeyCollection.Contains is broken
# under PS — iterates each key instead of checking equality).
$contextHooks = [System.Collections.Generic.HashSet[string]]::new()
foreach ($k in $autoDetected.Keys) { [void]$contextHooks.Add($k) }
Write-Host "        Found $($contextHooks.Count) auto-detected hooks from createSimpleContext."
Write-Host ""

# --- Check 1 + 2: every Provider is SOURCED and MOUNTED -----------------------
Write-Host "[1/4] Verifying Provider sources and mount points..."
foreach ($p in $registry.providers) {
    $sourcePath = Join-Path $srcRoot ($p.source -replace '/', '\')
    if (-not (Test-Path $sourcePath)) {
        Add-Failure "SOURCED" "Provider source missing: $($p.provider) at $sourcePath"
        continue
    }
    $passes++

    $mountFile = $p.mountFile
    $marker = $p.mountMarker
    if (-not $mountFile -or -not $marker) {
        Add-Warning "MOUNTED" "Provider $($p.provider) has no mount info (scope=$($p.scope))"
        continue
    }

    $mountPath = Join-Path $srcRoot ($mountFile -replace '/', '\')
    if (-not (Test-Path $mountPath)) {
        Add-Failure "MOUNTED" "Mount file missing: $mountPath (for $($p.provider))"
        continue
    }

    $mountContent = Get-Content $mountPath -Raw
    if ($mountContent -notmatch "\b$([regex]::Escape($marker))\b") {
        Add-Failure "MOUNTED" "$($p.provider) marker '$marker' not found in $mountFile"
    } else {
        $passes++
    }
}

# --- Check 3: every Provider-hook callsite is registered ---------------------
Write-Host "[2/4] Scanning consumer callsites for createSimpleContext hooks..."

# Build a lookup: hook name -> provider entry(ies) — provider-scope.json may have
# multiple entries for the same hook name under different scopes (e.g., useSDK
# appears under GlobalSDKProvider/app and SDKProvider/directory).
$hookLookup = @{}
foreach ($p in $registry.providers) {
    $h = $p.hook
    if (-not $hookLookup.ContainsKey($h)) {
        $hookLookup[$h] = @()
    }
    $hookLookup[$h] += $p
}

# Only check hooks that come from createSimpleContext. Custom hooks (regular
# functions returning data) and third-party hooks (TanStack Query, Solid Router,
# etc.) are out of scope.
# $contextHooks was built above as a List[string] for safe membership tests.

$consumerHits = @{}
foreach ($dir in $srcDirs) {
    Get-ChildItem $dir -Recurse -Include "*.ts", "*.tsx" -ErrorAction SilentlyContinue | ForEach-Object {
        $file = $_.FullName
        $rel = $file.Substring($srcRoot.Length + 1) -replace '\\', '/'
        $content = Get-Content $file -Raw -ErrorAction SilentlyContinue
        if (-not $content) { return }

        # Match `useFoo(` and `useFoo<...>(`
        $matchesFound = [regex]::Matches($content, '\b(use[A-Z][a-zA-Z0-9]*)\s*[<(]')
        foreach ($m in $matchesFound) {
            $hookName = $m.Groups[1].Value
            if (-not $contextHooks.Contains($hookName)) { continue }
            $key = "$rel::$hookName"
            if (-not $consumerHits.ContainsKey($key)) {
                $consumerHits[$key] = [pscustomobject]@{
                    File = $rel
                    Hook = $hookName
                }
            }
        }
    }
}

Write-Host "        Found $($consumerHits.Count) unique (file,context-hook) callsites."

# For each consumer hit, check the hook is registered in provider-scope.json
$orphans = @()
$registered = 0
foreach ($k in $consumerHits.Keys) {
    $hit = $consumerHits[$k]
    if ($hookLookup.ContainsKey($hit.Hook)) {
        $registered++
    } else {
        $orphans += $hit
    }
}

Write-Host "        Registered: $registered"
Write-Host "        Orphan (auto-detected context hook, no registry entry): $($orphans.Count)"
Write-Host ""

Write-Host "[3/4] Verifying orphan context hooks..."
foreach ($o in $orphans) {
    Add-Failure "CONSUMED" "Context hook '$($o.Hook)' (from createSimpleContext) is used at $($o.File) but has no provider-scope.json entry. Add an entry, or verify it shouldn't be a Provider."
}
$passes += $registered

# --- Scope warnings (soft) --------------------------------------------------
# For each consumer file, check whether the registered provider's scope covers
# the consumer's likely subtree. This is a soft check — only warn on obvious
# mismatches.
foreach ($k in $consumerHits.Keys) {
    $hit = $consumerHits[$k]
    if (-not $hookLookup.ContainsKey($hit.Hook)) { continue }
    $entries = $hookLookup[$hit.Hook]

    $filePath = $hit.File
    $consumerScope = "app"  # default: assume accessible from anywhere
    if ($filePath -match '^packages/app/src/(utils|hooks)/') { $consumerScope = "app" }
    elseif ($filePath -match '^packages/app/src/context/') { $consumerScope = "app" }
    elseif ($filePath -match '^packages/app/src/components/') { $consumerScope = "shell" }
    elseif ($filePath -match '^packages/app/src/pages/session/') { $consumerScope = "session" }
    elseif ($filePath -match '^packages/app/src/pages/(?!session)') { $consumerScope = "shell" }
    elseif ($filePath -match '^packages/app/src/(addons|testing|constants|types|i18n)/') { $consumerScope = "app" }
    elseif ($filePath -match '^packages/ui/src/') { $consumerScope = "ui" }

    $hasCompatScope = $false
    foreach ($entry in $entries) {
        if ($entry.scope -eq "app" -and $consumerScope -in @("app", "shell", "directory", "session", "ui")) {
            $hasCompatScope = $true; break
        }
        if ($entry.scope -eq "shell" -and $consumerScope -in @("shell", "directory", "session")) {
            $hasCompatScope = $true; break
        }
        if ($entry.scope -eq "directory" -and $consumerScope -in @("directory", "session")) {
            $hasCompatScope = $true; break
        }
        if ($entry.scope -eq "session" -and $consumerScope -eq "session") {
            $hasCompatScope = $true; break
        }
        if ($entry.scope -eq "ui" -and $consumerScope -eq "ui") {
            $hasCompatScope = $true; break
        }
    }

    if (-not $hasCompatScope) {
        $providerNames = ($entries | ForEach-Object { $_.provider }) -join ", "
        Add-Warning "SCOPE" "$($hit.Hook) at $($hit.File) — providers [$providerNames] may not be in scope here (consumer-scope=$consumerScope)"
    }
}

# --- Verdict ----------------------------------------------------------------
Write-Host "[4/4] Summary"
Write-Host ""
Write-Host "=== Results ==="
Write-Host "Passes:  $passes"
Write-Host "Failures: $($failures.Count)"
Write-Host "Warnings: $($warnings.Count)"
Write-Host ""

if ($failures.Count -gt 0) {
    Write-Host "FAIL — the following structural invariants are violated:" -ForegroundColor Red
    foreach ($f in $failures | Select-Object -First 30) {
        Write-Host "  [$($f.Category)] $($f.Message)"
    }
    if ($failures.Count -gt 30) {
        Write-Host "  ... and $($failures.Count - 30) more"
    }
    Write-Host ""
}

if ($warnings.Count -gt 0) {
    Write-Host "Warnings (non-blocking unless -Strict):" -ForegroundColor Yellow
    foreach ($w in $warnings | Select-Object -First 20) {
        Write-Host "  [$($w.Category)] $($w.Message)"
    }
    if ($warnings.Count -gt 20) {
        Write-Host "  ... and $($warnings.Count - 20) more"
    }
    Write-Host ""
}

$verdict = if ($failures.Count -gt 0) { "FAIL" }
           elseif ($Strict -and $warnings.Count -gt 0) { "FAIL" }
           else { "PASS" }

Write-Host "VERDICT: $verdict"

if ($verdict -eq "FAIL") { exit 1 }
exit 0