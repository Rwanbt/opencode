#!/usr/bin/env bash
# Automated on-device smoke test (see docs/DEVICE-SMOKE-TEST.md).
#
# Runs the device-only validations that no host/CI can reach (server spawn,
# shell/exec chain, busybox/toybox seccomp routing) over adb. Exec checks use
# `run-as` so commands run in the app's uid + SELinux domain (untrusted_app),
# the faithful context for the libmusl_linker / shebang chain.
#
# Prereqs: a connected, authorized device (`adb devices` shows it) with the app
# installed and launched at least once (so the runtime is extracted).
#
# Usage:  bash scripts/device-smoke-test.sh
set -u

PKG="ai.opencode.mobile"
PORT=14096
PASS=0; FAIL=0; SKIP=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
ko()   { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
skip() { echo "  ⏭️  $1"; SKIP=$((SKIP+1)); }
hdr()  { echo; echo "=== $1 ==="; }

export MSYS_NO_PATHCONV=1

# --- preconditions -----------------------------------------------------------
hdr "Device"
STATE="$(adb get-state 2>/dev/null || true)"
if [ "$STATE" != "device" ]; then
  echo "  ❌ no authorized device (adb get-state: '${STATE:-none}'). Connect + authorize first."
  exit 2
fi
adb shell getprop ro.product.model 2>/dev/null | sed 's/^/  model: /'
adb shell getprop ro.build.version.release 2>/dev/null | sed 's/^/  android: /'

if ! adb shell pm list packages 2>/dev/null | grep -q "$PKG"; then
  echo "  ❌ $PKG not installed. Build+install: cd packages/mobile && bun tauri android build --target aarch64"
  exit 2
fi
ok "$PKG installed"

# run-as sanity: §2/§3 need a debuggable build; §1 (logcat + health) does not.
DEBUGGABLE=1
if ! adb shell run-as "$PKG" id >/dev/null 2>&1; then
  DEBUGGABLE=0
  echo "  ⚠️  run-as unavailable — APK not debuggable; §2/§3 skipped (§1 still runs)."
fi
# run-as runs with cwd = the app home (/data/data/$PKG); use RELATIVE paths —
# absolute /data/user/0/... can hit SELinux category isolation under run-as.
RA() { adb shell run-as "$PKG" sh -c "$1" 2>&1; }
RT="runtime"                          # <app-home>/runtime (NOT files/runtime)
WRAP="$RT/home/.cache/wrappers"       # cargo/rustc/node/… entry-point wrappers
BIN="$RT/bin"                         # busybox/toybox terminal applets

# --- §1 server spawn ---------------------------------------------------------
hdr "§1 Embedded server (D-09/D-01)"
# Force-stop first so the launch actually respawns the server (an already-running
# app would emit no fresh 'Server spawned' marker).
adb shell am force-stop "$PKG" 2>/dev/null
sleep 2
adb logcat -c 2>/dev/null
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
echo "  launched; waiting up to 60s for server..."
SRV=""
for _ in $(seq 1 30); do
  sleep 2
  if adb logcat -d -s OpenCode 2>/dev/null | grep -qiE "Server spawned|still running after"; then SRV=1; break; fi
done
if [ -n "$SRV" ]; then ok "server spawn logged"; else ko "no 'Server spawned' in logcat within 60s"; fi

# The bun sidecar needs ~10-30s after spawn to reify node_modules and serve,
# longer on a cold first launch — poll patiently rather than one-shot.
adb forward "tcp:$PORT" "tcp:$PORT" >/dev/null 2>&1
H=000
for _ in $(seq 1 30); do
  # curl -w always prints a status (000 on connection failure); no `|| echo`
  # (which would concatenate "200"+"000" when curl prints 200 but exits non-zero).
  H="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$PORT/global/health" 2>/dev/null)"
  H="${H:-000}"
  { [ "$H" = "200" ] || [ "$H" = "401" ]; } && break
  sleep 3
done
adb forward --remove "tcp:$PORT" >/dev/null 2>&1
if [ "$H" = "200" ] || [ "$H" = "401" ]; then ok "health endpoint answered (HTTP $H)"; else ko "health endpoint HTTP $H"; fi

# --- §2 shell / exec chain (D-16) -------------------------------------------
hdr "§2 Shell + exec chain (D-16)"
if [ "$DEBUGGABLE" = 1 ]; then
  for probe in "uname -a" "ls $RT" "$WRAP/cargo --version" "$WRAP/rustc --version" "$WRAP/node --version"; do
    out="$(RA "$probe")"
    rc=$?
    if echo "$out" | grep -qiE "bad system call|cannot execute|not found|No such|Permission denied" || [ $rc -ne 0 ]; then
      ko "$probe → ${out%%$'\n'*}"
    else
      ok "$probe → ${out%%$'\n'*}"
    fi
  done
else
  skip "§2 needs a debuggable build (run-as)"
fi

# --- §3 applet seccomp routing (D-19) ---------------------------------------
hdr "§3 Applet seccomp routing (D-19)"
if [ "$DEBUGGABLE" = 1 ]; then
  for ap in "top -n1 -b" "busybox" "toybox --version"; do
    out="$(RA "$BIN/${ap}")"
    if echo "$out" | grep -qiE "bad system call|SIGSYS"; then
      ko "$ap → SIGSYS (interactive applet served from static busybox!)"
    elif echo "$out" | grep -qiE "not found|No such"; then
      skip "$ap → not present"
    else
      ok "$ap → ${out%%$'\n'*} (no SIGSYS)"
    fi
  done
else
  skip "§3 needs a debuggable build (run-as)"
fi

# --- summary -----------------------------------------------------------------
hdr "Summary"
echo "  PASS=$PASS  FAIL=$FAIL  SKIP=$SKIP"
[ "$FAIL" -eq 0 ] && echo "  ✅ device smoke test green" || echo "  ❌ device regressions found"
exit "$([ "$FAIL" -eq 0 ] && echo 0 || echo 1)"
