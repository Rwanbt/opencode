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

  test("caps layers at modelLayers", () => {
    const cfg = deriveConfig(profile({ vramMb: 64 * 1024 }), 1_000, 32)
    expect(cfg.nGpuLayers).toBeLessThanOrEqual(32)
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

  test("KV quant uses f16 only when VRAM >> model", () => {
    expect(deriveConfig(profile({ vramMb: 12 * 1024 }), 3 * 1024).kvCacheType).toBe("f16")
    expect(deriveConfig(profile({ vramMb: 7 * 1024 }), 3 * 1024).kvCacheType).toBe("q8_0")
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
