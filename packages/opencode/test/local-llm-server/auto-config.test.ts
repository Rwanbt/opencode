import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { deriveConfig, type DeviceProfile } from "../../src/local-llm-server/auto-config"

let prevAllowCpu: string | undefined
beforeAll(() => {
  prevAllowCpu = process.env.OPENCODE_ALLOW_CPU_ONLY
  process.env.OPENCODE_ALLOW_CPU_ONLY = "1"
})
afterAll(() => {
  if (prevAllowCpu === undefined) delete process.env.OPENCODE_ALLOW_CPU_ONLY
  else process.env.OPENCODE_ALLOW_CPU_ONLY = prevAllowCpu
})

function profile(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  return {
    totalRamMb: 16 * 1024,
    freeRamMb: 12 * 1024,
    cpuCores: { big: 8, little: 0 },
    gpuBackend: "cuda",
    vramMb: 16 * 1024,
    thermalState: "nominal",
    ...overrides,
  }
}

describe("deriveConfig", () => {
  test("offloads more layers on larger VRAM", () => {
    const small = deriveConfig(profile({ vramMb: 4 * 1024 }), 4 * 1024, 32)
    const big = deriveConfig(profile({ vramMb: 24 * 1024 }), 4 * 1024, 32)
    expect(big.nGpuLayers).toBeGreaterThanOrEqual(small.nGpuLayers)
  })

  test("caps layers at modelLayers + 1 (output layer)", () => {
    // +1 accounts for llama.cpp's output/lm_head layer, counted separately
    // from the GGUF block_count — see auto-config.ts comment on nGpuLayers.
    const cfg = deriveConfig(profile({ vramMb: 64 * 1024 }), 1_000, 32)
    expect(cfg.nGpuLayers).toBeLessThanOrEqual(33)
  })

  test("respects real block_count instead of hardcoded 32", () => {
    // 28-layer model (Gemma/Qwen-small): cap at 29, not 33.
    const small = deriveConfig(profile({ vramMb: 64 * 1024 }), 1_000, 28)
    expect(small.nGpuLayers).toBeLessThanOrEqual(29)
    // 36-layer model: must allow >33 (would be wrongly capped if 32 hardcoded).
    const big = deriveConfig(profile({ vramMb: 64 * 1024 }), 1_000, 36)
    expect(big.nGpuLayers).toBeLessThanOrEqual(37)
    expect(big.nGpuLayers).toBeGreaterThan(33)
  })

  test("never returns a partial offload for NO_PARTIAL_OFFLOAD_ARCHITECTURES", () => {
    // Plenty of free VRAM -> full offload (modelLayers + 1), not a floor() partial.
    const ample = deriveConfig(profile({ vramMb: 8 * 1024 }), 5368, 32, "qwen35", 7000)
    expect(ample.nGpuLayers).toBe(33)

    // Free VRAM too tight for full offload -> CPU only (0), never a partial split
    // (the documented crash zone for this architecture's hybrid SSM scheduler).
    const tight = deriveConfig(profile({ vramMb: 8 * 1024 }), 5368, 32, "qwen35", 2000)
    expect(tight.nGpuLayers).toBe(0)

    // Other architectures are unaffected — still use the floor()-based partial formula.
    const other = deriveConfig(profile({ vramMb: 3 * 1024 }), 5368, 32, "llama", 2000)
    expect(other.nGpuLayers).toBeGreaterThan(0)
    expect(other.nGpuLayers).toBeLessThan(33)
  })

  test("adaptive contextSize uses real free VRAM + KV cost, not a flat RAM tier", () => {
    // Real GGUF metadata read from ornith-1.0-9b-Q4_K_M.gguf this session via
    // readGgufMeta(): hybrid SSM model, 8 attention blocks out of 32 total.
    const ornithMeta = {
      attentionLayerCount: 8,
      blockCount: 32,
      attentionHeadCountKv: 4,
      attentionHeadCount: 16,
      attentionKeyLength: 256,
      embeddingLength: 4096,
    }
    // Precision check: at ctx=24576 the formula must match llama-server's own
    // reported "CUDA0 KV buffer size = 408.00 MiB" exactly (measured this
    // session with --cache-type-k/v q8_0).
    const bytesPerTokenKv = 2 * ornithMeta.attentionLayerCount * ornithMeta.attentionHeadCountKv * ornithMeta.attentionKeyLength * 1.0625
    expect((bytesPerTokenKv * 24576) / 1024 / 1024).toBeCloseTo(408.0, 1)

    // Idle free VRAM measured this session on an RTX 4070 8GB.
    const cfg = deriveConfig(profile({ vramMb: 8 * 1024 }), 5368, 32, "qwen35", 7282, ornithMeta)
    // Must escape the old hardcoded 16384 ceiling — that's the whole point of
    // this fix (it was structurally too small to fit a real system prompt
    // alongside Ornith's instructions, causing an infinite compaction loop).
    expect(cfg.contextSize).toBeGreaterThan(16384)
    // Must stay below the empirically-risky zone (98304 left only ~200 MiB
    // free, too tight for real-world use alongside other GPU consumers).
    expect(cfg.contextSize).toBeLessThan(98304)
  })

  test("adaptive contextSize falls back to the RAM tier without GGUF attention metadata", () => {
    // Unknown/unreadable model (ggufMeta null) — preserve the old behavior
    // rather than guessing.
    const cfg = deriveConfig(profile({ vramMb: 8 * 1024, totalRamMb: 16 * 1024 }), 5368, 32, null, 7282, null)
    expect(cfg.contextSize).toBe(16384)
  })

  test("returns 0 layers on CPU-only profile", () => {
    const cfg = deriveConfig(profile({ gpuBackend: "none", vramMb: 0 }), 4 * 1024, 32)
    expect(cfg.nGpuLayers).toBe(0)
  })

  test("threads capped between 2 and 6", () => {
    expect(deriveConfig(profile({ cpuCores: { big: 1, little: 0 } }), 1024).nThreads).toBe(2)
    expect(deriveConfig(profile({ cpuCores: { big: 16, little: 0 } }), 1024).nThreads).toBe(6)
  })

  test("batch size scales with free RAM monotonically", () => {
    const low = deriveConfig(profile({ freeRamMb: 1024 }), 1024)
    const high = deriveConfig(profile({ freeRamMb: 16 * 1024 }), 1024)
    expect(high.batchSize).toBeGreaterThanOrEqual(low.batchSize)
    expect(low.batchSize).toBeGreaterThanOrEqual(64)
  })

  test("thermal critical halves batch size vs nominal", () => {
    const nominal = deriveConfig(profile(), 1024)
    const critical = deriveConfig(profile({ thermalState: "critical" }), 1024)
    expect(critical.batchSize).toBeLessThan(nominal.batchSize)
  })

  test("KV quant adapts to VRAM headroom (f16 / q8_0 / q4_0)", () => {
    // 12GB VRAM, 3GB model → 12 > 3×3=9 → f16
    expect(deriveConfig(profile({ vramMb: 12 * 1024 }), 3 * 1024).kvCacheType).toBe("f16")
    // 7GB VRAM, 3GB model → 7 > 1.5×3=4.5 → q8_0
    expect(deriveConfig(profile({ vramMb: 7 * 1024 }), 3 * 1024).kvCacheType).toBe("q8_0")
    // 3GB VRAM, 3GB model → 3 <= 1.5×3=4.5 → q4_0
    expect(deriveConfig(profile({ vramMb: 3 * 1024 }), 3 * 1024).kvCacheType).toBe("q4_0")
  })

  test("context size scales with total RAM", () => {
    expect(deriveConfig(profile({ totalRamMb: 2048 }), 1024).contextSize).toBe(4096)
    expect(deriveConfig(profile({ totalRamMb: 6 * 1024 }), 1024).contextSize).toBe(8192)
    expect(deriveConfig(profile({ totalRamMb: 32 * 1024 }), 1024).contextSize).toBe(16384)
  })

  test("4 GB Android profile yields CPU-only config that fits", () => {
    // Android 4 GB devices typically report ~3.6-3.8 GB usable total RAM
    // (the rest is reserved by the kernel/baseband/GPU heap).
    const p = profile({
      totalRamMb: 3800,
      freeRamMb: 1500,
      cpuCores: { big: 2, little: 6 },
      gpuBackend: "none",
      vramMb: 0,
    })
    const cfg = deriveConfig(p, 500, 32)
    expect(cfg.nGpuLayers).toBe(0)
    expect(cfg.nThreads).toBe(2)
    expect(cfg.contextSize).toBe(4096)
  })
})
