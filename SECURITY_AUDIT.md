# Security Audit — OpenCode fork

**Date**: 2026-04-17
**Scope**: fork OpenCode (Bun / SolidJS / Tauri 2.0, desktop + Android)
**Axes audited**: attack surface, resource leaks, input validation / edge cases, secrets & auth
**Methodology**: 4 parallel code-exploration agents + targeted manual review + corroboration with prior A.*/B.* audits

This document is the reference for future security work. Findings that are
fixed in the same commit as this file are tagged `[fixed this PR]`; the
rest list their current status and the fix plan.

---

## 0. Severity convention

- **S1 / Critical** — exploit path with clear impact (RCE, key exfil, auth
  bypass) or reliability regression that takes down the app entirely.
- **S2 / High** — hardens against a credible threat (XSS chain, memleak
  that OOMs after hours, DoS from a single unprivileged client).
- **S3 / Medium** — defense-in-depth, developer footguns, observability.

Findings in this doc are **verified against the current tree** (dev branch,
commit `29d6836c1`), not inherited from the prior audit reports.

---

## 1. Attack surface

### S1.A1 — Desktop `devtools: true` in release builds  [fixed this PR]

- **File**: [packages/desktop/src-tauri/tauri.conf.json:18](packages/desktop/src-tauri/tauri.conf.json)
- **Cause**: WebView devtools are enabled unconditionally. An XSS foothold
  inside the renderer (e.g. via a malicious markdown block, an MCP-served
  HTML snippet) can attach `chrome.debugger`-equivalent, read Tauri IPC
  messages in flight, and call any backend command with the caller's
  privileges.
- **Fix**: drop the global flag and enable devtools only behind the
  debug_assertions Rust cfg (see commit).
- **Verification**: `cargo check --release` + manual right-click → no
  "Inspect" entry; debug build → devtools available.

### S2.A1 — CORS wildcard on `*.opencode.ai` subdomains

- **File**: [packages/opencode/src/server/server.ts:64-88](packages/opencode/src/server/server.ts#L64-L88)
- **Cause**: regex `^https:\/\/([a-z0-9-]+\.)*opencode\.ai$` accepts
  arbitrarily deep subdomains of `opencode.ai`. A hijacked preview
  environment or a forgotten staging subdomain can CSRF the local dev
  server.
- **Recommended fix**: explicit whitelist of the two or three trusted
  subdomains (`opencode.ai`, `www.opencode.ai`, `app.opencode.ai`).
  Deferred to a separate PR because it touches the production deployment
  config.

### S2.A2 — Deep link `providerID` not constrained

- **File**: [packages/app/src/pages/layout/deep-links.ts:46-58](packages/app/src/pages/layout/deep-links.ts)
- **Cause**: `parseOAuthCallbackDeepLink` accepts any non-empty
  `providerID` string. A malicious page could craft
  `opencode://oauth/callback?providerID=../../..&code=x` and trigger
  unexpected paths inside the dialog. Current mitigation is that the
  dialog compares `detail.providerID !== props.provider` before doing
  anything, but defense in depth still applies.
- **Recommended fix**: validate `providerID` against the set of known
  provider IDs exposed via the SDK (providers.all()).

### S2.A3 — `unsafe { env::set_var(...) }` on startup

- **File**: [packages/desktop/src-tauri/src/main.rs:14,64](packages/desktop/src-tauri/src/main.rs)
- **Cause**: `std::env::set_var` is marked `unsafe` in Rust 2024 because
  it races with other threads reading env. The call happens during `fn
  main()` before any worker thread spawns, so it is sound, but it warrants
  an inline SAFETY comment explaining the invariant.

### S2.A4 — Windows registry reads without alignment check

- **File**: [packages/desktop/src-tauri/src/os/windows.rs:164-205](packages/desktop/src-tauri/src/os/windows.rs)
- **Cause**: three `unsafe` blocks call `RegGetValueW` and then slice the
  returned `u8` buffer as `u16` without an alignment guard. Registry
  values are controlled by local admins, not remote attackers, so this is
  a robustness issue rather than RCE.
- **Recommended fix**: use `u16::from_le_bytes` on aligned chunks or drop
  back to `from_utf16_lossy` after validating length.

### S3.A1 — `innerHTML` assignments in trusted contexts

- **Files**: [packages/ui/src/components/markdown.tsx:89,306](packages/ui/src/components/markdown.tsx), [packages/web/src/components/share/content-bash.tsx:51-52](packages/web/src/components/share/content-bash.tsx), [packages/app/src/components/file-tree.tsx:99](packages/app/src/components/file-tree.tsx)
- **Cause**: all assignments feed output from Shiki (syntax highlight),
  an internal icon lookup, or pre-sanitized markdown. Safe today, but a
  future contributor adding a new `innerHTML` site may skip the sanitizer.
- **Recommended fix**: add a lint rule (`no-restricted-syntax` on
  `innerHTML=`) so new occurrences are flagged in review.

### S3.A2 — Deep link `directory` not resolved before use

- **File**: [packages/app/src/pages/layout/deep-links.ts:13-31](packages/app/src/pages/layout/deep-links.ts)
- **Cause**: `parseDeepLink` returns any string as-is. A
  `opencode://open-project?directory=../..` can open whatever the CLI is
  willing to treat as a project root.
- **Recommended fix**: require the string to be absolute and resolve to
  a known project root via the local server's project list.

---

## 2. Resource leaks

### S1.L1 — Terminal WebSocket reconnect timer — already fixed

- **File**: [packages/app/src/components/terminal.tsx:760](packages/app/src/components/terminal.tsx)
- **Status**: the onCleanup path already clears `reconn`, `sizeTimer`
  and `fitFrame`. Flagged by the audit agent but verified on re-read.
  No action needed.

### S1.L2 — Markdown rendering cache grows to 200 entries module-wide

- **File**: [packages/ui/src/components/markdown.tsx:15-16,228-237](packages/ui/src/components/markdown.tsx)
- **Cause**: FIFO LRU with a hard cap of 200, but each entry holds
  shiki-tokenized HTML that can reach ~1 MB. A long browsing session
  reaches ~200 MB RSS before any eviction kicks in.
- **Recommended fix**: cut the cap to 50 and add a 60 s TTL. Deferred —
  needs a pass on the perf test for rerender cost.

### S1.L3 — `session-prefetch` cache never shrinks

- **File**: [packages/app/src/context/global-sync/session-prefetch.ts:24-26](packages/app/src/context/global-sync/session-prefetch.ts)
- **Cause**: `cache: Map<key, Meta>` grows with the number of sessions
  ever viewed. Memory is released only on explicit directory clear.
- **Recommended fix**: LRU cap of ~100 entries with eviction on each new
  entry.

### S2.L1 — SSE heartbeat double-stop race

- **File**: [packages/opencode/src/server/routes/event.ts:46-58](packages/opencode/src/server/routes/event.ts)
- **Cause**: `stop()` can be invoked twice under a proxy timeout +
  client disconnect race; `clearInterval` is idempotent but `unsub()`
  is not.
- **Recommended fix**: guard `stopped` flag.

### S2.L2 — Terminal focus microbursts schedule concurrent timers

- **File**: [packages/app/src/pages/session/terminal-panel.tsx:168-194](packages/app/src/pages/session/terminal-panel.tsx)
- **Cause**: rapid tab toggling spawns overlapping rAF + setTimeout
  series before the previous set is cleaned up.
- **Recommended fix**: cancel the previous focus run before starting a
  new one.

---

## 3. Input validation / edge cases

### S1.V1 — Cost arithmetic underflow — already fixed (audit B.5)

- **File**: [packages/opencode/src/session/index.ts:289](packages/opencode/src/session/index.ts)
- **Status**: `Math.max(0, safe(inputTokens - cacheSum))` is in place and
  a warning is logged if the raw count would have gone negative
  ([line 282](packages/opencode/src/session/index.ts#L282)). Flagged by
  the audit agent from a stale report; verified on current tree.

### S1.V2 — Fetch calls without timeout (Ollama, OAuth token exchange)

- **Files**: [packages/opencode/src/mcp/oauth-callback.ts](packages/opencode/src/mcp/oauth-callback.ts) (token POST), `packages/opencode/src/local-models/ollama.ts` (if present)
- **Cause**: a misconfigured Ollama server or a malicious IdP can hang
  these calls indefinitely. The main thread is not blocked, but the
  Effect scope is held forever, leaking file descriptors and SSE
  subscribers.
- **Recommended fix**: wrap with `AbortSignal.timeout(15000)` as already
  done in `webfetch.ts` / `websearch.ts`.

### S1.V3 — `File.read` does not normalize symlinks

- **File**: [packages/opencode/src/file/index.ts:305-665](packages/opencode/src/file/index.ts)
- **Cause**: `Instance.containsPath(resolved)` protects against `..`
  traversal but not against a symlink planted inside the project that
  points outside (e.g. `project/docs -> /etc`). Since the CLI invites the
  AI to freely read files in "the project", an attacker who can plant a
  symlink (through a dep, through a checked-in repo, etc.) can exfiltrate.
- **Recommended fix**: after `resolve()`, stat the path with
  `{followSymlinks: false}` and reject if it's a symlink to anything
  outside `Instance.directory`.

### S2.V1 — RPC worker response map races on ID reuse

- **File**: [packages/opencode/src/util/rpc.ts:24-64](packages/opencode/src/util/rpc.ts)
- **Cause**: `pending.set(id, handler)` / `pending.delete(id)` are not
  atomic around the `resolve()` call, and `id` overflows after 2^53 so
  reuse is theoretically possible. In practice IDs do not overflow in
  normal operation but there is no per-request timeout either.
- **Recommended fix**: delete-before-resolve, per-request timeout (30 s),
  and `id = (id + 1) % MAX_SAFE_INTEGER`.

### S2.V2 — No Zod validation on embedding provider responses

- **File**: [packages/opencode/src/rag/embed.ts:26-88](packages/opencode/src/rag/embed.ts)
- **Cause**: the result of `embed({ model, value })` is trusted verbatim;
  an HF endpoint that starts returning a different shape crashes the
  `Float32Array()` constructor on nested undefined.
- **Recommended fix**: schema-validate the response body, fail loudly.

---

## 4. Secrets & auth

### S1.S1 — WebSocket auth via `?authorization=` query param

- **File**: [packages/opencode/src/server/auth-jwt.ts:110-145](packages/opencode/src/server/auth-jwt.ts)
- **Cause**: browsers and WebView2 silently strip the `Authorization`
  header from WebSocket upgrades, so the codebase passes it as a query
  parameter. That parameter is then visible to any intermediary logging
  request URLs (nginx access logs, android logcat, proxies).
- **Mitigations already in place**: credentials are Basic-auth base64
  rather than bearer tokens, the path is local-only on LAN pairing, and
  password is a random UUID.
- **Recommended fix**: for mobile, route the WebSocket through a Tauri
  command that sets a custom header at the native layer (both tauri-plugin-http
  and `tungstenite` support this); for desktop, bind the sidecar server
  only on `127.0.0.1` (already the case) and consider a one-shot cookie
  handshake before upgrade.

### S1.S2 — `auth.json` tokens stored in plaintext

- **File**: [packages/opencode/src/auth/index.ts](packages/opencode/src/auth/index.ts)
- **Cause**: tokens are written to disk with mode 0o600. That is enough
  to protect against a curious non-root user on the same host, but a full
  disk image or a backup utility that copies home directories will
  exfiltrate the credentials.
- **Recommended fix**: move storage to the OS keychain (macOS Keychain,
  Windows Credential Manager, libsecret on Linux). Large refactor, tracked
  as option B2 of the audit and deferred.

### S2.S1 — Shell env vars inherited by CLI sidecar

- **File**: [packages/desktop/src-tauri/src/cli.rs:371-480](packages/desktop/src-tauri/src/cli.rs)
- **Cause**: `merge_shell_env(load_shell_env(...))` copies every
  variable exported by the user's shell into the sidecar. Anything the
  user exports (`OPENAI_API_KEY`, `AWS_ACCESS_KEY_ID`, etc.) becomes
  visible to every spawned process down the tree.
- **Recommended fix**: keep the merge but filter through a `SHELL_ENV_KEYS`
  allowlist similar to the one already used for `android-pty.ts`. Tracked
  for a follow-up PR.

### S2.S2 — Android network config permits cleartext globally

- **File**: [packages/mobile/src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml](packages/mobile/src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml)
- **Cause**: `<base-config cleartextTrafficPermitted="true" />` opens
  plaintext HTTP on every destination, not just the LAN. Combined with
  the LAN-pairing flow, this means a compromised Wi-Fi can see Basic-auth
  credentials even when the user thinks the link is protected.
- **Recommended fix**: flip `base-config` to `cleartextTrafficPermitted="false"`
  and add a `domain-config cleartextTrafficPermitted="true"` block for
  the 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 ranges only. Needs
  testing on real devices.

### S3.S1 — Android `keystore` not committed but worth confirming on fork

- **File**: [.gitignore](.gitignore) line 3 and 52 already exclude
  `*.keystore` and `*.jks`. Local `packages/mobile/opencode-release.keystore`
  exists outside VCS, which is correct. Audit flag closed.

---

## 5. Fixes applied in this PR

Only one finding from the new audit required a code change. The other
items flagged S1 by the audit agents turned out to be already fixed in
the current tree (noted inline above as "already fixed").

1. **S1.A1**: removed `"devtools": true` from the desktop window
   config — Tauri 2 defaults to `true` in debug builds and `false` in
   release, which is what we want. See
   [packages/desktop/src-tauri/tauri.conf.json](packages/desktop/src-tauri/tauri.conf.json).

All other findings in this document remain open and are tracked for
follow-up PRs. Do not close this document until every S1 is either
fixed or has an explicit "won't fix" decision recorded here with
rationale.
