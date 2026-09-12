# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
#
# Original work. No upstream derivation.
#
# Tests for scripts/check-workbench-security.mjs.
# Exercises both the positive path (clean worktree) and the two negative
# paths required by ADR-1036 §5: a CSP without object-src 'none' must fail
# the guard, and a worktree file containing 'allow-same-origin' must fail it.
#
# Run from the repository root:
#   pwsh -NoProfile -File scripts/tests/check-workbench-security.Tests.ps1

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$guard = Join-Path $repoRoot 'scripts/check-workbench-security.mjs'

function Invoke-Guard {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  $output = & node $guard @Arguments 2>&1
  return @{
    ExitCode = $LASTEXITCODE
    Output   = ($output -join "`n")
  }
}

function Assert-GuardPasses([string[]]$Arguments) {
  $result = Invoke-Guard @Arguments
  if ($result.ExitCode -ne 0) {
    throw "Guard unexpectedly failed (exit $($result.ExitCode)). Output:`n$($result.Output)"
  }
}

function Assert-GuardFails([string[]]$Arguments, [string]$ExpectedMessage) {
  $result = Invoke-Guard @Arguments
  if ($result.ExitCode -eq 0) {
    throw "Guard unexpectedly passed. Output:`n$($result.Output)"
  }
  if ($result.Output -notlike "*$ExpectedMessage*") {
    throw "Guard failed (exit $($result.ExitCode)) but did not mention '$ExpectedMessage'. Output:`n$($result.Output)"
  }
}

Write-Host 'Test 1: positive - guard passes on a clean worktree'
Assert-GuardPasses
Write-Host '  PASS'

Write-Host "Test 2: negative - CSP without object-src 'none' is rejected"
$unsafeObjectSrc = "default-src 'self'; connect-src 'self' http://127.0.0.1:*; img-src 'self' data:; object-src 'self'; frame-ancestors 'none'; frame-src 'self' data:; child-src 'self' data:"
Assert-GuardFails @('--assert-csp', $unsafeObjectSrc, 'test-unsafe-object-src') 'object-src'
Write-Host '  PASS'

Write-Host "Test 3: negative - CSP missing frame-src 'self' data: is rejected"
$missingFrameSrc = "default-src 'self'; connect-src 'self' http://127.0.0.1:*; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; child-src 'self' data:"
Assert-GuardFails @('--assert-csp', $missingFrameSrc, 'test-missing-frame-src') 'frame-src'
Write-Host '  PASS'

Write-Host "Test 4: negative - a file under packages/ containing 'allow-same-origin' is rejected"
$tempFile = Join-Path $repoRoot 'packages/__allow-same-origin-fixture.txt'
$tempCreated = $false
try {
  Set-Content -Path $tempFile -Value 'iframe sandbox="allow-same-origin allow-scripts"' -NoNewline
  $tempCreated = $true
  Assert-GuardFails @() 'allow-same-origin'
  Write-Host '  PASS'
} finally {
  if ($tempCreated -and (Test-Path $tempFile)) {
    Remove-Item -Path $tempFile -Force
  }
}

Write-Host 'Test 5: recovery - guard passes again after the fixture is removed'
Assert-GuardPasses
Write-Host '  PASS'

Write-Host ''
Write-Host 'check-workbench-security guard tests passed.'
