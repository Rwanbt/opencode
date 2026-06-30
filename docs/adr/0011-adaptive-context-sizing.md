# ADR-0011: Adaptive Context Window Sizing from Real Free VRAM + GGUF Metadata

**Status**: Accepted  
**Date**: 2026-06-30  
**Deciders**: @Rwanbt  

---

## Context

The local LLM context window size (`--ctx-size` passed to llama-server) was previously determined by a static RAM-tier table:

```typescript
const contextSize = totalRamMb < 4096 ? 4096 : totalRamMb < 8192 ? 8192 : 16384
```

This produced a ceiling of **16384 tokens** regardless of the GPU, VRAM budget, model size, or model architecture. The consequence was discovered in production: the system prompt for a typical OpenCode session (CLAUDE.md + AGENTS.md instructions, ~14000 tokens) exceeded the usable context budget after the compaction output reserve was subtracted (`context − maxOutputTokens(model) ≈ 10923`), causing `isOverflow()` to return `true` unconditionally on every turn. Since compaction prunes conversation history (not the system prompt), no amount of compaction could resolve the overflow → **infinite compaction loop**.

Additionally, the ceiling of 16384 was empirically shown to be arbitrarily conservative: an RTX 4070 8GB can comfortably support context sizes up to ~65000 tokens for Ornith-1.0-9B with full GPU offload (7445 MiB used, 743 MiB free at ctx=65536), and the formula yields ~49000 tokens as a safe, VRAM-headroom-aware ceiling.

## Decision

Replace the static RAM-tier table with **`estimateAdaptiveContext()`**, which computes the maximum safe context window dynamically from:

1. **Real free VRAM** measured at spawn time (`nvidia-smi --query-gpu=memory.free`, fresh, not cached total×0.85)
2. **Actual KV-cache cost per token** derived from the model's GGUF metadata:
   - `attentionLayerCount`: counted by parsing GGUF tensor names for `blk.N.attn_k.weight` presence (architecture-agnostic, works for hybrid SSM models where `block_count` overestimates KV layers)
   - `headCountKv`: from `<arch>.attention.head_count_kv`
   - `headDim`: from `<arch>.attention.key_length`

```
maxCtx = floor((freeVramMb − modelSizeMb − 700 − 512) × 1024² / bytesPerTokenKV)
bytesPerTokenKV = 2 × attentionLayerCount × headCountKv × headDim × kvBytesPerElement
```

Precision of the formula validated empirically: predicts 408.00 MiB of KV cache at ctx=24576, identical to llama-server's own reported `CUDA0 KV buffer size = 408.00 MiB` for Ornith-1.0-9B with q8_0 cache type.

Falls back to the old RAM-tier table when GGUF attention metadata cannot be read (CPU-only inference, parse failure, or non-attention architecture).

## Rejected Alternatives

**A) Simple increase of the static ceiling (e.g. 32768)**  
Rejected because it remains hardcoded and arbitrary. Different models have radically different KV costs per token (e.g. an 8B dense model with 32 attention layers vs. a hybrid SSM with 8 real attention layers). A single static number cannot be right for both. The user's explicit requirement was "nothing hardcoded, everything adapts to hardware, model weight, and available resources."

**B) Anti-loop guard only (cap compaction retries at N)**  
Rejected because it treats the symptom, not the cause. The underlying issue — a context ceiling too small for the actual system prompt — would persist. The model would still fail to have a useful conversation window.

**C) Exclude CLAUDE.md/AGENTS.md instructions for local models**  
Rejected because these instructions encode the user's engineering methodology and workflow rules. A local model without them produces lower-quality, less contextually-aware responses.

## Consequences

- Context window for Ornith-1.0-9B on RTX 4070 8GB: 16384 → ~49000 tokens (dynamically computed)
- Infinite compaction loop: resolved (system prompt now fits comfortably in usable budget)
- For dense transformers (all attention layers), the formula is exact
- For hybrid SSM architectures, the formula requires the tensor-info section of the GGUF to count real attention layers accurately — falls back to `block_count` (conservative) if tensor parsing fails
- **Known gap**: the adaptive formula is implemented in the TS sidecar path only. The Rust desktop launch path (`llm.rs::load_llm_model`) still falls back to hardcoded 16384 when no `llm_config.json` is present (Phase 2 item)

## Implementation

- `estimateAdaptiveContext()` in `packages/opencode/src/local-llm-server/auto-config.ts`
- Extended `readGgufMeta()` in the same file: now reads tensor-info section to count `blk.N.attn_k.weight` occurrences
- Tests: `packages/opencode/test/local-llm-server/auto-config.test.ts` (13 tests, including exact KV prediction)
- See `docs/LOCAL-LLM-ADAPTIVE-CONTEXT.md` for the full technical reference
