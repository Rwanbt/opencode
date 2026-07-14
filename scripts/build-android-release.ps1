[CmdletBinding()]
param(
  [switch]$UnsignedOnly,
  [string]$KeystorePath = $env:OPENCODE_ANDROID_KEYSTORE,
  [string]$KeystoreAlias = $env:OPENCODE_ANDROID_KEY_ALIAS,
  [string]$KeystorePassword = $env:OPENCODE_ANDROID_KEYSTORE_PASSWORD,
  [string]$KeyPassword = $env:OPENCODE_ANDROID_KEY_PASSWORD
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$mobile = Join-Path $repo 'packages/mobile'
$tauri = Join-Path $mobile 'src-tauri'
$apkRoot = Join-Path $tauri 'gen/android/app/build/outputs/apk'
$artifactDir = Join-Path $repo 'artifacts/android-release'
New-Item -ItemType Directory -Force $artifactDir | Out-Null

if (-not $env:TEMP -or -not $env:TMP) {
  $env:TEMP = Join-Path $repo '.build-temp'
  $env:TMP = $env:TEMP
}
New-Item -ItemType Directory -Force $env:TEMP | Out-Null

Write-Host 'Preparing Android runtime'
& bash (Join-Path $mobile 'scripts/prepare-android-runtime.sh')
if ($LASTEXITCODE -ne 0) { throw 'Android runtime preparation failed' }

Write-Host 'Building unsigned Android release'
Push-Location $mobile
try {
  & bash (Join-Path $mobile 'scripts/build-android.sh')
  if ($LASTEXITCODE -ne 0) { throw 'Tauri Android build failed' }
} finally {
  Pop-Location
}

$unsigned = Get-ChildItem -LiteralPath $apkRoot -Recurse -File -Filter '*unsigned.apk' | Select-Object -First 1
if (-not $unsigned) { throw "No unsigned APK found below $apkRoot" }
$unsignedOut = Join-Path $artifactDir 'opencode-mobile-unsigned.apk'
Copy-Item -LiteralPath $unsigned.FullName -Destination $unsignedOut -Force

& pwsh -NoProfile -File (Join-Path $repo 'scripts/android-runtime-provenance.ps1') -OutputPath 'artifacts/android-release/provenance.json'
if ($LASTEXITCODE -ne 0) { throw 'Provenance generation failed' }

if ($UnsignedOnly) {
  Write-Host "Unsigned APK: $unsignedOut"
  exit 0
}

if ([string]::IsNullOrWhiteSpace($KeystorePath) -or -not (Test-Path -LiteralPath $KeystorePath)) {
  throw 'Release keystore is required. Set OPENCODE_ANDROID_KEYSTORE or use -UnsignedOnly.'
}
if ([string]::IsNullOrWhiteSpace($KeystoreAlias) -or [string]::IsNullOrWhiteSpace($KeystorePassword)) {
  throw 'Release keystore alias and password are required.'
}

$signedOut = Join-Path $artifactDir 'opencode-mobile-release.apk'
Copy-Item -LiteralPath $unsignedOut -Destination $signedOut -Force
$apksigner = Get-Command apksigner -ErrorAction SilentlyContinue
if (-not $apksigner) { throw 'apksigner is required to sign and verify release APKs.' }

& $apksigner.Source sign --ks $KeystorePath --ks-key-alias $KeystoreAlias --ks-pass "pass:$KeystorePassword" --key-pass "pass:$KeyPassword" $signedOut
if ($LASTEXITCODE -ne 0) { throw 'Release APK signing failed' }
& $apksigner.Source verify --verbose $signedOut
if ($LASTEXITCODE -ne 0) { throw 'Release APK signature verification failed' }

$metadata = & $apksigner.Source verify --print-certs $signedOut 2>&1 | Out-String
if ($metadata -match '(?i)CN=Android Debug|androiddebugkey') { throw 'Debug-signed APK rejected' }
Get-FileHash -LiteralPath $signedOut -Algorithm SHA256 | ConvertTo-Json | Set-Content (Join-Path $artifactDir 'opencode-mobile-release.apk.sha256.json')
Write-Host "Release APK: $signedOut"