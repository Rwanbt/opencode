param(
  [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$OutputPath = 'artifacts/android-runtime-provenance.json'
)

$ErrorActionPreference = 'Stop'

function Get-ToolVersion([string]$Command) {
  $resolved = Get-Command $Command -ErrorAction SilentlyContinue
  if (-not $resolved) { return $null }
  try { return [string](& $resolved.Source --version 2>$null | Select-Object -First 1) }
  catch { return 'available (version command failed)' }
}

function Get-FileRecord([string]$Path) {
  $file = Get-Item -LiteralPath $Path -ErrorAction Stop
  $hash = Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256
  [ordered]@{
    path = [IO.Path]::GetRelativePath($RepositoryRoot, $file.FullName).Replace([char]92, '/')
    size_bytes = $file.Length
    sha256 = $hash.Hash.ToLowerInvariant()
  }
}

$runtimeRoots = @(
  (Join-Path $RepositoryRoot 'packages/mobile/src-tauri/assets/runtime'),
  (Join-Path $RepositoryRoot 'packages/mobile/src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a'),
  (Join-Path $RepositoryRoot 'packages/mobile/src-tauri/gen/android/app/src/main/assets/runtime'),
  (Join-Path $RepositoryRoot 'packages/mobile/src-tauri/gen/android/app/build/outputs/apk')
)

$files = foreach ($root in $runtimeRoots) {
  if (Test-Path -LiteralPath $root) {
    Get-ChildItem -LiteralPath $root -Recurse -File |
      Where-Object { $_.Extension -in @('.so', '.apk', '.aab', '.tgz', '.wasm') -or $_.Name -in @('bun', 'bash', 'rg', 'opencode-cli.js') } |
      ForEach-Object { Get-FileRecord $_.FullName }
  }
}

$package = Get-Content -Raw (Join-Path $RepositoryRoot 'packages/opencode/package.json') | ConvertFrom-Json
$report = [ordered]@{
  generated_at_utc = [DateTime]::UtcNow.ToString('o')
  repository = $RepositoryRoot
  git_commit = (& git -C $RepositoryRoot rev-parse HEAD).Trim()
  git_branch = (& git -C $RepositoryRoot branch --show-current).Trim()
  application_version = $package.version
  target = 'aarch64-linux-android / arm64-v8a'
  tools = [ordered]@{
    bun = Get-ToolVersion 'bun'
    node = Get-ToolVersion 'node'
    rustc = Get-ToolVersion 'rustc'
    cargo = Get-ToolVersion 'cargo'
    tauri = Get-ToolVersion 'cargo-tauri'
    cmake = Get-ToolVersion 'cmake'
    java = Get-ToolVersion 'java'
    adb = Get-ToolVersion 'adb'
    apksigner = Get-ToolVersion 'apksigner'
  }
  native_artifacts = @($files | Sort-Object path -Unique)
}

$destination = Join-Path $RepositoryRoot $OutputPath
New-Item -ItemType Directory -Force (Split-Path -Parent $destination) | Out-Null
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $destination -Encoding utf8NoBOM
Write-Output "Wrote $destination ($(@($files).Count) artifacts)"