# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
#
# Original work. No upstream derivation.

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../lib/android-signing.ps1')

function Assert-Throws([scriptblock]$Action, [string]$ExpectedMessage) {
  try {
    & $Action
  } catch {
    if ($_.Exception.Message -notlike "*$ExpectedMessage*") {
      throw "Expected error containing '$ExpectedMessage', got '$($_.Exception.Message)'."
    }
    return
  }
  throw "Expected error containing '$ExpectedMessage', but no error was raised."
}

$certificateA = 'AA' * 32
$certificateB = 'BB' * 32
$colonSeparatedA = (($certificateA -split '(?<=\G..)(?!$)') -join ':')

$allowlist = @(Get-ExpectedCertificateSha256 "$colonSeparatedA;$certificateB")
if ($allowlist.Count -ne 2 -or $allowlist[0] -ne $certificateA -or $allowlist[1] -ne $certificateB) {
  throw 'Expected certificate allowlist normalization failed.'
}

Assert-Throws { Get-ExpectedCertificateSha256 '' } 'is required'
Assert-Throws { Get-ExpectedCertificateSha256 ($certificateA + 'g') } 'may only contain'
Assert-Throws { Get-ExpectedCertificateSha256 'ABCD' } 'valid SHA-256'

$releaseMetadata = "Signer #1 certificate SHA-256 digest: $certificateA`r`nSigner #1 certificate DN: CN=Unifia Release`r`n"
Assert-ApkCertificateAllowed $releaseMetadata @($certificateA)

$multiSignerMetadata = $releaseMetadata + "Signer #2 certificate SHA-256 digest: $certificateB`r`n"
Assert-ApkCertificateAllowed $multiSignerMetadata @($certificateA, $certificateB)
Assert-Throws { Assert-ApkCertificateAllowed $multiSignerMetadata @($certificateA) } 'is not allowlisted'
Assert-Throws { Assert-ApkCertificateAllowed 'Signer #1 certificate DN: CN=Android Debug' @($certificateA) } 'Debug-signed APK rejected'
Assert-Throws { Assert-ApkCertificateAllowed 'Signer #1 certificate DN: CN=Unifia Release' @($certificateA) } 'was not reported'

Write-Host 'Android signing certificate tests passed.'
