# OpenCode Desktop

Native OpenCode desktop app, built with Tauri v2.

## Features

### Local LLM Inference

Run AI models locally on your GPU via llama.cpp, with zero cloud dependency.

- **Auto-managed runtime**: llama.cpp Vulkan backend downloaded automatically on first model load
- **Auto-start**: LLM server starts automatically when a local model is selected or on app launch
- **Smart memory**: Uses `--fit` to auto-adjust context size and GPU layer placement to available VRAM
- **Optimized**: Flash Attention, KV cache q8_0, single-slot mode, auto CPU thread detection
- **HuggingFace search**: Browse and download GGUF models directly from HuggingFace
- **OpenAI-compatible API**: Local server on `http://127.0.0.1:14097/v1`

#### Model Catalog

| Model | Size | Notes |
|-------|------|-------|
| Gemma 4 E4B | 5.0 GB | Recommended — multimodal, 131K context |
| Qwen 3.5 4B | 2.7 GB | Strong reasoning |
| Qwen 3.5 2B | 1.3 GB | Lightweight quality |
| Qwen 3.5 0.8B | 0.5 GB | Ultra-light, fast inference |

Custom GGUF models downloadable from HuggingFace via built-in search.

#### llama-server Flags

| Flag | Value | Purpose |
|------|-------|---------|
| `--n-gpu-layers` | `99` | Offload all layers to GPU |
| `--fit on` | auto | Auto-adjust to available VRAM |
| `-fitt` | `512` | Leave 512 MiB free for OS |
| `-fitc` | `16384` | Minimum 16K context |
| `--flash-attn on` | — | Flash Attention |
| `--cache-type-k/v` | `q8_0` | KV cache quantization (47% savings) |
| `-np 1` | — | Single slot to save VRAM |

### Speech-to-Text (STT)

Built-in speech recognition using NVIDIA Parakeet TDT 0.6B v3 (INT8) via ONNX Runtime.

- **~300ms** transcription for 5s of audio (18x real-time on CPU)
- **25 European languages** (English, French, German, Spanish, Italian, etc.)
- **Zero VRAM**: CPU-only (~700 MB RAM)
- **Auto-download**: Model (~460 MB) downloaded on first mic button press
- **Waveform animation** during recording

#### STT Technology

| Component | Technology |
|-----------|-----------|
| Model | NVIDIA Parakeet TDT 0.6B v3 (INT8 quantized) |
| Runtime | ONNX Runtime (Rust, `ort` crate) |
| Preprocessing | nemo128.onnx (mel spectrogram) |
| Encoder | FastConformer encoder (652 MB) |
| Decoder | TDT transducer decoder (18 MB) |
| License | CC-BY-4.0 (NVIDIA) |

### Text-to-Speech (TTS)

Natural-sounding voice synthesis using Kyutai Pocket TTS.

- **French-native**: Created by Kyutai (Paris), excellent French and English
- **Voice cloning**: Zero-shot cloning from any 5-10s audio sample
- **8 built-in voices**: Alba, Fantine, Cosette, Eponine, Azelma, Marius, Javert, Jean (Les Misérables)
- **100M parameters**: Lightweight, runs on CPU (2 cores, ~6x real-time)
- **HTTP API**: `pocket-tts serve` on port 14100
- **~1.5-3s** synthesis per sentence

#### TTS Technology

| Component | Technology |
|-----------|-----------|
| Model | Kyutai Pocket TTS (100M params) |
| Runtime | Python + PyTorch (CPU) |
| Server | FastAPI (`pocket-tts serve`) |
| API | `POST /tts` (multipart: text + voice) |
| Voice cloning | Zero-shot via `voice_wav` parameter |
| License | CC-BY-4.0 (Kyutai) |

### Web Search

Toggle web search from the prompt input toolbar (globe icon).

### Audio Settings

**Settings > Audio** provides full control:

- **STT**: Enable/disable mic button, language selection
- **TTS**: Voice selection (8 built-in + custom clones), speed, auto-play
- **Voice Cloning**: Upload WAV file or record directly from microphone

### Prompt Toolbar

The prompt input has these buttons (left to right):

| Button | Icon | Action |
|--------|------|--------|
| Thinking | brain | Toggle model thinking mode |
| Web Search | globe | Toggle web search for this message |
| Voice Input | microphone | Record speech → transcribe → insert text |
| Send | arrow | Send message |

## Prerequisites

- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) (Rust toolchain, platform libs)
- Python 3.10+ with `pip install pocket-tts` (for TTS)

## Development

```bash
bun install
bun run --cwd packages/desktop tauri dev
```

## Build

```bash
# 1. Build CLI sidecar
cd packages/opencode && bun run build --single

# 2. Copy to sidecars
mkdir -p packages/desktop/src-tauri/sidecars
cp packages/opencode/dist/opencode-windows-x64/bin/opencode.exe \
   packages/desktop/src-tauri/sidecars/opencode-cli-x86_64-pc-windows-msvc.exe

# 3. Build (requires MSVC for ONNX Runtime)
# On Windows, use Developer Command Prompt or vcvarsall.bat
bun run --cwd packages/desktop tauri build
```

## Architecture

```
packages/desktop/
├── src/
│   ├── index.tsx                      # App entry, auto-start LLM + STT/TTS
│   ├── bindings.ts                    # Tauri command bindings (specta)
│   └── hooks/
│       ├── use-auto-start-llm.ts      # Auto-start local LLM on model selection
│       └── use-speech.ts              # STT mic capture + TTS playback control
├── src-tauri/
│   ├── Cargo.toml                     # Rust deps (ort, ndarray, hound, reqwest, zip)
│   └── src/
│       ├── lib.rs                     # Tauri commands + app setup
│       ├── llm.rs                     # LLM: download runtime, spawn llama-server
│       ├── speech.rs                  # STT (Parakeet) + TTS (Pocket TTS) commands
│       ├── parakeet/
│       │   ├── mod.rs
│       │   └── engine.rs              # ONNX inference: preprocess → encode → decode
│       ├── server.rs                  # Sidecar management
│       └── cli.rs                     # CLI sync
└── index.html
```

### Data Paths (Windows)

| Data | Path |
|------|------|
| LLM models | `%APPDATA%/.../models/` |
| LLM runtime | `%APPDATA%/.../llama-runtime/` |
| STT model | `%APPDATA%/.../speech/parakeet-tdt-0.6b-v3-int8/` |
| Voice clones | `%APPDATA%/.../speech/voices/` |
| App logs | `%LOCALAPPDATA%/.../logs/` |

### Service Ports

| Service | Port | Protocol |
|---------|------|----------|
| LLM (llama-server) | 14097 | HTTP (OpenAI-compatible) |
| TTS (pocket-tts) | 14100 | HTTP (FastAPI) |

## Troubleshooting

### Local LLM not responding
1. Check: `curl http://127.0.0.1:14097/health`
2. Ensure GPU drivers are up to date (Vulkan required)
3. Try a smaller model if VRAM is insufficient

### STT not working
1. First use downloads ~460 MB model
2. Check browser mic permissions
3. Check logs for `[STT]` or `[Parakeet]` entries

### TTS not working
1. Ensure Python is installed: `pip install pocket-tts`
2. First use downloads the Pocket TTS model from HuggingFace
3. Check if server is running: `curl http://127.0.0.1:14100/health`
4. Check logs for `[TTS]` entries
