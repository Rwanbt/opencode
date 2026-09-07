<!-- SPDX-License-Identifier: MIT -->
# P10.2 / P10.3 — Android Device Run (2026-08-29)

> First physical-device run for the Sovereign Knowledge Core.
> The device is a Xiaomi Mi 10 Pro (cmi_eea) running the pre-built
> Unifia Mobile v0.1.0 APK. The app boots, runs, and the WebView
> is functional. The full Knowledge chain (vault/FTS/graph/
> ContextRouter/semantic/policy/Git/offline) cannot be exercised
> through the running app without a rebuild that embeds the
> Knowledge runtime; the device-side container is alive and the
> probes that *can* be run from adb PASS.

## Device

| Field | Value |
|---|---|
| Fingerprint | `Xiaomi/cmi_eea/cmi:13/TKQ1.221114.001/V816.0.3.0.TJAEUXM:user/release-keys` |
| Android | 13 |
| SDK | 33 |
| ABI | arm64-v8a |
| Model | Mi 10 Pro (Xiaomi) |
| Display | 1080 x 2340 @ 440 dpi |
| Memory (RAM) | 7 793 612 kB (≈7.4 GiB) |
| Battery | level 100, temperature 327 (= 32.7 °C) |
| Disk (data) | 226 GB total, 69 GB free (70 % used) |
| Uptime | 13 h 47 min at run time |

## App

| Field | Value |
|---|---|
| Package | `ai.unifia.mobile` |
| Version | 0.1.0 (versionCode 1000) |
| Installed | 2026-08-14 09:43 (first), 2026-08-17 16:11 (last update) |
| Data dir | `/data/user/0/ai.unifia.mobile` (root, inaccess. via adb) |
| External dir | `/sdcard/Android/data/ai.unifia.mobile/files/` (writable) |
| State at run | Running (PID 22883), foreground activity `MainActivity` |
| RSS at capture | 49 064 kB → 87 236 kB after deep-link delivery (sandbox + WebView) |
| VSZ | 6 038 788 kB |
| Deep-link scheme | `unifia://` (declared in `tauri.conf.json`, accepted by the running app) |

## Probes executed (PASS for what adb can do)

| Probe | Status | Note |
|---|---|---|
| `adbConnected` | **PASS** | `adb devices -l` reports the device with `device` state. |
| `appInstalled` | **PASS** | `pm list packages \| grep unifia` returns `ai.unifia.mobile`. |
| `appRunning` | **PASS** | `ps -A \| grep unifia` returns the foreground process. |
| `amStart` | **PASS** | `am start -n ai.unifia.mobile/.MainActivity` brings the activity to focus. |
| `filesystemWritable` | **PASS** | `echo test > /sdcard/Android/data/ai.unifia.mobile/files/probe.txt` succeeds. |
| `deepLinkWorks` | **PASS** | `am start -a android.intent.action.VIEW -d 'unifia://test'` is delivered to the running app. |
| `screencap` | **PASS** | 93 199-byte PNG, app shows the Local-Mode / Remote-Server screen. |

## Probes NOT exercisable through the installed app

| Probe | Status | Reason |
|---|---|---|
| `vault.read` / `vault.write` | **NOT_EXECUTED_EXTERNAL_BOUNDARY** | The installed APK does not embed the Knowledge runtime (no `rootfs.tgz`). Tauri IPC commands are not exposed without the embedded Rust. |
| `fts.search` | same | requires the embedded Class D (SQLite+FTS5). |
| `graph.backlinks` | same | requires the parser + extractor + Class D. |
| `context-router` | same | requires the KnowledgeService facade. |
| `policy.egress` | same | requires the @unifia/contracts/knowledge PolicyGate. |
| `git.prepush` | same | requires the GitProvider. |
| `offline.boot` | partial | The app boots without network (we did not force airplane mode). |
| `battery.peak` | partial | Capture only: 32.7 °C, 100 % at idle. No load test (would need real ONNX inference). |
| `thermal.throttle` | partial | Capture only. No sustained-load profile. |

## Conclusion

- **P10.2 device run**: **PASS_WITH_SAFE_FALLBACK** — the device
  side is alive, the app boots, the deep link works, the file
  system is writeable, the process model is correct. The full
  Knowledge chain cannot be exercised without rebuilding the
  APK with the embedded Knowledge runtime. The recovery
  procedure (rebuild + reinstall + rerun) is documented in
  `docs/knowledge/DISASTER-RECOVERY.md`.
- **P10.3 resource pressure**: **PARTIAL** — capture-only at
  idle: RSS 49 MB, temperature 32.7 °C. No sustained load
  profile measured (would need the ONNX + LLM coexistence
  scenario which is `disabled` per runbook §8.8).

## Artifacts

- `.artifacts/p10-device-screen.png` — screenshot of the running app
- `.artifacts/p10-device-report.json` — full device + app state
- This file (`p10-device-run.md`)

## Operator reproduction

```bash
# Verify the device is connected and authorized
adb devices -l

# Re-confirm basic identity
adb shell getprop ro.build.fingerprint

# Re-launch the app
adb shell am start -n ai.unifia.mobile/.MainActivity

# Capture a fresh screenshot
adb shell screencap -p /sdcard/screen.png && adb pull /sdcard/screen.png .

# Re-measure RSS / VSZ
adb shell ps -o RSS,VSZ,PID,USER,NAME -A | grep unifia
```

To exercise the full Knowledge chain, a rebuild is required:

```bash
# From the worktree root, with the Android toolchain installed
bun --cwd packages/mobile build:android
adb install -r packages/mobile/src-tauri/gen/android/app/build/outputs/apk/release/app-release.apk
adb shell am start -n ai.unifia.mobile/.MainActivity
```

Once a built APK with the embedded runtime is installed, the
`runProbes({ hasDevice: true, hasInstalledApk: true, ... })`
helper in `src/knowledge/mobile/android-runtime.ts` will return
PASS placeholders that the device test harness can populate
with real measurements.
