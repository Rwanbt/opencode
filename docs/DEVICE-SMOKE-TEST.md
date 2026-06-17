# Device smoke test — on-device validation checklist

Some of OpenCode mobile's most critical behaviour **cannot be validated on a host
or in CI**, because it depends on Android-only mechanisms that simply do not exist
on Linux/WSL/x86:

- the zygote **seccomp** filter (SIGSYS on certain syscalls),
- **SELinux** `untrusted_app` / `app_data_file` / `execute_no_trans` denials,
- **`nativeLibraryDir`** exec labelling (JNI `lib*.so` are the only exec-allowed files),
- the **JNI `LlamaService`** owning `llama-server`,
- the kernel **`binfmt_script`** handler under those labels.

The host test suite (`cargo test --lib`, `bun test`) covers all the *file-system
pure* and *logic* parts; this checklist covers the irreducible **device-only**
behaviour. Run it on a **real device** after every APK build that touches the
mobile runtime, the server spawn, the toolchain wrappers, or the symlink setup.

ARM64 emulators on x86 CI are **not** an option (QEMU2 has no arm translation),
so this stays manual / connected-device until a self-hosted device runner or
Firebase Test Lab is wired up.

---

## 0. Build & install

```bash
cd packages/mobile && bun tauri android build --target aarch64   # ORT_LIB_LOCATION=D:/tmp/ort-android
# install the produced APK, then fully clear cache to avoid a stale WebView:
adb shell pm clear ai.opencode.mobile && adb install -r <path-to.apk>
```

Stream logs in another shell: `adb logcat -s OpenCode bun` (only `process.stderr`
reaches logcat — stdout goes to a local file).

---

## 1. Embedded server comes up (D-09 / D-01 — `start_embedded_server`)

After the `start_embedded_server` decomposition (6 helpers), confirm the spawn
chain is unchanged in behaviour.

| Step | Expected | Validates |
|------|----------|-----------|
| Launch the app | Extraction progress → main UI appears, no crash | extraction + spawn orchestration |
| Wait for ready | logcat shows `Server spawned with pid …` then `Server still running after 500ms — good` | spawn + immediate-crash guard |
| `check_local_health` (open a session / send a prompt) | server answers; a local model reply streams | health poll, env file, musl-linker launch |
| Background the app, return | server still serves (no orphan) | single-flight gate (D-18) |

❌ If logcat shows `Server crashed (…)` or `bun not found` / `nativeLibraryDir not
found` → the spawn/env wiring regressed.

## 2. Shell + exec chain (D-16 — shebang + LD_PRELOAD)

Open the **terminal** tab and run, checking each produces correct output (not a
freeze, not `cannot execute`, not `command not found`):

```sh
uname -a            # toybox via /system/bin or nativeLibraryDir
ls -la $HOME        # toybox applet
git --version       # rootfs binary via libmusl_linker (LD_PRELOAD=libmusl_exec.so)
cargo --version     # wrapper chain (binfmt_script → libbash_exec → libmusl_linker)
node --version      # bun/node musl launch
```

| Expected | Validates |
|----------|-----------|
| All print version/listing, prompt returns | `binfmt_script → libbash_exec.so → libmusl_linker.so → ELF` chain |
| `cargo --version` works | toolchain wrappers (`prepare_toolchain_wrappers`) + PATH order |

❌ A `SIGSYS` / `bad system call`, a silent freeze, or `cannot execute: required
file not found` → a link in the exec chain broke (often a dead `nativeLibraryDir`
path after an APK update).

## 3. Busybox/toybox applet seccomp routing (D-19)

The static busybox SIGSYS's on interactive applets under seccomp; the policy
routes those to the seccomp-safe `/system/bin/toybox`. The host guardrail test
(`busybox_fallback_excludes_seccomp_risk_applets`) proves the *policy*; this
proves it *holds at runtime*.

In the terminal, run each and confirm **no `bad system call` / SIGSYS**:

```sh
vi  --version       # interactive editor — must come from system toybox
top -n1             # process viewer
less /etc/hostname  # pager
nano --version      # if bundled
gawk 'BEGIN{print "ok"}'   # busybox fallback (non-interactive) — should print ok
```

| Expected | Validates |
|----------|-----------|
| `vi`/`top`/`less` run (toybox), `gawk` prints `ok` (busybox) | seccomp-safe routing (`SECCOMP_RISK_APPLETS` → toybox, `BUSYBOX_FALLBACK_APPLETS` → busybox) |

❌ Any of `vi`/`top`/`less` crashing with SIGSYS → an interactive applet is being
served from the static busybox (the guardrail should have caught it at compile —
report it).

## 4. Storage / permissions (optional, if testing file access)

| Step | Expected |
|------|----------|
| Grant All-Files-Access when prompted | `onResume` respawns `pty_server`, `$HOME/storage/*` symlinks resolve |
| `ls /sdcard` in terminal | lists external storage |

---

## Recording results

Note device + Android version + pass/fail per section in the PR / session log,
e.g. `Xiaomi 14 Ultra / Android 14 — §1 ✅ §2 ✅ §3 ✅`. A failing section is a
device regression that the host suite cannot see.
