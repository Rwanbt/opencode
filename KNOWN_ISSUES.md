# KNOWN ISSUES — OpenCode Fork

> Consolidation of known bugs, in-flight fixes, and documented limitations.
> Updated: 2026-04-17 (post A.* + B.* + features/security session).

See [AUDIT_REPORT.md](AUDIT_REPORT.md), [PERFORMANCE_REPORT.md](PERFORMANCE_REPORT.md),
[ANDROID_AUDIT.md](ANDROID_AUDIT.md), [SECURITY_AUDIT.md](SECURITY_AUDIT.md)
for per-finding detail.

---

## Open security items

Tracked in [SECURITY_AUDIT.md](SECURITY_AUDIT.md). Highlights that remain
before a production release:

| ID | Summary | File |
|---|---|---|
| S2.A1 | CORS regex accepts arbitrary `*.opencode.ai` subdomains | [packages/opencode/src/server/server.ts:64-88](packages/opencode/src/server/server.ts#L64) |
| S2.A2 | Deep-link `providerID` not constrained to a known-provider allowlist | [packages/app/src/pages/layout/deep-links.ts](packages/app/src/pages/layout/deep-links.ts) |
| S1.S1 | WebSocket auth passed as `?authorization=` query param (browsers strip the header) | [packages/opencode/src/server/auth-jwt.ts:110-145](packages/opencode/src/server/auth-jwt.ts) |
| S1.S2 | `auth.json` stored plaintext (mode 0o600). Move to OS keychain | [packages/opencode/src/auth/index.ts](packages/opencode/src/auth/index.ts) |
| S2.S1 | Shell env (incl. `*_API_KEY`) inherited by CLI sidecar | [packages/desktop/src-tauri/src/cli.rs:371-480](packages/desktop/src-tauri/src/cli.rs) |
| S2.S2 | Android `network_security_config.xml` allows cleartext globally | [packages/mobile/src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml](packages/mobile/src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml) |
| S1.V2 | `fetch()` with no timeout on Ollama probe and OAuth token POST | [packages/opencode/src/mcp/oauth-callback.ts](packages/opencode/src/mcp/oauth-callback.ts) |

---

## Deferred mobile work (QA on physical device required)

These changes are planned as a follow-up to the current work on the
Android terminal and speech stack:

| Item | File |
|---|---|
| Vim / alt-screen support (`ESC[?1049h`) on the WebView renderer | [packages/app/src/components/terminal.tsx](packages/app/src/components/terminal.tsx) |
| Mouse tracking (`ESC[?1000h`, `?1002h`) for htop / tmux scroll | same |
| Virtual keybinding row (Escape, arrows, Ctrl, Tab) on the Android prompt | [packages/mobile/src/mobile.css](packages/mobile/src/mobile.css) |
| Thermal listener JNI that calls `resetProfileCache()` when the SoC throttles | [packages/opencode/src/local-llm-server/auto-config.ts](packages/opencode/src/local-llm-server/auto-config.ts) |
| Neural voice clone engine (F5-TTS / XTTSv2 ONNX) so the VoiceClone section can be re-enabled on mobile | [packages/mobile/src-tauri/src/speech.rs](packages/mobile/src-tauri/src/speech.rs) |

---

## Fixed in the current tree (kept for reference)

### A.* first audit pass (token + reasoning + CSP + Android)
- **A.1 tokenizer `length/4`** → replaced by `js-tiktoken` for OpenAI families,
  heuristic `length/3.5` otherwise. [src/util/token.ts](packages/opencode/src/util/token.ts).
- **A.2 reasoning budget capped at 1024** → `getThinkingCap()` returns 8192 for
  Qwen/DeepSeek thinking, 2048 default, 0.15 fraction of the model output max.
- **A.4 Android lifecycle** → `visibilitychange` hook + `llm_idle_tick`
  Tauri command; foreground service (`LlamaService.kt`) keeps
  llama-server alive under API 34+.
- **A.10 mobile CSP `null`** → strict CSP on mobile + desktop; no
  `unsafe-eval`; `object-src 'none'`; `frame-ancestors 'none'`.
- **A.11 Tauri command validation** → filename charset + HTTPS allowlist on
  `download_model` / `load_llm_model` / `delete_model`.

### B.* second audit pass (leaks / races / observability)
- **B.1 ragIndexedDirs Set leak** → replaced by bounded LRU (64 entries, 30 min TTL).
- **B.3 structuredClone in compaction** → gated on `plugin.has("experimental.chat.messages.transform")`.
- **B.A4 `eprintln!` in release** → `log` + `android_logger` installed, 28 sites migrated.
- **B.A5 `Mutex.lock().unwrap()`** → `lock_safe` helper recovers poisoned locks.
- **B.A6 `static mut PROXY_PORT`** → `AtomicU16` + `compare_exchange`.
- **B.A1/A2 Android manifest hardening** → `isDebuggable=false`, `allowBackup=false`, `windowSoftInputMode=adjustResize`.
- **B.5 cost underflow** → `Math.max(0, inputTokens - cacheSum)` + warn log.
- **B.9 `Effect.ignore` swallowing SessionLearn errors** → `Effect.catch` + `log.warn`.
- **Desktop CSP alignment** → strict CSP mirrored from mobile (A.10).

### Features + security session (2026-04-17, commits `6ba7fdaee` → `00b3b52f5`)
- **Mobile STT listener wired** — `packages/mobile/src/hooks/use-speech.ts`
  attaches `stt-start`/`stt-stop`; `RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS`
  declared in the manifest so the auto-generated `RustWebChromeClient` can
  forward the AUDIO_CAPTURE runtime permission to the user.
- **Mobile TTS (Kokoro) wired** — six Tauri commands exposed from `speech.rs`,
  `tts_speak` delegates to Kokoro, dead-code allow removed on `mod kokoro`.
- **Git upstream watcher** — `Vcs.Event.BranchBehind` published every 5 min
  (warm-up 30 s) when the tracked upstream diverges; UI forwards to
  `platform.notify()` on desktop + mobile.
- **OAuth deep-link callback** — `opencode://oauth/callback?providerID=…&code=…`
  auto-finalises the token exchange; `dialog-connect-provider.tsx` listens on
  the `oauthCallbackEvent` window event.
- **Terminal first-prompt visible on mobile** — `Pty.CreateInput` accepts
  `cols`/`rows`; the frontend estimates the viewport before `pty.create()`
  so the shell starts at its final dimensions and mksh/bash don't drop the
  prompt on post-spawn SIGWINCH.
- **Voice Clone A3 UX** — mobile forced to Kokoro (no Python sidecar), the
  VoiceClone recording section is hidden on mobile (Kokoro has no speaker
  encoder).
- **Desktop `devtools: true` removed** — Tauri 2 default (debug-only) restored
  so production builds no longer expose `__TAURI__` inspection to an XSS foothold.
- **Clippy panic fix** — `done_rx.map(async move |_| …)` replaced by a plain
  `async move { done_rx.await; … }` in [packages/desktop/src-tauri/src/lib.rs](packages/desktop/src-tauri/src/lib.rs);
  clippy 0.1.90 no longer panics on `type_op_prove_predicate`.

---

## Historical context (fully closed)

### Terminal prompt invisible (legacy)
Previously mitigated by a rollback (commit `d4e43c4e0`); now properly fixed
by the viewport-sized spawn change described above.

### Zombie llama-server at shutdown
Mitigated by `syncCleanup()` on `SIGTERM`/`SIGINT`
([local-llm-server/index.ts:262-281](packages/opencode/src/local-llm-server/index.ts#L262-L281))
and orphan recovery at next start via the `owner.pid` file.

### Gemma thinking loop
Fixed by `shouldSuppressThinking()` in `ProviderTransform` (the suppression
is scoped to Qwen-family regex, so Gemma's `enable_thinking: true` is
preserved).

---

## Non-bug limitations

| Limitation | Workaround |
|---|---|
| No automatic GPU/VRAM detection on older SOC | Manual override via env vars (`OPENCODE_N_GPU_LAYERS`, `OPENCODE_KV_CACHE_TYPE`) |
| ORT Android binaries must be extracted locally | Set `ORT_LIB_LOCATION=D:/tmp/ort-android` before `tauri android build` |
| Xiaomi MIUI blocks `adb shell input` by default | Enable "USB debugging (Security settings)" in developer options |
| One llama-server (port 14097) per process tree | Verified by atomic owner.pid, new CLI connects to the existing server instead of spawning a duplicate |
| Cold start mobile ~3-5 s | Code-splitting done for heavy dialogs; further lazy loading of provider SDKs tracked in `PERFORMANCE_REPORT.md` §4 |

---

## Contribution workflow for new issues

1. Every new bug goes through a GitHub Issue with the `audit-2026-Q2` label.
2. Fix PRs reference the SECURITY_AUDIT.md ID (e.g. `S1.V2`) and include a
   non-regression test when the code path is testable without a device.
3. Once merged, move the entry to `CHANGELOG.md` with the commit hash.

---

**Contact**: [@barat.erwan](mailto:barat.erwan@gmail.com)
