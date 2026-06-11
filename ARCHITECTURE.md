# Architecture

> Quick-reference architecture overview. Full details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Bun 1.3.11 + Turbo 2.8.13 (monorepo workspaces) |
| Language | TypeScript 5.8.2 (sidecar + UI), Rust (Tauri backends), Java/Kotlin (Android) |
| Frontend | SolidJS 1.9.10 + Tailwind 4 + Kobalte |
| Desktop | Tauri 2.0 (Rust backend: TLS, STT/TTS, local LLM orchestration) |
| Mobile | Tauri 2.0 Android + LlamaService JNI (on-device inference) |

## Monorepo layout

```
packages/
├── opencode/      # Core TypeScript sidecar — agent engine, REST/SSE server, CLI, providers
├── app/           # SolidJS frontend — shared by desktop, web, mobile WebView
├── desktop/       # Tauri 2.0 desktop (src-tauri/: tls.rs, speech.rs, llm.rs, server.rs)
├── mobile/        # Tauri 2.0 Android (src-tauri/: lib.rs, llm.rs, runtime.rs, proxy.rs)
│                  # Kotlin: LlamaService.kt (foreground service owning llama-server)
├── ui/            # Shared Kobalte + Tailwind components
├── sdk/js/        # Public TypeScript SDK (OpenAPI generated)
├── console/       # Web dashboard (SolidJS Start + Cloudflare Workers)
├── tui/           # Terminal UI (ink-based)
└── util/          # Shared Zod schemas + utilities
crates/
└── opencode-kokoro-shared/  # Rust: Kokoro TTS ONNX engine
```

## Request flow

```
SolidJS UI  →  POST /session/:id/stream (SSE, Hono server)
            →  Session.send() → SessionProcessor → LLM.stream()
            →  Provider resolution (cloud or local-llm pseudo-provider)
            →  Vercel AI SDK streamText()
            →  Cloud API  OR  llama-server:14097 (local GPU sidecar)
```

## Key architectural decisions

- **Mobile gate**: all llama-server spawn logic gated via `process.env.OPENCODE_CLIENT === "mobile-embedded"` — Android owns the process through `LlamaService` (JNI), not the sidecar.
- **Config cascade** (lowest → highest priority): `~/.opencode/config.json` → `./opencode.json` → MDM profile (macOS) → environment variables.
- **CSP/IPC (Windows)**: `connect-src` must whitelist `http://ipc.localhost` (Tauri IPC) and `http://asset.localhost` (static assets).
- **Sidecar build**: `bun tauri build` does NOT rebuild the TypeScript sidecar. Always run `bun run build --single --baseline` in `packages/opencode` first.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architecture document including thread model, data flow, and fork-specific additions.
