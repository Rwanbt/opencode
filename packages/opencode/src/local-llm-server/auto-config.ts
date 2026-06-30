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

import os from "node:os"
import { spawnSync } from "node:child_process"

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

// ── Thermal listener (I9) ─────────────────────────────────────────────────
//
// On Android, we periodically poll the Tauri command `get_thermal_state`
// (backed by `PowerManager.getCurrentThermalStatus()` — API 29+). When the
// state changes we invalidate the cached profile so the next `detectProfile`
// call re-derives thread/batch/context sizes under the new thermal envelope.
//
// Desktop keeps `thermalState: "nominal"` until per-OS native hooks land
// (Windows WMI / Linux /sys/class/thermal / macOS IOKit). See I9 backlog.
//
// The polling loop is opt-in and kept in this module so a single consumer
// (the auto-config derivation path) owns the lifecycle.

let thermalPollTimer: ReturnType<typeof setInterval> | undefined
let lastThermal: ThermalState | undefined

function normalizeThermal(raw: unknown): ThermalState {
  if (typeof raw !== "string") return "nominal"
  const v = raw.toLowerCase()
  if (v === "severe" || v === "critical" || v === "emergency" || v === "shutdown") return "critical"
  if (v === "moderate" || v === "serious") return "serious"
  if (v === "light" || v === "fair") return "fair"
  return "nominal"
}

/**
 * Start polling the Android Tauri command every `intervalMs` (default 30s).
 * No-op on non-Android runtimes. Returns a stop() function.
 *
 * `invokeThermal` is injected so the module stays dependency-free (the Tauri
 * global `invoke()` is only available inside the mobile webview, not in the
 * sidecar CLI process).
 */
export function startThermalListener(
  invokeThermal: () => Promise<string>,
  intervalMs = 30_000,
): () => void {
  if (process.platform !== "android" && process.env.OPENCODE_THERMAL_FORCE !== "1") {
    return () => {}
  }
  if (thermalPollTimer) return () => stopThermalListener()

  const tick = async () => {
    try {
      const raw = await invokeThermal()
      const next = normalizeThermal(raw)
      if (next !== lastThermal) {
        lastThermal = next
        // Only mutate cache through the public reset API — keeps invariants
        // centralized should `cached` semantics evolve.
        if (cached) cached.thermalState = next
        resetProfileCache()
      }
    } catch {
      // Swallow: thermal probe is advisory, never critical-path.
    }
  }
  // Prime immediately so first `detectProfile` after startup has fresh data.
  void tick()
  thermalPollTimer = setInterval(tick, intervalMs)
  // Don't hold the event loop alive for this advisory poll.
  if (typeof (thermalPollTimer as any)?.unref === "function") (thermalPollTimer as any).unref()
  return () => stopThermalListener()
}

export function stopThermalListener() {
  if (thermalPollTimer) {
    clearInterval(thermalPollTimer)
    thermalPollTimer = undefined
  }
}

// ── Config derivation ──────────────────────────────────────────────────────

export function deriveConfig(p: DeviceProfile, modelSizeMb: number, modelLayers = 32): LlamaConfig {
  const thermalMult = p.thermalState === "critical" ? 0.5 : p.thermalState === "serious" ? 0.75 : 1

  // GPU layers: fit as many as the VRAM budget allows. 85 % of VRAM is a
  // safety margin for KV cache, activations, and other small allocations.
  const vramBudget = Math.max(0, p.vramMb * 0.85)
  const mbPerLayer = modelSizeMb > 0 ? modelSizeMb / Math.max(1, modelLayers) : 1
  const hasUsableGpu = p.gpuBackend !== "none" && vramBudget > 0

  // GPU acceleration is mandatory by default. Silently falling back to
  // n_gpu_layers=0 yielded a nominally-working server that ran at <5 tok/s,
  // which is worse UX than a loud error telling the user to install a
  // driver / choose a smaller model. Users who really want CPU-only must
  // opt in with OPENCODE_ALLOW_CPU_ONLY=1 (Android emulators, VMs, CI…).
  if (!hasUsableGpu && process.env.OPENCODE_ALLOW_CPU_ONLY !== "1") {
    throw new Error(
      `No usable GPU backend detected (gpuBackend="${p.gpuBackend}", vramMb=${p.vramMb}). ` +
        `Install a GPU driver (CUDA / ROCm / Vulkan / Metal) or set ` +
        `OPENCODE_ALLOW_CPU_ONLY=1 to explicitly allow CPU-only inference.`,
    )
  }
  // +1: llama.cpp counts the output/lm_head layer separately from the
  // transformer block count (GGUF's <arch>.block_count). Capping at
  // modelLayers alone leaves that one extra layer on CPU — a 1-layer
  // partial CPU/GPU split. Verified on an RTX 4070 8GB with a 33-layer
  // hybrid SSM model (Ornith-1.0-9B, block_count=32): requesting exactly
  // 32 landed in a partial-offload zone that either OOM'd or hit a
  // llama.cpp scheduler assertion specific to that architecture, while
  // requesting 33 (true full GPU offload) loaded cleanly at 6285/8187 MiB
  // and ran at 37 tok/s vs the CPU-only fallback's 2.9 tok/s.
  const nGpuLayers = hasUsableGpu
    ? Math.max(0, Math.min(modelLayers + 1, Math.floor(vramBudget / mbPerLayer)))
    : 0

  // Threads: use only the "big" cores on heterogeneous CPUs, cap at 6 to
  // avoid diminishing returns + P-core contention on the WebView.
  const nThreads = Math.max(2, Math.min(6, p.cpuCores.big || 4))

  // Batch size: 128 on low RAM (4 GB), scales to 512 as free RAM grows.
  const ramRatio = Math.min(1, p.freeRamMb / 8192)
  const batchSize = Math.max(64, Math.floor((128 + 384 * ramRatio) * thermalMult))
  const uBatchSize = Math.max(32, batchSize >> 2)

  // KV cache quant: q8_0 quand VRAM serrée, f16 si confortable.
  // turbo3 (TurboQuant, Google ICLR 2026) serait idéal mais exige head_dim ≤ 128 pour la
  // matrice WHT 128×128 — incompatible avec Gemma-4 (head_dim=512) et d'autres modèles.
  // Activable manuellement via OPENCODE_KV_CACHE_TYPE=turbo3 si le modèle est compatible.
  const kvCacheType: "f16" | "q8_0" | "q4_0" =
    p.vramMb > modelSizeMb * 3 ? "f16" : p.vramMb > modelSizeMb * 1.5 ? "q8_0" : "q4_0"

  // Context: scales with total RAM, capped to keep KV cache reasonable.
  const contextSize = p.totalRamMb < 4096 ? 4096 : p.totalRamMb < 8192 ? 8192 : 16384

  return { nGpuLayers, nThreads, batchSize, uBatchSize, kvCacheType, contextSize }
}

// ── GGUF metadata reader ─────────────────────────────────────────────────────
//
// Reads `<arch>.block_count` (the real transformer layer count) so deriveConfig
// stops hardcoding 32. GGUF metadata always precedes tensor data, so reading a
// bounded prefix of the file is enough. Returns null on any parse issue — the
// caller falls back to 32.

import fsGguf from "node:fs"

export function readGgufMeta(
  modelPath: string,
): { architecture: string | null; blockCount: number | null } | null {
  let fd: number | undefined
  try {
    fd = fsGguf.openSync(modelPath, "r")
    const CAP = 16 * 1024 * 1024 // 16 MiB covers metadata for all known models
    const size = Math.min(CAP, fsGguf.fstatSync(fd).size)
    const buf = Buffer.allocUnsafe(size)
    fsGguf.readSync(fd, buf, 0, size, 0)

    if (buf.toString("ascii", 0, 4) !== "GGUF") return null
    let off = 4
    const u32 = () => {
      const v = buf.readUInt32LE(off)
      off += 4
      return v
    }
    const u64 = () => {
      const v = Number(buf.readBigUInt64LE(off))
      off += 8
      return v
    }
    const str = () => {
      const len = u64()
      const s = buf.toString("utf8", off, off + len)
      off += len
      return s
    }
    const scalarSize = (t: number): number => {
      switch (t) {
        case 0:
        case 1:
        case 7:
          return 1
        case 2:
        case 3:
          return 2
        case 4:
        case 5:
        case 6:
          return 4
        case 10:
        case 11:
        case 12:
          return 8
        default:
          throw new Error("unknown gguf scalar type")
      }
    }

    const version = u32()
    if (version < 2 || version > 3) return null
    u64() // tensor_count
    const kvCount = u64()

    let architecture: string | null = null
    let blockCount: number | null = null

    for (let i = 0; i < kvCount; i++) {
      const key = str()
      const vtype = u32()
      if (vtype === 8) {
        const val = str()
        if (key === "general.architecture") architecture = val
      } else if (vtype === 9) {
        const elemT = u32()
        const count = u64()
        if (elemT === 8) for (let j = 0; j < count; j++) str()
        else off += scalarSize(elemT) * count
      } else {
        if (key.endsWith(".block_count")) {
          if (vtype === 4) blockCount = buf.readUInt32LE(off)
          else if (vtype === 5) blockCount = buf.readInt32LE(off)
          else if (vtype === 10) blockCount = Number(buf.readBigUInt64LE(off))
        }
        off += scalarSize(vtype)
      }
      if (architecture && blockCount != null) break
    }
    return { architecture, blockCount }
  } catch {
    return null
  } finally {
    if (fd !== undefined)
      try {
        fsGguf.closeSync(fd)
      } catch {}
  }
}
