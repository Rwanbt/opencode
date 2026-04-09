# OpenCode Desktop

Native OpenCode desktop app, built with Tauri v2.

## Features

### Local LLM Inference

Run AI models locally on your GPU via llama.cpp, with zero cloud dependency.

- **Auto-managed runtime**: llama.cpp Vulkan backend is downloaded automatically on first model load
- **Auto-start**: The LLM server starts automatically when a local model is selected or on app launch
- **Smart memory management**: Uses llama.cpp `--fit` to auto-adjust context size and layer placement to available VRAM
- **Optimized inference**: Flash Attention, KV cache quantization (q8_0), single-slot mode
- **HuggingFace search**: Browse and download GGUF models directly from HuggingFace
- **OpenAI-compatible API**: Local server on `http://127.0.0.1:14097/v1`

#### Pre-curated Model Catalog

| Model | Size | Notes |
|-------|------|-------|
| Gemma 4 E4B | 5.0 GB | Recommended — multimodal, 131K context |
| Qwen 3.5 4B | 2.7 GB | Strong reasoning |
| Qwen 3.5 2B | 1.3 GB | Lightweight quality |
| Qwen 3.5 0.8B | 0.5 GB | Ultra-light, fast inference |

Custom models can be downloaded from any HuggingFace GGUF URL via the built-in search.

#### GPU Requirements

| GPU VRAM | Recommended Model | Expected Context |
|----------|------------------|-----------------|
| 4 GB | Qwen 3.5 2B (Q4) | ~32K tokens |
| 6 GB | Qwen 3.5 4B (Q4) | ~32K tokens |
| 8 GB | Gemma 4 E4B (Q4) | ~131K tokens |
| 12 GB+ | Qwen 2.5 Coder 7B (Q4) | ~64K tokens |

#### Server Flags Reference

The desktop app launches `llama-server` with these optimized flags:

| Flag | Value | Purpose |
|------|-------|---------|
| `--n-gpu-layers` | `99` | Offload all layers to GPU |
| `--fit` | `on` | Auto-adjust ctx/layers to available VRAM |
| `-fitt` | `512` | Leave 512 MiB free for OS/display |
| `-fitc` | `16384` | Never go below 16K context |
| `--flash-attn` | `on` | Flash Attention for memory efficiency |
| `--cache-type-k` | `q8_0` | KV cache quantization (keys) — 47% VRAM savings |
| `--cache-type-v` | `q8_0` | KV cache quantization (values) — 47% VRAM savings |
| `-np` | `1` | Single slot to minimize VRAM usage |
| `--threads` | auto | Physical CPU cores (auto-detected) |

### Speech-to-Text (STT)

Built-in speech recognition using NVIDIA Parakeet TDT 0.6B v3 (INT8), powered by ONNX Runtime.

- **Integrated engine**: No external app needed — Parakeet runs directly inside the app via ONNX Runtime
- **Fast**: ~300ms transcription for 5s of audio (18x real-time on CPU)
- **25 languages**: English, French, German, Spanish, and 21 more European languages
- **Zero VRAM**: Runs on CPU only (~700 MB RAM), does not consume GPU memory
- **Auto-download**: Model (~460 MB) is downloaded automatically on first use
- **Microphone button**: Click the mic icon in the prompt toolbar, speak, click again — text appears instantly

#### STT Model

| Model | Size | Speed | Languages |
|-------|------|-------|-----------|
| Parakeet TDT 0.6B v3 INT8 | 670 MB | ~300ms / 5s audio | 25 European languages |

Model files (CC-BY-4.0 license, NVIDIA) are stored in `speech/parakeet-tdt-0.6b-v3-int8/`.

### Text-to-Speech (TTS)

Read AI responses aloud using the browser's built-in SpeechSynthesis engine.

- **Speaker button**: Click the speaker icon under any AI response to hear it read aloud
- **Toggle**: Click again to stop playback

### Web Search

Toggle web search from the prompt input toolbar (globe icon between thinking and send buttons).

### Audio Settings

Configure STT and TTS in **Settings > Audio**:

- Enable/disable STT and TTS
- Select STT engine (Parakeet built-in, or Whisper fallback)
- STT language selection
- TTS voice, speed, and auto-play options

## Prerequisites

Building the desktop app requires additional Tauri dependencies (Rust toolchain, platform-specific libraries). See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for setup instructions.

## Development

From the repo root:

```bash
bun install
bun run --cwd packages/desktop tauri dev
```

## Build

The desktop build requires the OpenCode CLI sidecar:

```bash
# 1. Build the CLI
cd packages/opencode && bun run build --single

# 2. Copy to sidecars
mkdir -p packages/desktop/src-tauri/sidecars
cp packages/opencode/dist/opencode-windows-x64/bin/opencode.exe \
   packages/desktop/src-tauri/sidecars/opencode-cli-x86_64-pc-windows-msvc.exe

# 3. Build the desktop app
bun run --cwd packages/desktop tauri build
```

## Architecture

```
packages/desktop/
├── src/
│   ├── index.tsx                  # App entry (platform, server init, auto-start LLM + STT)
│   ├── bindings.ts                # Generated Tauri command bindings (specta)
│   └── hooks/
│       ├── use-auto-start-llm.ts  # Auto-start local LLM on model selection
│       └── use-speech.ts          # STT mic recording + TTS playback
├── src-tauri/
│   ├── tauri.conf.json            # Tauri config + permissions
│   ├── Cargo.toml                 # Rust deps (reqwest, zip, ort, ndarray, hound)
│   └── src/
│       ├── lib.rs                 # Tauri commands + app setup
│       ├── llm.rs                 # LLM server management (download, start, stop)
│       ├── speech.rs              # STT commands (download model, load, transcribe)
│       ├── parakeet/
│       │   ├── mod.rs             # Parakeet module
│       │   └── engine.rs          # ONNX Runtime inference (preprocess, encode, decode)
│       ├── server.rs              # Sidecar (opencode-cli) management
│       ├── cli.rs                 # CLI sync + installation
│       └── ...
└── index.html
```

### Data Paths

| Platform | LLM Models | LLM Runtime | STT Model |
|----------|-----------|-------------|-----------|
| Windows | `%APPDATA%/…/models/` | `%APPDATA%/…/llama-runtime/` | `%APPDATA%/…/speech/parakeet-tdt-0.6b-v3-int8/` |
| macOS | `~/Library/Application Support/…/models/` | `…/llama-runtime/` | `…/speech/parakeet-…/` |
| Linux | `~/.local/share/…/models/` | `…/llama-runtime/` | `…/speech/parakeet-…/` |

## Troubleshooting

### Rust compiler not found

Install Rust via [rustup](https://rustup.rs/):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Local LLM not responding

1. Check if the server is running: `curl http://127.0.0.1:14097/health`
2. Check app logs in `%LOCALAPPDATA%/ai.opencode.desktop.dev/logs/`
3. Ensure your GPU drivers are up to date (Vulkan support required)
4. Try deleting the runtime folder and restarting (it will re-download)

### Out of VRAM

The `--fit` system automatically adjusts, but if you still get OOM errors:
- Close other GPU-intensive applications
- Try a smaller model (Qwen 3.5 2B uses only ~1.3 GB)
- The server will automatically reduce context size to fit

### STT not working

1. Check if the model is downloaded: look for `speech/parakeet-tdt-0.6b-v3-int8/encoder-model.int8.onnx`
2. First use will download ~460 MB — ensure you have internet access
3. Check browser microphone permissions (the app will ask on first use)
4. Check app logs for `[STT]` or `[Parakeet]` entries
