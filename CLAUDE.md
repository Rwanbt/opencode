# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules

- ALWAYS fix ALL errors, including pre-existing ones. Never dismiss an error as "pre-existing" or "not related to our changes". If you encounter it, you fix it.
- GPU acceleration is mandatory. Never suggest CPU-only as a solution.
- Android builds take 5+ minutes. Never compile without thorough code verification first.

## Anti-loop rules

- After 3 failed attempts on the same problem, STOP. Write the full diagnosis and propose 2-3 alternative approaches BEFORE coding anything.
- Before any fix, write in 2 lines: the root cause and why this approach solves it. If you can't, you don't understand the problem.
- Never use sed/regex on source code. Use str_replace with textual anchors or refactor cleanly.
- When a test fails: diagnose first (1 message), propose the plan (1 message), implement after. No trial-and-error loops.

## Performance debugging

- When measured performance is far from vendor specs (>3x gap), look for integration bugs FIRST (wrong parameter, wrong endpoint, wrong format) before optimizing infrastructure.
- Read the actual API documentation/source before building optimization layers on top.

## Fix verification

- After any fix, grep the corrected pattern across the ENTIRE project to find other occurrences of the same bug. Never fix just the first occurrence found.

## Deployment

- Desktop build: `cd packages/desktop && bun tauri build`
- Desktop deploy: copy `packages/desktop/src-tauri/target/release/OpenCode.exe` to `C:/Users/barat/AppData/Local/OpenCode Dev/OpenCode.exe`
- NEVER deploy to `C:/Users/barat/AppData/Local/OpenCode` (no "Dev" suffix) or `C:/Users/barat/AppData/Local/Programs/@opencode-aidesktop` — those are reserved for the genuine official Electron release (identifier `ai.opencode.desktop`, installed from github.com/anomalyco/opencode releases). This fork's Tauri build always uses identifier `ai.opencode.desktop.dev` / "OpenCode Dev".
- Android build: `cd packages/mobile && bun tauri android build --target aarch64` (requires `ORT_LIB_LOCATION=D:/tmp/ort-android`)
- Sidecar (required before desktop build): `cd packages/opencode && bun run build --single --baseline`, then copy to `packages/desktop/sidecars/opencode-cli-x86_64-pc-windows-msvc.exe`
- NEVER touch Antigravity (the IDE). NEVER kill processes that aren't ours.

---

## Enterprise Readiness — Function Size

Cible pour tout nouveau code TypeScript :

| Métrique | Cible | Alerte | Bloquant |
|----------|-------|--------|----------|
| LOC par fonction | ≤ 50 | > 100 | > 200 |
| LOC par fichier (packages/app/) | ≤ 500 | > 800 | > 1500 |

**Technique** : si une fonction dépasse 50 LOC, extraire via le pattern Factory with Deps (ADR-0001).

**Exceptions documentées** : coordinateurs (session.tsx ~1010 LOC, layout.tsx ~1127 LOC) — voir ADR-0002.

## Design Review — Step 0

Avant toute extraction de module ou refactoring majeur :

1. Rédiger un mini-ADR (2 phrases : contexte + décision) dans `docs/adr/`
2. Vérifier que l'extraction respecte Single Responsibility
3. Identifier les dépendances circulaires potentielles avant de coder

## Commands

**Package manager: Bun 1.3.11** (exact lock enforced). Do not use npm/yarn/pnpm.

```bash
# Dev servers
bun run dev              # TUI CLI dev mode (root)
bun run dev:desktop      # Tauri desktop with hot reload
bun run dev:mobile-android  # Android dev build

# Build
cd packages/opencode && bun run build --single --baseline   # CLI sidecar
cd packages/desktop && bun tauri build                       # Desktop release
cd packages/mobile && bun tauri android build --target aarch64  # Android APK

# Type checking (run before any build)
bun run typecheck

# Testing — MUST run from the package directory, not root
cd packages/opencode && bun test --timeout 30000
cd packages/opencode && bun test --filter <name> --timeout 30000
cd packages/app && bun test --preload ./happydom.ts ./src

# Linting / formatting
bun run lint
bun run format
```

**Critical**: `bun tauri build` does NOT rebuild the TypeScript sidecar. Always run `bun run build --single --baseline` in `packages/opencode` first and copy the output manually.

---

## Architecture

### Monorepo (Bun + Turbo workspaces)

```
packages/
├── opencode/      # Core TypeScript sidecar: agent engine, REST server, CLI, all providers
├── app/           # SolidJS frontend (shared by desktop, web, mobile WebView)
├── desktop/       # Tauri 2.0 desktop — Rust backend (TLS, speech, local LLM orchestration)
├── mobile/        # Tauri 2.0 Android — Rust + Kotlin (LlamaService JNI, on-device inference)
├── ui/            # Shared Kobalte + Tailwind components
├── sdk/js/        # Public TypeScript SDK (generated from OpenAPI spec)
├── console/       # Web dashboard (SolidJS Start + Cloudflare)
└── util/          # Shared Zod schemas and utilities
crates/
└── opencode-kokoro-shared/  # Rust: Kokoro TTS ONNX engine
```

### Request flow

```
SolidJS UI  →  POST /session/:id/stream (SSE, Hono server)
            →  Session.send() → SessionProcessor → LLM.stream()
            →  Provider resolution (cloud or local-llm pseudo-provider)
            →  Vercel AI SDK streamText()
            →  Cloud API  OR  llama-server:14097 (local, C++ GPU sidecar)
```

### Key modules in `packages/opencode/src/`

| Module | Role |
|--------|------|
| `session/session.ts` | Session FSM, message storage, event bus |
| `session/processor.ts` | Tool call orchestration, doom-loop detection |
| `session/llm.ts` | LLM streaming, adaptive context limits |
| `session/compaction.ts` | Auto-pruning and summarization |
| `provider/provider.ts` | 20+ cloud providers + local-llm pseudo-provider (65 KB) |
| `provider/transform.ts` | Normalizes provider options, prompt caching, error handling (39 KB) |
| `local-llm-server/index.ts` | llama-server lifecycle: single-flight lock, health poll, model swap |
| `mcp/` | Model Context Protocol, OAuth provider framework |
| `storage/` | Drizzle ORM (SQLite), auth tokens, config cascade |
| `server.ts` | Hono REST + SSE server |

### Desktop Rust backend (`packages/desktop/src-tauri/src/`)

- `tls.rs` — self-signed cert generation (rcgen, 10-year, SHA-256)
- `server.rs` — RemoteConfig (UUID + password), TLS toggle
- `speech.rs` — Parakeet STT + Kokoro TTS (ONNX) + Pocket voice clone sidecar
- `llm.rs` — local model Tauri commands bridging to `local-llm-server`

### Mobile Rust backend (`packages/mobile/src-tauri/src/`)

- `lib.rs` — Tauri mobile entry, logcat logging (tag: `OpenCode`)
- `llm.rs` — `load_llm_model`, `set_llm_config`, `get_memory_info`, `llm_idle_tick`
- `runtime.rs` — Alpine rootfs setup, toolchain wrappers (Rust/Python/etc.), embedded sidecar env
- `proxy.rs` — LAN port proxy (atomic port allocation)
- Java: `LlamaService.kt` — foreground service owning llama-server process (API 34+)

### Frontend (`packages/app/src/`)

SolidJS 1.9.10 + Tailwind 4. Entry: `entry.tsx`. Key dirs: `pages/`, `components/`. Uses SolidJS stores + localStorage, event bus via `solid-primitives/event-bus`.

### Local LLM lifecycle

`ensureRunning(modelID)` in `local-llm-server/index.ts` is the single entry point. It:
1. Acquires `start.lock` (`O_EXCL`) to prevent concurrent spawns
2. Writes `owner.pid` JSON atomically
3. Polls `/health` up to 120 s
4. Validates loaded model matches requested; kills and respawns if not
5. Tracks subscribers via `refs/{pid}.ref` files; prunes stale refs on startup

**Android only**: llama-server is owned by `LlamaService` (Kotlin JNI), not spawned by the sidecar. Gate all llama-server spawn logic with `process.env.OPENCODE_CLIENT === "mobile-embedded"`.

### Config cascade (lowest → highest priority)

`~/.opencode/config.json` → `./opencode.json` → MDM profile (macOS) → environment variables

### CSP / IPC (Windows desktop WebView)

`connect-src` must whitelist `http://ipc.localhost` (Tauri IPC) and `http://asset.localhost` (static assets). Missing entries cause silent IPC failures.

## Health Stack

- typecheck: bun turbo typecheck
- lint: bunx biome check .
- test: cd packages/opencode && bun test --timeout 30000
- deadcode: bunx knip --no-progress
- shell: shellcheck scripts/*.sh
- rust: cargo check --manifest-path packages/desktop/src-tauri/Cargo.toml
