# OpenCode Mobile

Native mobile app for Android (and future iOS), powered by Tauri 2.0. Supports both local on-device AI and remote connection to a desktop OpenCode server.

## Features

### Dual Mode
- **Local Mode** (Android): Runs an embedded OpenCode server directly on the device with full agent capabilities
- **Remote Mode**: Connects to a desktop OpenCode instance over the network

### Local LLM Inference
- On-device inference via llama.cpp with JNI bridge
- Model management: download GGUF models from HuggingFace, load/unload/delete
- OpenAI-compatible HTTP API via llama-server on port 14097
- File-based IPC between Rust backend and Kotlin LlamaEngine

### Interactive Terminal
- Full PTY terminal on Android via custom musl-compatible `librust_pty.so` (forkpty wrapper)
- Ghostty WASM terminal renderer with canvas fallback for unsupported WebViews
- WebSocket connection to embedded server `/pty/{id}/connect` endpoint
- Multiple terminal tabs with drag-to-reorder

### Native File Picker
- Native Android file/directory picker via `tauri-plugin-dialog`
- File attachment in prompts (images, code files, PDFs)
- Save file dialog for exports

### Mobile-Optimized UI
- Touch targets ≥ 44px on all interactive elements
- Safe area support for notches/cutouts in portrait and landscape
- Responsive settings dialog (narrow sidebar on portrait screens)
- Mobile diff view with compact line numbers and horizontal scroll
- Sidebar drawer with hamburger menu toggle
- Session/Changes tab switcher for mobile navigation
- Mobile "more actions" menu (terminal, fork, search, settings)

## Prerequisites

- [Bun](https://bun.sh) 1.3+
- [Rust](https://rustup.rs) (latest stable)
- [Tauri CLI](https://tauri.app/start/): `cargo install tauri-cli`

### Android
- Android SDK (API 24+)
- Android NDK 27
- CMake 3.22.1 (for llama.cpp JNI build)
- `ANDROID_HOME` and `JAVA_HOME` environment variables set

### iOS (future)
- macOS with Xcode 15+
- Apple Developer account
- CocoaPods: `sudo gem install cocoapods`

## Development

```bash
# From monorepo root:
bun run dev:mobile-android    # Android dev mode

# Or from this directory:
bun run dev                   # Vite dev server only (no native shell)
bun run tauri android dev     # Full Android dev
```

## Build

```bash
# CI/CD builds via GitHub Actions (.github/workflows/android.yml)
# Manual build:
bunx tauri android build --target aarch64
```

## Architecture

```
packages/mobile/
├── src/
│   ├── entry.tsx              # App entry (mode selection, server init)
│   ├── platform.ts            # Mobile Platform adapter (Tauri plugins)
│   ├── mobile.css             # Comprehensive mobile CSS overrides
│   ├── model-catalog.ts       # Pre-curated LLM model catalog (9 models)
│   ├── runtime.ts             # Embedded server runtime management
│   ├── components/
│   │   ├── mode-selector.tsx   # Local/Remote mode chooser
│   │   ├── extraction-progress.tsx  # First-run extraction UI
│   │   └── model-manager.tsx   # LLM model download/manage UI
│   └── notifications.ts       # SSE → push notification bridge
├── src-tauri/
│   ├── tauri.conf.json        # Tauri mobile config + permissions
│   ├── Cargo.toml             # Rust deps (reqwest, futures, serde)
│   ├── src/
│   │   ├── lib.rs             # Tauri commands (runtime + LLM)
│   │   ├── runtime.rs         # Embedded server (bun + symlinks)
│   │   └── llm.rs             # LLM command handler (IPC bridge)
│   └── gen/android/
│       └── app/src/main/
│           ├── java/.../LlamaEngine.kt  # Kotlin JNI bridge for llama.cpp
│           ├── jni/
│           │   ├── llama_jni.c           # C JNI wrapper for llama.cpp
│           │   ├── rust_pty.c            # PTY wrapper (forkpty, musl-compatible)
│           │   └── CMakeLists.txt        # JNI native build config
│           └── AndroidManifest.xml       # Permissions, extractNativeLibs
└── index.html                 # HTML shell with safe area insets
```

### Shared Code

The mobile app reuses the shared `@opencode-ai/app` package for UI components. Mobile adaptations include:
- `src/mobile.css` — Touch targets, safe areas, responsive layouts, terminal/diff/settings overrides
- `src/platform.ts` — Mobile Platform implementation (storage, notifications, clipboard)
- Responsive behavior via `@solid-primitives/media` breakpoints (768px for tablet, 1280px for desktop)

### Native Libraries (Android)

Packaged as JNI libs in `jniLibs/arm64-v8a/`:
- `libbun_exec.so` — Bun JavaScript runtime (musl-linked)
- `libmusl_linker.so` — musl dynamic linker for Android
- `librust_pty.so` — PTY support (musl, forkpty wrapper for bun-pty)
- `libllama.so`, `libggml*.so` — llama.cpp inference engine
- `libllama_jni.so` — C JNI wrapper
- `libllama_server.so` — OpenAI-compatible HTTP server
- `librg_exec.so` — ripgrep for code search
- `libbash_exec.so` — Bash shell
- `libstdcpp_compat.so`, `libgcc_compat.so` — C++ runtime for musl binaries

## Remote Connection

### Setup
1. Start OpenCode server on your desktop: `opencode serve --hostname 0.0.0.0`
2. Note the server URL (e.g., `http://192.168.1.100:4096`)
3. Open the mobile app → Remote → Enter server URL

### Secure Access
For access outside your LAN, use a secure tunnel:
- [Tailscale](https://tailscale.com) (recommended)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)

## Local LLM Models

Pre-curated model catalog:
| Model | Size | Notes |
|-------|------|-------|
| Gemma 4 E4B | 5.0 GB | Recommended — multimodal, 131K context |
| Qwen 3.5 4B | 2.7 GB | Strong reasoning |
| Qwen 3.5 2B | 1.3 GB | Lightweight quality |
| Qwen 3.5 0.8B | 0.5 GB | Ultra-light, fast inference |
| Gemma 3 4B | 2.5 GB | Balanced |
| Gemma 3 1B | 0.7 GB | Ultra-light |
| Qwen 2.5 Coder 7B | 4.5 GB | Best for coding |
| Phi-4 Mini 3.8B | 2.3 GB | Strong reasoning/STEM |
| Llama 3.2 3B | 1.8 GB | Meta's on-device optimized |

Custom models can be searched and downloaded directly from HuggingFace via the built-in search in Settings > Providers > Local AI > Manage.

### Shared UI Features (Mobile + Desktop)

- **Web search toggle**: Globe icon in prompt toolbar
- **Voice input (STT)**: Microphone button with waveform animation
- **Read aloud (TTS)**: Speaker button under AI responses (click to play/pause, double-click to reset)
- **Audio settings**: Settings > Audio tab (STT engine, TTS voice, speed, voice cloning)
