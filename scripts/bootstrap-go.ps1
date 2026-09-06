#!/usr/bin/env pwsh
# scripts/bootstrap-go.ps1 — repo-local Go toolchain bootstrap (Windows).
#
# Per pack gelé review 2026-09-03 v1.1, the M0 qualification of
# DBOS Go v1.0.0 requires Go 1.25.x. This script downloads the
# official Go archive, verifies its SHA-256, and extracts to
# .tools/go/ (gitignored). No admin rights, no global PATH
# mutation. The SDK itself is NOT committed.

[CmdletBinding()]
param(
  [string]$GoVersion = "go1.25.12",
  [string]$GoOs = "windows",
  [string]$GoArch = "amd64"
)

$ErrorActionPreference = "Stop"

$Tarball = "$GoVersion.$GoOs-$GoArch.zip"
$DownloadBase = "https://go.dev/dl"
$RootDir = Split-Path -Parent $PSScriptRoot
$DestDir = Join-Path $RootDir ".tools/go"
$ToolchainDir = Join-Path $DestDir $GoVersion
$DownloadDir = Join-Path $DestDir ".downloads"
$GoExe = Join-Path $ToolchainDir "bin/go.exe"

if (Test-Path $GoExe) {
  Write-Host "go already bootstrapped at $GoExe"
  Write-Output $GoExe
  exit 0
}

New-Item -ItemType Directory -Path $DownloadDir -Force | Out-Null
Set-Location $DownloadDir

$TarballPath = Join-Path $DownloadDir $Tarball
$ShasumsPath = Join-Path $DownloadDir "SHASUMS256.txt"

Write-Host "Downloading $Tarball from $DownloadBase ..."
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri "$DownloadBase/$Tarball" -OutFile $TarballPath -UseBasicParsing

Write-Host "Downloading SHASUMS256.txt ..."
Invoke-WebRequest -Uri "$DownloadBase/SHASUMS256.txt" -OutFile $ShasumsPath -UseBasicParsing

Write-Host "Verifying SHA-256 ..."
$expected = (Get-Content $ShasumsPath | Where-Object { $_ -match ('^[0-9a-f]{64}\s+\*?' + [regex]::Escape($Tarball) + '$') } | ForEach-Object { ($_ -split '\s+')[0] } | Select-Object -First 1)
if (-not $expected) {
  throw "ERROR: $Tarball not found in SHASUMS256.txt"
}
$actual = (Get-FileHash -Path $TarballPath -Algorithm SHA256).Hash
if ($actual -ne $expected) {
  throw "ERROR: SHA-256 mismatch`n  expected: $expected`n  actual:   $actual"
}
Write-Host "SHA-256 OK: $actual"

Write-Host "Extracting to $ToolchainDir ..."
$extractDir = Join-Path $DestDir "extract"
New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
Expand-Archive -Path $TarballPath -DestinationPath $extractDir -Force
Move-Item -Path (Join-Path $extractDir "go") -Destination $ToolchainDir -Force
Remove-Item -Path $extractDir -Recurse -Force

Write-Host "Cleaning up download ..."
Remove-Item -Path $TarballPath -Force
Remove-Item -Path $ShasumsPath -Force

Write-Host "go bootstrapped at $GoExe"
& $GoExe version
Write-Output $GoExe
