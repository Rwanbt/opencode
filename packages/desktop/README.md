# OpenCode Desktop

Native OpenCode desktop app, built with Tauri v2.

## Features

### Local LLM Inference

Run AI models locally on your GPU via llama.cpp (b8731), with zero cloud dependency.

- **Auto-managed runtime**: llama.cpp Vulkan backend downloaded automatically on first model load
- **Auto-start**: LLM server starts when a local model is selected or on app launch
- **Smart memory**: `--fit` auto-adjusts context size and GPU layer placement to available VRAM
- **Hadamard rotation**: KV cache quantization with rotation (PR #21038) for near-lossless 4-bit compression
- **Speculative Decoding**: optional `--model-draft` with VRAM Guard (auto-disables if <1.5GB free)
- **HuggingFace search**: browse and download GGUF models with VRAM compatibility badges
- **OpenAI-compatible API**: local server on `http://127.0.0.1:14097/v1`

#### Optimized Prompt for Local Models

The system prompt is **94% smaller** for local models (~1K tokens vs ~16K for cloud models):
- Compact `local.txt` prompt (400 tokens vs 8.7K `default.txt`)
- Skeleton tool descriptions (1-line signatures vs multi-KB prose)
- Only 7 essential tools (bash, read, edit, write, glob, grep, question)
- No skills section, minimal environment info

#### Model Catalog

| Model | Size | Notes |
|-------|------|-------|
| Gemma 4 E4B | 5.0 GB | Recommended — multimodal, 131K context |
| Qwen 3.5 4B | 2.7 GB | Strong reasoning |
| Qwen 3.5 2B | 1.3 GB | Lightweight quality |
| Qwen 3.5 0.8B | 0.5 GB | Draft model for speculative decoding |

Custom GGUF models downloadable from HuggingFace with VRAM-based recommendations.

#### llama-server Flags

Most numeric flags are derived at runtime by `packages/opencode/src/local-llm-server/auto-config.ts` (`deriveConfig()`) from the detected device profile (total/free RAM, big CPU cores, GPU backend + VRAM, thermal state). Environment variables let advanced users pin specific values.

| Flag | Value | Purpose |
|------|-------|---------|
| `--n-gpu-layers <N>` | adaptive (env: `OPENCODE_N_GPU_LAYERS`) | Layers offloaded to fit 85 % of detected VRAM |
| `--threads <N>` | adaptive (2–6, big cores only) | Performance cores via cpufreq split |
| `--batch-size <N>` | adaptive (64–512) | Scales with free RAM, halved under thermal throttle |
| `--ubatch-size <N>` | batch / 4 | Sub-batch for prefill |
| `--cache-type-k/v` | adaptive f16/q8_0/q4_0 (env: `OPENCODE_KV_CACHE_TYPE`) | Quant tier from VRAM headroom |
| `--fit on` | auto (fork-only, opt-in via `OPENCODE_LLAMA_ENABLE_FIT`) | Secondary VRAM adjustment |
| `-fitt 512` / `-fitc 16384` | margin + min ctx (when `--fit` enabled) | Never below 16K context |
| `--flash-attn on` | — | Flash Attention |
| `-np 1` | single slot | Minimize VRAM |
| `--model-draft` | optional | Speculative decoding (VRAM Guard) |

The runtime logs `log.info("llama adaptive config", { profile, chosen, modelSizeMb })` at each spawn so you can verify the derived values.

### Speech-to-Text (STT)

Integrated NVIDIA Parakeet TDT 0.6B v3 (INT8) via ONNX Runtime.

- **~300ms** for 5s of audio (18x real-time on CPU)
- **25 European languages** (English, French, German, Spanish, etc.)
- **Zero VRAM**: CPU-only (~700 MB RAM)
- **Auto-download**: model (~460 MB) on first mic press
- **Waveform animation** during recording

### Text-to-Speech (TTS)

Kyutai Pocket TTS with voice cloning.

- **French-native**: created by Kyutai (Paris)
- **8 built-in voices**: Alba, Fantine, Cosette, Eponine, Azelma, Marius, Javert, Jean
- **Zero-shot voice cloning**: upload WAV or record from mic
- **100M params**: CPU-only, ~6x real-time
- **HTTP server**: `pocket-tts serve` on port 14100

Fallback Kokoro TTS ONNX engine also integrated (54 voices, 9 languages, CMUDict G2P).

### Web Search

Globe icon in prompt toolbar — toggle web search per message.

### Settings

#### Audio (Settings > Audio)
- STT enable/disable, engine selection (Parakeet), language
- TTS voice selection (8 built-in + custom clones), speed, auto-play
- Voice cloning: upload WAV file or record directly from mic

#### Configuration (Settings > Configuration)
- **Presets**: Fast / Quality / Eco / Long Context — one-click configuration
- **VRAM widget**: real-time GPU usage bar (green/yellow/red)
- **Output tokens**: auto (adapts to model size) or manual
- **Context window**: auto or manual
- **Sampling**: temperature, top_p
- **KV cache**: auto / q8_0 / q4_0 / f16 (with Hadamard rotation note)
- **GPU offloading**: auto / gpu-max / balanced
- **Memory mapping**: auto / on (SSD streaming) / off

### Prompt Toolbar

| Button | Icon | Action |
|--------|------|--------|
| Thinking | brain | Toggle model thinking |
| Web Search | globe | Toggle web search |
| Voice Input | microphone | Record → STT → text |
| Send | arrow | Send message |

### OAuth Sign-in (deep link)

Providers that redirect back to the app no longer require the user to
copy-paste the authorization code. Register
`opencode://oauth/callback?providerID=<id>&code=<code>&state=<opt>` as
the `redirect_uri` and the desktop shell auto-finalises the token
exchange — see
[`packages/app/src/pages/layout/deep-links.ts`](../app/src/pages/layout/deep-links.ts)
(`parseOAuthCallbackDeepLink` + `oauthCallbackEvent`) and
`dialog-connect-provider.tsx` for the UI-side listener. Refresh token
rotation and keychain-backed storage are tracked separately in
[`SECURITY_AUDIT.md`](../../SECURITY_AUDIT.md) §4.

### Git upstream notifications

Each project opens a fork-scoped probe (warm-up 30 s, then every 5 min)
that runs `git fetch --quiet --prune` on the tracked upstream and
compares `rev-list --count HEAD..upstream` / `upstream..HEAD`. A
divergence publishes `vcs.branch.behind` on the bus and the
notification context forwards it to `platform.notify()` with a native
OS notification. Offline or detached-HEAD states are logged at `warn`
and do not tear down the VCS service.

### Release hardening

`devtools` is no longer force-enabled on the main window — Tauri 2's
default (debug-only) is now respected, which keeps production builds
free of the `__TAURI__` inspection surface an XSS foothold would
otherwise abuse.

## Prerequisites

- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) (Rust, platform libs)
- Python 3.10+ with `pip install pocket-tts` (for TTS)

## Build

```bash
# 1. Build CLI sidecar
cd packages/opencode && bun run build --single

# 2. Copy sidecar
mkdir -p packages/desktop/src-tauri/sidecars
cp packages/opencode/dist/opencode-windows-x64/bin/opencode.exe \
   packages/desktop/src-tauri/sidecars/opencode-cli-x86_64-pc-windows-msvc.exe

# 3. Build (requires MSVC on Windows for ONNX Runtime)
bun run --cwd packages/desktop tauri build
```

## Architecture

```
packages/desktop/
├── src/
│   ├── index.tsx                      # App entry, auto-start LLM + STT/TTS
│   └── hooks/
│       ├── use-auto-start-llm.ts      # Auto-start LLM + draft model detection
│       └── use-speech.ts              # STT mic capture + TTS playback
├── src-tauri/
│   ├── Cargo.toml                     # Deps: ort, ndarray, hound, reqwest, zip, bincode
│   └── src/
│       ├── lib.rs                     # Tauri commands + app setup
│       ├── llm.rs                     # LLM server: download, spawn, speculative decoding, VRAM
│       ├── speech.rs                  # STT (Parakeet) + TTS (Pocket TTS) commands
│       ├── parakeet/engine.rs         # ONNX STT: preprocess → encode → TDT decode
│       └── kokoro/engine.rs           # ONNX TTS: G2P → tokenize → synthesize
└── assets/
    └── cmudict.dict                   # 135K English pronunciation dictionary for Kokoro
```

### Service Ports

| Service | Port | Protocol |
|---------|------|----------|
| LLM (llama-server) | 14097 | HTTP (OpenAI-compatible) |
| TTS (pocket-tts) | 14100 | HTTP (FastAPI) |

### Data Paths (Windows)

| Data | Path |
|------|------|
| LLM models | `%APPDATA%/.../models/` |
| LLM runtime | `%APPDATA%/.../llama-runtime/` |
| STT model | `%APPDATA%/.../speech/parakeet-tdt-0.6b-v3-int8/` |
| TTS voices | `%APPDATA%/.../speech/voices/` |
| Kokoro model | `~/.cache/kokoros/kokoro-v1.0.onnx` |

## Troubleshooting

### Local LLM not responding
1. Check: `curl http://127.0.0.1:14097/health`
2. Ensure GPU drivers up to date (Vulkan required)
3. Try smaller model if VRAM insufficient

### STT not working
1. First use downloads ~460 MB model
2. Check browser mic permissions
3. Check logs for `[STT]` or `[Parakeet]` entries

### TTS not working
1. Ensure Python installed: `pip install pocket-tts`
2. First use downloads Pocket TTS model from HuggingFace
3. Check: `curl http://127.0.0.1:14100/health`
