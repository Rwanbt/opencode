#!/usr/bin/env bash
set -euo pipefail

# Fetch busybox-static aarch64 for Android and install it as a jniLib.
# Busybox provides full-featured vi/less/nano/awk/sed applets that toybox
# (Android's bundled multicall binary) ships without. Without this, users
# typing `vim file` hit `toybox: unknown command vi`.
#
# OPT-IN: not called automatically by prepare-android-runtime.sh or
# build-android.sh. Run this script once, then rebuild the APK. The
# compiled binary is cached in jniLibs so subsequent builds pick it up.
#
# Source: Alpine Linux official apk repository (HTTPS, cryptographically
# signed .apk packages). If you mistrust this source, replace the URL
# and SHA256 below — the binary ends up at jniLibs/arm64-v8a/
# libbusybox_exec.so and runtime.rs wires the symlinks automatically.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MOBILE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
JNILIBS="$MOBILE_DIR/src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a"
OUT="$JNILIBS/libbusybox_exec.so"
TEMP_DIR="$(mktemp -d)"
trap "rm -rf $TEMP_DIR" EXIT

# Pin version + checksum. Update these together when bumping Alpine.
BUSYBOX_VERSION="1.37.0-r14"
BUSYBOX_URL="https://dl-cdn.alpinelinux.org/alpine/v3.21/main/aarch64/busybox-static-${BUSYBOX_VERSION}.apk"
# SHA256 of the raw busybox.static binary extracted from the apk.
# Leave empty on first install; re-run script will print the actual hash
# for you to paste below, then pin for all future fetches.
BUSYBOX_SHA256="${BUSYBOX_SHA256_OVERRIDE:-e383c8bc25a1137b8ee88718cc6df1f1e84c54521d6045fc837385995dcdf031}"

mkdir -p "$JNILIBS"

if [ -f "$OUT" ]; then
  echo "busybox already present at $OUT ($(du -h "$OUT" | cut -f1))"
  echo "  remove to re-download."
  exit 0
fi

echo "Downloading busybox-static $BUSYBOX_VERSION from Alpine Linux..."
echo "  $BUSYBOX_URL"
curl -fsSL --max-time 60 "$BUSYBOX_URL" -o "$TEMP_DIR/busybox.apk"

# Alpine apks are gzipped tarballs. The static binary lives at
# usr/sbin/busybox.static in the archive.
cd "$TEMP_DIR"
tar -xzf busybox.apk 2>/dev/null || true
CANDIDATE=""
for path in "bin/busybox.static" "sbin/busybox.static" \
            "usr/bin/busybox.static" "usr/sbin/busybox.static"; do
  if [ -f "$TEMP_DIR/$path" ]; then
    CANDIDATE="$TEMP_DIR/$path"
    break
  fi
done

if [ -z "$CANDIDATE" ]; then
  echo "ERROR: busybox.static not found inside apk. Contents:"
  find "$TEMP_DIR" -maxdepth 3 -type f | head -30
  exit 1
fi

ACTUAL_SHA=$(sha256sum "$CANDIDATE" | awk '{print $1}')
echo "Extracted $CANDIDATE"
echo "  SHA256: $ACTUAL_SHA"

if [ -n "$BUSYBOX_SHA256" ]; then
  if [ "$ACTUAL_SHA" != "$BUSYBOX_SHA256" ]; then
    echo "ERROR: SHA256 mismatch."
    echo "  expected: $BUSYBOX_SHA256"
    echo "  got:      $ACTUAL_SHA"
    exit 1
  fi
  echo "SHA256 verified against pinned hash."
else
  echo "NOTE: no SHA256 pinned yet. To lock this build, set"
  echo "  BUSYBOX_SHA256=\"$ACTUAL_SHA\""
  echo "in this script and commit."
fi

cp "$CANDIDATE" "$OUT"
chmod 755 "$OUT"
echo "Installed: $OUT ($(du -h "$OUT" | cut -f1))"
echo
echo "Next: rebuild the APK. runtime.rs will automatically create symlinks"
echo "for vi/vim/nano/less/awk/sed targeting this binary."
