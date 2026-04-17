//! Runtime device detection + llama.cpp config derivation.
//!
//! The goal is to pick values for `--n-gpu-layers`, `--threads`, `--batch`, and
//! the KV cache quantization that fit the device actually running the server —
//! the previous buildArgs used `--n-gpu-layers 99` constant, which OOM-killed
//! 4 GB Android devices while under-using flagship VRAM in subtle ways.
//!
//! Detection is best-effort. On desktop we probe sync APIs (os.cpus,
//! os.totalmem) and fire-and-forget GPU shell probes the first time the
//! profile is needed; on Android the mobile Tauri sidecar exposes
//! `get_device_profile()` which reads /proc/meminfo + /sys cpufreq.
//!
//! Keep this file simple and avoid external deps — it runs in the opencode
//! sidecar hot path.

import os from "os"
import { spawnSync } from "child_process"

export type GpuBackend = "cuda" | "rocm" | "vulkan" | "opencl" | "metal" | "none"
export type ThermalState = "nominal" | "fair" | "serious" | "critical"

export interface DeviceProfile {
  totalRamMb: number
  freeRamMb: number
  cpuCores: { big: number; little: number }
  gpuBackend: GpuBackend
  vramMb: number
  thermalState: ThermalState
}

export interface LlamaConfig {
  nGpuLayers: number
  nThreads: number
  batchSize: number
  uBatchSize: number
  kvCacheType: "f16" | "q8_0" | "q4_0"
  contextSize: number
}

// ── Detection ──────────────────────────────────────────────────────────────

let cached: DeviceProfile | undefined

function probe(cmd: string, args: string[], timeoutMs = 1500): { ok: boolean; stdout: string } {
  try {
    const r = spawnSync(cmd, args, { timeout: timeoutMs, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    return { ok: r.status === 0, stdout: r.stdout ?? "" }
  } catch {
    return { ok: false, stdout: "" }
  }
}

function detectCpuCores(): { big: number; little: number } {
  const cpus = os.cpus() ?? []
  if (cpus.length === 0) return { big: 2, little: 0 }
  // Desktop: all cores are symmetric; treat them all as "big".
  if (process.platform !== "android" && process.platform !== "linux") {
    return { big: cpus.length, little: 0 }
  }
  // Linux/Android: read cpufreq maxes to split big.LITTLE. os.cpus() already
  // reports the `speed` field which on Linux often reflects max frequency.
  const speeds = cpus.map((c) => c.speed || 0).filter((s) => s > 0)
  if (speeds.length === 0) return { big: cpus.length, little: 0 }
  const maxSpeed = Math.max(...speeds)
  // Cores within 80% of the max are "big"; below are "little".
  const big = speeds.filter((s) => s >= maxSpeed * 0.8).length
  const little = speeds.length - big
  return { big: Math.max(1, big), little }
}

function detectGpuBackend(): { backend: GpuBackend; vramMb: number } {
  const platform = process.platform
  if (platform === "darwin") {
    // Apple Silicon: unified memory, use Metal.
    return { backend: "metal", vramMb: 0 }
  }
  // NVIDIA first.
  const nv = probe("nvidia-smi", ["--query-gpu=memory.total", "--format=csv,noheader,nounits"])
  if (nv.ok) {
    const mb = parseInt(nv.stdout.split("\n")[0]?.trim() ?? "0", 10)
    if (mb > 0) return { backend: "cuda", vramMb: mb }
  }
  // AMD ROCm.
  const rocm = probe("rocminfo", [])
  if (rocm.ok) return { backend: "rocm", vramMb: 0 }
  // Vulkan fallback (any vendor).
  const vk = probe("vulkaninfo", ["--summary"])
  if (vk.ok) return { backend: "vulkan", vramMb: 0 }
  return { backend: "none", vramMb: 0 }
}

export function detectProfile(): DeviceProfile {
  if (cached) return cached
  const totalRamMb = Math.floor(os.totalmem() / (1024 * 1024))
  const freeRamMb = Math.floor(os.freemem() / (1024 * 1024))
  const cpuCores = detectCpuCores()
  const { backend, vramMb } = detectGpuBackend()
  // Metal / unified-memory devices: model layers live alongside the system
  // pool, so budget them against 60 % of total RAM rather than a 0 vramMb.
  const effectiveVramMb = backend === "metal" ? Math.floor(totalRamMb * 0.6) : vramMb
  cached = {
    totalRamMb,
    freeRamMb,
    cpuCores,
    gpuBackend: backend,
    vramMb: effectiveVramMb,
    thermalState: "nominal",
  }
  return cached
}

/** Drop cached profile — used by tests and by thermal-state change listeners
 *  on mobile that want a fresh config after throttling kicked in. */
export function resetProfileCache() {
  cached = undefined
}

// ── Config derivation ──────────────────────────────────────────────────────

export function deriveConfig(p: DeviceProfile, modelSizeMb: number, modelLayers = 32): LlamaConfig {
  const thermalMult = p.thermalState === "critical" ? 0.5 : p.thermalState === "serious" ? 0.75 : 1

  // GPU layers: fit as many as the VRAM budget allows. 85 % of VRAM is a
  // safety margin for KV cache, activations, and other small allocations.
  const vramBudget = Math.max(0, p.vramMb * 0.85)
  const mbPerLayer = modelSizeMb > 0 ? modelSizeMb / Math.max(1, modelLayers) : 1
  const nGpuLayers =
    p.gpuBackend === "none" || vramBudget <= 0
      ? 0
      : Math.max(0, Math.min(modelLayers, Math.floor(vramBudget / mbPerLayer)))

  // Threads: use only the "big" cores on heterogeneous CPUs, cap at 6 to
  // avoid diminishing returns + P-core contention on the WebView.
  const nThreads = Math.max(2, Math.min(6, p.cpuCores.big || 4))

  // Batch size: 128 on low RAM (4 GB), scales to 512 as free RAM grows.
  const ramRatio = Math.min(1, p.freeRamMb / 8192)
  const batchSize = Math.max(64, Math.floor((128 + 384 * ramRatio) * thermalMult))
  const uBatchSize = Math.max(32, batchSize >> 2)

  // KV cache quant: finer quant when we have VRAM headroom, q4_0 otherwise.
  const kvCacheType =
    p.vramMb > modelSizeMb * 3 ? "f16" : p.vramMb > modelSizeMb * 2 ? "q8_0" : "q4_0"

  // Context: scales with total RAM, capped to keep KV cache reasonable.
  const contextSize = p.totalRamMb < 4096 ? 4096 : p.totalRamMb < 8192 ? 8192 : 16384

  return { nGpuLayers, nThreads, batchSize, uBatchSize, kvCacheType, contextSize }
}
