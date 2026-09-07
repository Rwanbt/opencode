#!/usr/bin/env bash
#
# scripts/bootstrap-go.sh — repo-local Go toolchain bootstrap.
#
# Per pack gelé review 2026-09-03 v1.1, the M0 qualification of
# DBOS Go v1.0.0 requires Go 1.25.x. The harness host may not have
# `go` installed. This script:
#
#   1. Downloads the official Go 1.25.12 archive for windows/amd64
#      (DBOS Go v1.0.0 minimum).
#   2. Verifies the SHA-256 against the official SHASUMS256.txt.
#   3. Extracts to .tools/go/ (gitignored).
#   4. Emits the absolute path of `go.exe` so callers don't depend
#      on PATH.
#
# Usage:
#   bash scripts/bootstrap-go.sh
#
# Idempotent: re-running is a no-op if .tools/go/ already exists.
#
# No admin rights required. No global PATH mutation. No commit of
# the SDK itself (only this script is committed).

set -euo pipefail

GO_VERSION="${GO_VERSION:-go1.25.12}"
GO_OS="${GO_OS:-windows}"
GO_ARCH="${GO_ARCH:-amd64}"
TARBALL="${GO_VERSION}.${GO_OS}-${GO_ARCH}.zip"
DOWNLOAD_BASE="https://go.dev/dl"
DEST_DIR="$(cd "$(dirname "$0")/.." && pwd)/.tools/go"
TOOLCHAIN_DIR="${DEST_DIR}/${GO_VERSION}"

if [ -x "${TOOLCHAIN_DIR}/bin/go.exe" ]; then
  echo "go already bootstrapped at ${TOOLCHAIN_DIR}/bin/go.exe"
  echo "${TOOLCHAIN_DIR}/bin/go.exe"
  exit 0
fi

mkdir -p "${DEST_DIR}/.downloads"
cd "${DEST_DIR}/.downloads"

echo "Downloading ${TARBALL} from ${DOWNLOAD_BASE} ..."
curl -fsSL -o "${TARBALL}" "${DOWNLOAD_BASE}/${TARBALL}"

echo "Downloading SHASUMS256.txt ..."
curl -fsSL -o SHASUMS256.txt "${DOWNLOAD_BASE}/SHASUMS256.txt"

echo "Verifying SHA-256 ..."
EXPECTED=$(grep -E "^[0-9a-f]{64}  ${TARBALL}$" SHASUMS256.txt | awk '{print $1}')
if [ -z "${EXPECTED}" ]; then
  echo "ERROR: ${TARBALL} not found in SHASUMS256.txt" >&2
  exit 1
fi
ACTUAL=$(sha256sum "${TARBALL}" | awk '{print $1}')
if [ "${ACTUAL}" != "${EXPECTED}" ]; then
  echo "ERROR: SHA-256 mismatch for ${TARBALL}" >&2
  echo "  expected: ${EXPECTED}" >&2
  echo "  actual:   ${ACTUAL}" >&2
  exit 1
fi
echo "SHA-256 OK: ${ACTUAL}"

echo "Extracting to ${TOOLCHAIN_DIR} ..."
mkdir -p "${TOOLCHAIN_DIR}"
unzip -q -o "${TARBALL}" -d "${DEST_DIR}"
mv "${DEST_DIR}/go" "${TOOLCHAIN_DIR}"

echo "Cleaning up download ..."
rm -f "${TARBALL}" SHASUMS256.txt

echo "go bootstrapped at ${TOOLCHAIN_DIR}/bin/go.exe"
"${TOOLCHAIN_DIR}/bin/go.exe" version
echo "${TOOLCHAIN_DIR}/bin/go.exe"
