# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
#
# Original work. No upstream derivation.

function Normalize-CertificateSha256([string]$Value) {
  $trimmed = $Value.Trim()
  if ($trimmed -notmatch '^[0-9A-Fa-f: -]+$') {
    throw 'Certificate SHA-256 fingerprints may only contain hexadecimal digits, spaces, colons, and hyphens.'
  }
  return ($trimmed -replace '[: -]', '').ToUpperInvariant()
}

function Get-ExpectedCertificateSha256([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw 'Expected release certificate SHA-256 is required. Set UNIFIA_ANDROID_CERT_SHA256.'
  }

  $fingerprints = @($Value -split '[,;\r\n]+' | ForEach-Object { Normalize-CertificateSha256 $_ })
  if ($fingerprints.Count -eq 0 -or $fingerprints.Where({ $_ -notmatch '^[0-9A-F]{64}$' }).Count -gt 0) {
    throw 'UNIFIA_ANDROID_CERT_SHA256 must contain one or more valid SHA-256 fingerprints separated by commas or semicolons.'
  }
  return $fingerprints
}

function Get-ApkCertificateSha256([string]$Metadata) {
  return @([regex]::Matches($Metadata, '(?im)certificate SHA-256 digest:\s*([0-9a-f: -]+)\r?$') |
    ForEach-Object { Normalize-CertificateSha256 $_.Groups[1].Value } |
    Where-Object { $_ -match '^[0-9A-F]{64}$' })
}

function Assert-ApkCertificateAllowed([string]$Metadata, [string[]]$ExpectedCertificates) {
  if ($Metadata -match '(?i)CN=Android Debug|androiddebugkey') {
    throw 'Debug-signed APK rejected'
  }

  $actualCertificates = @(Get-ApkCertificateSha256 $Metadata)
  if ($actualCertificates.Count -eq 0) {
    throw 'Release APK certificate SHA-256 was not reported by apksigner.'
  }

  $unexpectedCertificates = @($actualCertificates | Where-Object { $_ -notin $ExpectedCertificates })
  if ($unexpectedCertificates.Count -gt 0) {
    throw "Release APK certificate SHA-256 is not allowlisted: $($unexpectedCertificates -join ', ')"
  }
}
