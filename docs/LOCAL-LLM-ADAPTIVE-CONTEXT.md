# Local LLM — Adaptive Context, VRAM & Compaction

> Living reference for the chain that links available hardware resources (GPU, VRAM) to the loaded local model (weights, GGUF architecture) and to agent behavior (context window size, compaction trigger). Updated after the 2026-06-30 session that fixed two bugs in this chain: the Ornith partial-GPU-offload crash and the infinite compaction loop.

---

## Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                    RESOURCE → AGENT CHAIN                        │
│                                                                  │
│  GPU/VRAM        GGUF           deriveConfig()     overflow.ts   │
│  (free)      (metadata)   →   (context, ngl)  →  isOverflow()   │
│     │             │                  │                │          │
│  nvidia-smi   block_count      ctxSize, nGpuLayers   │          │
│  memory.free  attn layers      kvCacheType      compaction.ts   │
│               headDim/KvN      nThreads, batch                  │
└──────────────────────────────────────────────────────────────────┘
```

**Design principle**: nothing hardcoded per model or per machine. Every parameter must adapt dynamically to available resources and the actual GGUF metadata of the loaded model.

---

## 1. Device Profile (`detectProfile`, `auto-config.ts`)

```typescript
export interface DeviceProfile {
  totalRamMb: number       // total system RAM
  freeRamMb: number        // free system RAM
  cpuCores: { big: number; little: number }
  gpuBackend: "cuda" | "rocm" | "vulkan" | "opencl" | "metal" | "none"
  vramMb: number           // TOTAL VRAM capacity (≠ free!)
  thermalState: "nominal" | "fair" | "serious" | "critical"
}
```

**Key pitfall**: `vramMb` = total capacity, not available. For "will it fit?" decisions always use `probeFreeVramMb()` (fresh `nvidia-smi --query-gpu=memory.free`, NOT cached) at spawn time, not `DeviceProfile.vramMb * 0.85` which can be far from reality when other processes hold GPU memory (browser, Windows compositor).

`detectProfile()` is cached once per process. Total RAM/VRAM don't change during a session, but free VRAM changes at every spawn → `probeFreeVramMb()` must be called separately and fresh.

---

## 2. GGUF Metadata Reader (`readGgufMeta`)

**Files**: `packages/opencode/src/local-llm-server/auto-config.ts` (TS) · `packages/desktop/src-tauri/src/llm.rs` (Rust mirror)

Reads two GGUF sections without loading weights:

### 2.1 KV Metadata Section
```
GGUF format: magic(4) + version(4) + tensor_count(8) + kv_count(8) + [KV entries]
```
Fields extracted:
- `general.architecture` — llama.cpp architecture ID (e.g. `"qwen35"`, `"gemma4"`, `"llama"`)
- `<arch>.block_count` — total transformer block count (includes non-attention blocks)
- `<arch>.attention.head_count_kv` — KV heads (groups under GQA/MQA)
- `<arch>.attention.key_length` / `value_length` — per-head dimension (head_dim)
- `<arch>.embedding_length`, `<arch>.attention.head_count` — fallback for head_dim

### 2.2 Tensor Info Section
```
For each tensor: name(string) + n_dims(u32) + dims[n_dims](u64) + type(u32) + offset(u64)
```
Field extracted:
- `attentionLayerCount` — distinct count of N such that `blk.N.attn_k.weight` exists

**Why tensor_info instead of block_count?** For hybrid SSM architectures (Mamba, Gated-Delta-Net), `block_count` counts ALL blocks, including those without a standard KV cache (constant-size O(1) SSM state). Measured on Ornith-1.0-9B (arch `qwen35`):
- `block_count` = 32 (all blocks)
- `attentionLayerCount` = 8 (only 8 have `attn_k.weight`)
- Using 32 overestimates KV cost ×4 → predicts a max context 4× too small

The tensor-name counting is **architecture-agnostic**: works without prior knowledge of the model type, for any hybrid or dense transformer.

### 2.3 Verifying Architecture Strings

Architecture IDs are defined in the vendored `llama.cpp/src/llama-arch.cpp`. Always check there before adding a model to an allowlist:

```bash
grep "LLM_ARCH_.*->" llama.cpp/src/llama-arch.cpp
```

Verified examples: `gemma4` (NOT `gemma3`), `gemma3n`, `qwen35`, `llama`.

---

## 3. Adaptive Context Formula (`estimateAdaptiveContext`)

**File**: `packages/opencode/src/local-llm-server/auto-config.ts`

### 3.1 KV Cache Cost Per Token

```
bytesPerTokenKV = 2 (K+V) × attentionLayerCount × headCountKv × headDim × kvBytesPerElement
```

`kvBytesPerElement` by cache type:
- `f16` → 2.0 bytes
- `q8_0` → 1.0625 bytes (32 values × 1 byte + 2 bytes scale per block)
- `q4_0` → 0.5625 bytes (32 values × 4 bits + 2 bytes scale per block)

**Empirical validation on Ornith-1.0-9B (q8_0, RTX 4070 8GB)**:
- attentionLayerCount=8, headCountKv=4, headDim=256 → bytesPerToken=17408
- Predicted at ctx=24576: `17408 × 24576 / 1024² = 408.00 MiB` **✓ exact**
  (llama-server log: `CUDA0 KV buffer size = 408.00 MiB`)

### 3.2 Reserved Margins

```
availableForKvMb = freeVramMb − modelSizeMb − COMPUTE_BUFFER_MB − SAFETY_MARGIN_MB
maxCtx = floor(availableForKvMb × 1024² / bytesPerTokenKV)
```

| Constant | Value | Rationale |
|---|---|---|
| `COMPUTE_BUFFER_MB` | 700 | Observed range 82–493 MiB depending on batch size |
| `SAFETY_MARGIN_MB` | 512 | Matches the `-fitt` convention used elsewhere |

### 3.3 Fallback

If GGUF metadata is missing (CPU-only, parse failure, non-attention architecture), returns the legacy RAM-tier table (`totalRamMb < 4096 ? 4096 : totalRamMb < 8192 ? 8192 : 16384`). Conservative but never broken.

### 3.4 Calibration Data (RTX 4070 8GB, Ornith Q4\_K\_M, ngl=33, q8\_0)

| ctx | VRAM used | Free margin |
|---|---|---|
| 16384 (old ceiling) | 6285 MiB | ~1900 MiB |
| 24576 | 6784 MiB | ~1400 MiB |
| 32768 | 6920 MiB | ~1268 MiB |
| 65536 | 7445 MiB | ~743 MiB |
| 98304 (practical limit) | 7747 MiB | ~440 MiB |

With ~7282 MiB free at idle, the formula yields ~49000 tokens (validated in production: ctxSize=49212, live n_ctx=49408).

---

## 4. No-Partial-Offload Guard (`NO_PARTIAL_OFFLOAD_ARCHITECTURES`)

**Files**: `auto-config.ts` (TS) + `llm.rs` (Rust) — **both lists must stay in sync**.

Some architectures crash (CUDA scheduler assertion or CUDA init error) under **partial** GPU offload, but load cleanly at full GPU offload OR full CPU:

```
qwen35 (Ornith): 22–32/33 layers → crash; 0/33 (CPU) or 33/33 (full GPU) → OK
```

For these architectures, `deriveConfig` makes a **binary decision** (never an intermediate value):
1. Probe real free VRAM (not total×0.85)
2. Compute full-offload footprint: `mbPerLayer × (blockCount+1) + 768`
3. If it fits → `nGpuLayers = blockCount + 1`
4. If not → `nGpuLayers = 0` (CPU-only)
5. **Never a value between 0 and blockCount+1**

**Why +1?** llama.cpp counts the output/lm_head layer separately from the GGUF `block_count`. Requesting exactly `block_count` leaves that layer on CPU → partial split → crash. Requesting `block_count + 1` = clean full offload.

**To add an architecture**: verify the exact ID in `llama.cpp/src/llama-arch.cpp`, then add to **both** constants (TS + Rust).

---

## 5. Compaction Trigger (`isOverflow`, `overflow.ts`)

**File**: `packages/opencode/src/session/overflow.ts`

```typescript
function isOverflow({ cfg, tokens, model }) {
  const context = model.limit.context        // mutated by llm.ts:349 with real server n_ctx
  const reserved = cfg.compaction?.reserved ?? Math.min(20_000, maxOutputTokens(model))
  const usable = model.limit.input
    ? model.limit.input - reserved
    : context - maxOutputTokens(model)
  return count >= usable
}
```

**Critical invariant**: `maxOutputTokens(model)` uses `model.limit.output` (statically declared in `dialog-local-llm.tsx` at model registration time, via `registerLocalModels()`). This is NOT the same as `localLLMLimits.maxTokens` computed dynamically (`nCtx × 0.4`). If context is too small, `context − maxOutputTokens(model)` goes negative → `isOverflow()` returns `true` unconditionally → **infinite loop**.

**Infinite loop condition**: `systemTokens > context − maxOutputTokens(model)`. If the system prompt alone (loaded fresh every turn via `instruction.system()`) exceeds the usable budget, no amount of compaction can fix it — compaction prunes conversation history, never the system prompt.

**Live n_ctx mutation**: when a prompt is sent via the TS sidecar chat path, `llm.ts:341-349` calls `getLocalLLMAdaptiveLimits` → reads real `n_ctx` from `/props` → mutates `model.limit.context`. This mutated value is then used by `isOverflow()` and `compaction.ts` for all truncation decisions.

---

## 6. The Three Spawn Paths

OpenCode has two distinct paths that load llama-server:

### 6.1 TS Sidecar (chat hot-path)
`llm.ts:334` → `LocalLLMServer.ensureRunning()` → `buildArgs()` → `spawnOnce()`

- Computes fresh `deriveConfig()` with GGUF metadata and real free VRAM
- Writes result to `{tmpdir}/opencode-llm-14097/llm_config.json`
- Contains all adaptive fixes (ctx, ngl, no-partial-offload guard)
- **Skips respawn** if `isRunning()` — if already healthy (loaded by Rust), does not recompute

### 6.2 Rust (auto-start on launch / "Load" button)
`use-auto-start-llm.ts` → `invoke("load_llm_model")` → `llm.rs::load_llm_model()`

- Reads `llm_config.json` if present, else falls back to hardcoded defaults
- `context_size`: env > file > `16384` (hardcoded, NOT the TS adaptive formula — known gap)
- `n_gpu_layers`: env > file > `NO_PARTIAL_OFFLOAD_ARCHITECTURES` logic (added 2026-06-30)

### 6.3 Practical consequence

If the server is first loaded via the Rust path (auto-start on launch), it starts with its own `context_size` (potentially 16384 if config file is absent). When the TS path subsequently skips the respawn (server already healthy), the real n_ctx remains the Rust value. The adaptive formula only applies to the **first TS spawn** (when the server is not yet running).

**Operational workaround**: deleting `{tmpdir}/opencode-llm-14097/llm_config.json` forces the Rust path to use its defaults, and the next TS spawn (after the model is unloaded or the idle timer fires) starts fresh with the adaptive formula.

---

## 7. Derived Parameters in `deriveConfig`

| Parameter | Source | Logic |
|---|---|---|
| `nGpuLayers` | VRAM budget / GGUF block_count | `floor(vramBudget/mbPerLayer)`, or binary for fragile archs |
| `nThreads` | cpuCores.big | `min(6, max(2, big_cores))` |
| `batchSize` | freeRamMb | `128 + 384 × ramRatio`, thermalMult |
| `uBatchSize` | batchSize | `batchSize >> 2` (÷4) |
| `kvCacheType` | vramMb vs modelSizeMb | f16 if vram>3×model; q8_0 if vram>1.5×model; q4_0 otherwise |
| `contextSize` | freeVramMb + GGUF KV cost | `estimateAdaptiveContext()` if metadata available, else RAM-tier fallback |

The result is written to `llm_config.json` by the TS path and read by the Rust path on the next spawn.

---

## 8. Open Items

| Item | File | Priority |
|---|---|---|
| Apply `estimateAdaptiveContext` in Rust cold-launch path | `llm.rs:801` | P1 (Phase 2) |
| Align `model.limit.output` with new adaptive ctx (UI side) | `dialog-local-llm.tsx` | P2 |
| OOM retry hierarchy (cap ctx before reducing layers, never partial split) | `index.ts::spawnAndWait` | P2 |
| Single authoritative TS spawner (Rust `load_llm_model` → HTTP client of TS) | `llm.rs`, `index.ts` | P2 (design required) |
| Targeted kill by PID instead of `/IM llama-server.exe` (kills all instances) | `llm.rs:586`, `lib.rs:492` | P2 |

---

## 9. Pre-Change Checklist

Before modifying `deriveConfig`, `estimateAdaptiveContext`, `overflow.ts`, or `llm_config.json` handling:

- [ ] `bun test test/local-llm-server/` passes (13 tests, including 408.00 MiB exact numerical validation)
- [ ] `NO_PARTIAL_OFFLOAD_ARCHITECTURES` is in sync between TS and Rust
- [ ] Any new architecture string is verified against `llama.cpp/src/llama-arch.cpp` in the vendored repo
- [ ] Stale `llm_config.json` is deleted before a clean spawn test
- [ ] Both chat path (TS sidecar) and dialog path (Rust) are tested separately if the change touches both
