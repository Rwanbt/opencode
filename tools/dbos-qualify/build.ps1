# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
#
# Reproducible build for tools/dbos-qualify/dbos-qualify.exe (Windows)
# Uses the repo-local Go toolchain (.tools/go/go1.25.12/) — no admin.
#
# Usage (from repo root):
#   .\scripts\bootstrap-go.ps1
#   .\tools\dbos-qualify\build.ps1

$ErrorActionPreference = 'Stop'

$ToolDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ToolDir '..\..')
$GoBin = Join-Path $RepoRoot '.tools\go\go1.25.12\bin\go.exe'

if (-not (Test-Path $GoBin)) {
  Write-Host "Go toolchain not found at $GoBin"
  Write-Host "Run: .\scripts\bootstrap-go.ps1"
  exit 1
}

Push-Location $ToolDir
try {
  Write-Host "Go version:"
  & $GoBin version

  Write-Host ""
  Write-Host "Module versions:"
  & $GoBin list -m github.com/dbos-inc/dbos-transact-golang
  & $GoBin list -m modernc.org/sqlite

  Write-Host ""
  Write-Host "go mod verify:"
  & $GoBin mod verify

  Write-Host ""
  Write-Host "Building dbos-qualify.exe..."
  & $GoBin build -buildvcs=false -o dbos-qualify.exe .

  $exe = Join-Path $ToolDir 'dbos-qualify.exe'
  Write-Host ""
  Write-Host "Built: $exe"
  Get-ChildItem $exe | Select-Object Name, Length | Format-Table
} finally {
  Pop-Location
}
