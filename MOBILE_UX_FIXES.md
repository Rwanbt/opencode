# Mobile UX Fixes — Xiaomi Mi 10 Pro (sm8250) QA

Branch: `dev` — **no commit**.
Scope: 5 items from user QA on real device.

---

## Item 4 — Terminal portrait first-prompt invisible  *(HIGH)*

**Status**: DONE.

**Root cause hypothesis**: at mount time on Android portrait, the container's
`getBoundingClientRect()` returns dimensions that are still settling (soft
keyboard animation, safe-area inset, address-bar collapse). Initial `fit()`
picks too-small cols/rows → cursor lands outside visible area → first prompt
already received from PTY looks invisible. A key press triggers SIGWINCH →
terminal repaints correctly.

**Fix** (`packages/app/src/components/terminal.tsx`, `startResize()`):
1. `ResizeObserver` attached to the outer container — catches every dimension
   change including viewport settle and keyboard toggle. `fit.observeResize()`
   watches the xterm inner element only.
2. Three delayed refits at 50ms / 200ms / 500ms after mount (idempotent) +
   optional-chained `t.refresh(0, rows-1)` to force a full repaint.
3. `orientationchange` listener → refit 200ms later (viewport dims aren't
   final when the event fires on Android).

**Manual test**:
- Open session in portrait → first prompt should now appear within ~500ms
  without needing a key press.
- Rotate landscape → portrait → prompt should reflow, no dead zone.
- Open soft keyboard, close it → prompt lines should reflow.

**Risks**: very low. Three extra `setTimeout` fits + one ResizeObserver per
terminal instance. All fit() calls are guarded by `disposed` + try/catch.

---

## Item 5 — Vim / nano / less inaccessible in embedded terminal  *(HIGH)*

**Status**: DONE (shell aliases route to toybox `vi` / `more`).

**Root cause**: `libtoybox_exec.so` is already in jniLibs with symlinks for
~80 applets. Toybox provides `vi` and `more` (no vim/nano/less). Users typing
`vim` hit `command not found` because toybox dispatches by argv[0] — adding a
`vim` symlink would make toybox respond "Unknown command: vim".

**Fix** (`packages/mobile/src-tauri/src/runtime.rs`, `.mkshrc` content):
Added shell aliases:
```
alias vim='vi'
alias nano='vi'
alias less='more'
```
Alternative considered: embedded a static busybox aarch64-musl binary
(~1 MB). **Skipped** — toybox already covers the applet list; adding busybox
would be redundant and require wiring into jniLibs + build.rs. If a user
really wants busybox's `nano`/`less` implementations, follow-up work would
embed `libbusybox_exec.so` alongside toybox.

**Manual test**: in terminal run `vim somefile.txt` → toybox vi opens.
`less /etc/hosts` → toybox more displays the file.

**Risks**: none. Aliases only affect interactive mksh shell; scripts that
`exec vim` will still fail, but that's expected (no real vim).

---

## Item 3 — Kokoro TTS auto-download on first use  *(HIGH)*

**Status**: DONE.

**Diagnostic** (`packages/mobile/src-tauri/src/kokoro/` + `speech.rs`):
- The 310 MB model (`kokoro-v1.0.onnx`) + 26 MB voices (`voices-v1.0.bin`)
  are **NOT** in `assets/runtime/` — they would balloon the APK.
- A `kokoro_download_model` Tauri command exists and fetches them from
  GitHub release (`thewh1teagle/kokoro-onnx model-files-v1.0`) into
  `app_data_dir/speech/kokoro/`.
- But `tts_speak` (and `tts_start`) only called `kokoro_load`, which errors
  out with `"Kokoro model not downloaded"` if the files aren't on disk. The
  user had to manually trigger the download via a settings UI that isn't
  obvious — hence "not working out of the box".

**Fix** (`speech.rs`):
- `tts_start`: if `!kokoro_available()`, call `kokoro_download_model()` first
  (emits `kokoro-download-progress` events), then `kokoro_load`.
- `tts_speak`: same gate at the top — ensures the first call to speak
  triggers the download flow transparently.

**Manual test**: fresh install, enable TTS in settings → first `tts_speak`
downloads ~336 MB (one-time), then synthesises audio. Subsequent calls run
instantly.

**Risks**: medium. First call now blocks for the download duration (2–5 min
on mobile data). The `kokoro-download-progress` event is already wired; the
frontend should surface a progress indicator. If the frontend doesn't, the
UX is "TTS seems frozen for 3 min then works" — acceptable one-time cost but
worth a UI follow-up.

---

## Item 2 — Parakeet STT very slow  *(LOW — investigation)*

**Status**: DONE (partial — ORT thread config).

**Diagnostic** (`packages/mobile/src-tauri/src/parakeet/engine.rs`):
- ORT `SessionBuilder` had no `with_intra_threads` call → ORT defaults to
  `num_logical_cpus` = 8 on sm8250 (1 prime + 3 big + 4 little). Scheduling
  inference on 4 efficiency cores trashes latency.
- No NNAPI execution provider is wired; only `CPUExecutionProvider` is
  registered → NNAPI-related slowdowns ruled out.
- Model is already INT8 (`encoder-model.int8.onnx`,
  `decoder_joint-model.int8.onnx`) — no further quant gain available here.

**Fix**: added `with_intra_threads(detect_big_cores())` to
`Parakeet::make_session()`. `detect_big_cores()` reads
`/sys/devices/system/cpu/*/cpufreq/cpuinfo_max_freq` and keeps cores within
80 % of the top freq (clamped 2–4). On sm8250 this yields 4 (1 prime + 3
big), matching the A77 perf cluster.

**Manual test**: record a 10 s utterance on device. Before: ~8 s transcribe.
After: expected ~3–4 s (rough — needs on-device measurement).

**Risks**: low. If cpufreq is unreadable (rare perm issue), falls back to
`available_parallelism().min(4)`.

---

## Item 1 — LLM inference slow  *(LOW — investigation)*

**Status**: PARTIAL / SKIP.

**Diagnostic** (`packages/opencode/src/local-llm-server/auto-config.ts`):
- `deriveConfig` already sets `nThreads = clamp(2, 6, cpuCores.big)` — big
  cores only, no tweak needed.
- sm8250 has no Vulkan/OpenCL driver exposed to userland (Android 11 base)
  → `gpuBackend === "none"` → `deriveConfig` throws unless
  `OPENCODE_ALLOW_CPU_ONLY=1` is set. This is the correct behaviour (CPU-only
  LLM on a 6 GB phone would be 1–2 tok/s — unusable). README already
  documents the opt-in.
- **Eco preset**: no explicit "Eco" button in
  `packages/app/src/components/dialog-local-llm.tsx`. The "recommended"
  badge on `gemma-4-e4b` (5 GB Q4_K_M) is the closest surrogate. **Not
  modified** — introducing a new preset would require UI + model catalog
  changes beyond the "perf investigation" scope. Noted for follow-up.

**Also applied** to Kokoro TTS engine (same 80% big-core heuristic) —
expected 1.5–2× speedup on the ~300 ms-per-sentence synthesis.

**Risks**: none for Kokoro thread tweak.

---

## Files modified (no commit)

- `packages/mobile/src-tauri/src/parakeet/engine.rs` — `with_intra_threads` +
  `detect_big_cores()`.
- `packages/mobile/src-tauri/src/kokoro/engine.rs` — idem.
- `packages/mobile/src-tauri/src/speech.rs` — `tts_start` / `tts_speak`
  auto-download Kokoro model on first call.
- `packages/mobile/src-tauri/src/runtime.rs` — `.mkshrc` gains
  `vim`/`nano`/`less` aliases.
- `packages/app/src/components/terminal.tsx` — ResizeObserver + delayed
  refits + orientationchange handler in `startResize()`.
- `packages/desktop/src-tauri/src/lib.rs` — fixed pre-existing
  `export_types` cfg mismatch (cfg(test) → cfg(any(debug_assertions,
  test))) to unblock `cargo check`.

## Build validation

- `cargo check` mobile → green.
- `cargo check` desktop → green (was red pre-existing, now fixed).
- `bun run typecheck` in `packages/app` → green.

## Not breaking existing v0.1.0 APK

- No schema change to `assets/runtime/` structure.
- No new required asset (Kokoro files are still downloaded at runtime, just
  auto-triggered now).
- `.mkshrc` is rewritten on every server start → aliases apply on next launch
  without migration.
