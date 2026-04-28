# Gemma 4 multimodal — implementation status & next steps

**Date:** 2026-04-28
**Context:** Driven by the Google AI Edge Gallery comparison roadmap.
**Scope:** vision in Gemma 4 E4B for OpenCode mobile and desktop.
**Audio:** out of scope (Parakeet / Murmur STT pre-pass already covers
the user's needs; llama.cpp upstream rejected Gemma 4 native audio in
PR #21868 "not planned").

## What we know about Gemma 4 (2026-04-02 release)

- Apache 2.0, four variants (E2B, **E4B**, 26B-A4B MoE, 31B dense).
- E4B: 4.5B effective parameters, 128K context.
- **Multimodal native in the base architecture**: text + image + audio + video.
  No separate `-vision` suffix in model names. The `gemma-4-E4B-it.gguf`
  GGUF a HuggingFace community ship (unsloth, bartowski) IS the
  vision-capable model.
- Vision encoder: 2D learned positions + multidim RoPE, variable aspect
  ratio, token budgets 70 / 140 / 280 / 560 / 1120.
- Function calling: native JSON `call:foo{args}` format.
- Configurable thinking modes + system role built-in.
- Reference packaging: `litert-community/gemma-4-E4B-it-litert-lm`
  (`.litertlm` 3.65 GB + `.task` 2.96 GB Web). No GGUF published by
  Google directly.

## llama.cpp upstream support status

- ✅ **Vision Gemma 4 in mtmd** — PR #21851 merged 2026-04-14
  (`mtmd_image_tokens_get_decoder_pos()` API).
- ✅ **mmproj VRAM accounting** — PR #21874 closed 2026-04-24.
  Confirms a separate `mmproj-*.gguf` projector file exists and is
  required even for "native vision" architectures.
- ⚠️ **Image regeneration bug** — issue #22093 open (workaround: rebuild
  the conversation history without image when re-prompting).
- ❌ **Audio Gemma 4 in server** — PR #21868 "not planned". Mainteners
  rejected adding `input_audio` content-type routing. Audio capability
  exists in the model weights but isn't reachable through the standard
  `/v1/chat/completions` endpoint.

## OpenCode current state (2026-04-28)

### Frontend ✅ ~80 % ready

The composer's "+" button already exists and accepts images:

- [`packages/app/src/components/prompt-input.tsx:1566-1579`](../packages/app/src/components/prompt-input.tsx)
  — "+" icon → `pick()` → file picker.
- [`packages/app/src/components/prompt-input.tsx:1448-1459`](../packages/app/src/components/prompt-input.tsx)
  — `ACCEPTED_FILE_TYPES` already includes images.
- `addAttachments()` line 1074 produces `ImageAttachmentPart`s.
- Drag-and-drop also wired (line 1327-1330).
- **What's missing** is the plumbing that carries `ImageAttachmentPart`
  through the request pipeline to llama-server. Most likely the part is
  silently dropped when the agent serialises the prompt.

### Mobile backend ❌ — the actual gap

- [`LlamaHttpServer.kt:278-294`](../packages/mobile/src-tauri/gen/android/app/src/main/java/ai/opencode/mobile/LlamaHttpServer.kt)
  — `extractContent()` extracts `type="text"` blocks only and silently
  ignores images.
- Endpoint used: `/completion` (text only), not `/v1/chat/completions`
  multimodal.
- Format: ChatML strict (`<|im_start|>role\ncontent<|im_end|>`).

### Desktop backend ❓

- llama-server is started by the TypeScript sidecar
  ([`packages/opencode/src/local-llm-server/index.ts`](../packages/opencode/src/local-llm-server/index.ts)).
- No `--mmproj` flag is currently passed.
- `/v1/chat/completions` is reachable but the agent doesn't construct
  the multimodal `image_url` content blocks.

## Scaffolding shipped tonight (2026-04-28)

- `CatalogModel.mmprojUrl` and `CatalogModel.mmprojFilename` optional
  fields on the mobile catalog
  ([`packages/mobile/src/model-catalog.ts`](../packages/mobile/src/model-catalog.ts)).
  Adding them on a future entry will be the trigger for the rest of
  the wiring.

## Roadmap (~7-12 days when picked up)

### Phase A — Validate upstream end-to-end (3-5 days)

1. Rebuild `llama-server` from llama.cpp master with `mtmd` enabled
   (Linux WSL build similar to `reference_opencl_rebuild_adreno`).
2. Identify a tested `mmproj` GGUF for Gemma 4 E4B on HuggingFace
   (probably published by `bartowski` or `unsloth` first).
   Today (2026-04-28) the `unsloth/gemma-4-E4B-it-GGUF` repo only ships
   the text weights — the projector either lives in a sibling repo or
   needs to be regenerated via `convert_hf_to_gguf.py --vision` from
   `google/gemma-4-E4B-it`.
3. Run on PC: `llama-server -m model.gguf --mmproj mmproj.gguf` then
   `curl -X POST /v1/chat/completions` with `image_url` content. Confirm
   output is coherent and timings are reasonable.
4. Push the same setup to Xiaomi 14 Ultra and measure latency. Vision
   encoder is almost certainly NOT Hexagon-accelerated (CLIP/SigLIP
   ops aren't in the Hexagon kernels), so first-image prefill will
   be CPU-bound and slow.

### Phase B — Backend wiring (3-5 days)

1. **Catalog**: populate `mmprojUrl` + `mmprojFilename` on
   `gemma-4-e4b-q4_0` and `gemma-4-e4b` entries.
2. **Auto-download**: extend the model downloader to fetch the mmproj
   alongside the main weights when `mmprojUrl` is present.
3. **Mobile spawn**:
   `LlamaService.spawnServer()` accepts `--mmproj <path>` when the
   active model has one; falls back gracefully when absent (no
   regression on text-only models).
4. **Desktop spawn**: same in `packages/desktop/src-tauri/src/llm.rs`
   `load_llm_model()` (after the existing `--cache-type-v` flag).
5. **Mobile request routing**:
   `LlamaHttpServer.extractContent()` parses `type="image_url"`
   (base64 or file path) and forwards to `/v1/chat/completions` with
   the canonical multimodal payload instead of `/completion`.

### Phase C — Frontend plumbing (1-2 days)

1. Trace the `ImageAttachmentPart` through the agent pipeline — verify
   where it's dropped today and patch the serializer to emit
   `{ type: "image_url", image_url: { url: "data:image/png;base64,…" } }`
   alongside the text part.
2. Confirm the message-render component already shows the image inline
   (it does via the existing attachment renderer; just needs the
   backend to echo it back in the conversation history).

## Risks & gotchas

- **Hexagon vision encoder is unlikely to be supported.** First image
  prompt will fall back to CPU. Plan for a "Loading image…" spinner
  (~2-5 s per image on Snapdragon 8 Gen 3, much worse on lower tiers).
- **Memory budget**: mmproj typically adds 400-800 MB on top of the
  text model. Need to validate that Gemma 4 E4B + mmproj + KV cache
  still fits under 6 GB on Xiaomi 14 Ultra.
- **PR #22093** (regeneration without image) is open. Document the
  workaround until merged.
- **Format drift**: if Google ships an official GGUF mmproj after we
  build against a community one, expect an upgrade pass.

## References

- llama.cpp PRs: #21851 merged, #21874 closed, #21868 not planned, #22093 open.
- HF model card: `litert-community/gemma-4-E4B-it-litert-lm`
- HF community GGUF: `unsloth/gemma-4-E4B-it-GGUF`
- AI Edge Gallery release 1.0.12 (2026-04-24): vision via LiteRT-LM
  `Backend.GPU()` + `vision_accelerator` SegmentedButton in ConfigDialog.
