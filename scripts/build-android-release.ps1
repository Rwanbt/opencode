[CmdletBinding()]
param(
  [switch]$UnsignedOnly,
  [string]$KeystorePath = $env:UNIFIA_ANDROID_KEYSTORE,
  [string]$KeystoreAlias = $env:UNIFIA_ANDROID_KEY_ALIAS,
  [string]$KeystorePassword = $env:UNIFIA_ANDROID_KEYSTORE_PASSWORD,
  [string]$KeyPassword = $env:UNIFIA_ANDROID_KEY_PASSWORD,
  [string]$ExpectedCertificateSha256 = $env:UNIFIA_ANDROID_CERT_SHA256
)

$ErrorActionPreference = 'Stop'
$signingLibrary = Join-Path $PSScriptRoot 'lib/android-signing.ps1'
. $signingLibrary

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

# WHY not a bare `bash`: on Windows `bash` resolves to WSL first
# (C:\Windows\System32\bash.exe). WSL cannot see `D:/App/...` — it would need
# `/mnt/d/App/...` — and, more importantly, the Android SDK/NDK, the Rust
# toolchain and ORT_LIB_LOCATION all live on the Windows side, so the build has
# to run under Git Bash. Every invocation here died with "No such file or
# directory" before building anything.
#
# WHY the slash conversion: Join-Path yields backslashes, and bash consumes them
# as escapes — `D:\App\...` arrived as `D:AppOpenCode...`. Git Bash resolves a
# drive-letter path with forward slashes.
function Resolve-BashExe {
  if ($IsLinux -or $IsMacOS) { return 'bash' }
  foreach ($candidate in @(
      (Join-Path $env:ProgramFiles 'Git\bin\bash.exe'),
      (Join-Path ${env:ProgramFiles(x86)} 'Git\bin\bash.exe'),
      (Join-Path $env:LOCALAPPDATA 'Programs\Git\bin\bash.exe'))) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  throw 'Git Bash was not found. Install Git for Windows; WSL bash cannot run this build.'
}

function Convert-ToBashPath([string]$Path) { return ($Path -replace '\\', '/') }

$bashExe = Resolve-BashExe
Write-Host "Using bash: $bashExe"

# Before spending 20 minutes building: refuse up front if gen/android would
# produce a debuggable release. That flag has silently returned twice via
# `tauri android init`.
& node (Join-Path $repo 'scripts/check-android-release-flags.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Android release flags check failed' }

Write-Host 'Preparing Android runtime'
& $bashExe (Convert-ToBashPath (Join-Path $mobile 'scripts/prepare-android-runtime.sh'))
if ($LASTEXITCODE -ne 0) { throw 'Android runtime preparation failed' }

Write-Host 'Building unsigned Android release'
Push-Location $mobile
try {
  & $bashExe (Convert-ToBashPath (Join-Path $mobile 'scripts/build-android.sh'))
  if ($LASTEXITCODE -ne 0) { throw 'Tauri Android build failed' }
} finally {
  Pop-Location
}

$unsigned = Get-ChildItem -LiteralPath $apkRoot -Recurse -File -Filter '*unsigned.apk' | Select-Object -First 1
if (-not $unsigned) { throw "No unsigned APK found below $apkRoot" }
$unsignedOut = Join-Path $artifactDir 'unifia-mobile-unsigned.apk'
Copy-Item -LiteralPath $unsigned.FullName -Destination $unsignedOut -Force

& pwsh -NoProfile -File (Join-Path $repo 'scripts/android-runtime-provenance.ps1') -OutputPath 'artifacts/android-release/provenance.json'
if ($LASTEXITCODE -ne 0) { throw 'Provenance generation failed' }

if ($UnsignedOnly) {
  Write-Host "Unsigned APK: $unsignedOut"
  exit 0
}

if ([string]::IsNullOrWhiteSpace($KeystorePath) -or -not (Test-Path -LiteralPath $KeystorePath)) {
  throw 'Release keystore is required. Set UNIFIA_ANDROID_KEYSTORE or use -UnsignedOnly.'
}
if ([string]::IsNullOrWhiteSpace($KeystoreAlias) -or [string]::IsNullOrWhiteSpace($KeystorePassword)) {
  throw 'Release keystore alias and password are required.'
}
$expectedCertificates = @(Get-ExpectedCertificateSha256 $ExpectedCertificateSha256)

$signedOut = Join-Path $artifactDir 'unifia-mobile-release.apk'
Copy-Item -LiteralPath $unsignedOut -Destination $signedOut -Force
$apksigner = Get-Command apksigner -ErrorAction SilentlyContinue
if (-not $apksigner) { throw 'apksigner is required to sign and verify release APKs.' }

& $apksigner.Source sign --ks $KeystorePath --ks-key-alias $KeystoreAlias --ks-pass "pass:$KeystorePassword" --key-pass "pass:$KeyPassword" $signedOut
if ($LASTEXITCODE -ne 0) { throw 'Release APK signing failed' }
& $apksigner.Source verify --verbose $signedOut
if ($LASTEXITCODE -ne 0) { throw 'Release APK signature verification failed' }

$metadata = & $apksigner.Source verify --print-certs $signedOut 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw 'Release APK certificate inspection failed' }
Assert-ApkCertificateAllowed $metadata $expectedCertificates
Get-FileHash -LiteralPath $signedOut -Algorithm SHA256 | ConvertTo-Json | Set-Content (Join-Path $artifactDir 'unifia-mobile-release.apk.sha256.json')
Write-Host "Release APK: $signedOut"
