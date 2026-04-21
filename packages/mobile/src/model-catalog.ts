export interface CatalogModel {
  id: string
  name: string
  description: string
  size: string
  sizeBytes: number
  url: string
  filename: string
  /** Kept for backward compatibility — the UI now derives "Recommended"
   * dynamically from the runtime device profile (see `isRecommendedFor`). */
  recommended?: boolean
  /** Approximate RAM (GB) below which the model will OOM or page-thrash.
   * Rough rule: model file size × 1.2 + 1 GB system overhead. */
  minRamGB: number
  /** Device tier this model targets. Used to highlight "Recommended for
   * this device" and "Heavy for this device" in the UI:
   *   - "eco":       <6 cores big OR <6 GB RAM (e.g. Mi 10 Pro sm8250 CPU-only)
   *   - "standard":  6-8 GB RAM, mid-range SoC
   *   - "flagship":  ≥8 GB RAM + 2023+ SoC (SD 8 Gen 3, Tensor G4, A17 Pro) */
  deviceClass: "eco" | "standard" | "flagship"
}

export interface DeviceProfile {
  ramGB: number
  cores: number
  tier: "eco" | "standard" | "flagship"
}

/** Detect the device's approximate capabilities from the web platform APIs.
 * `navigator.deviceMemory` is capped at 8 by Chromium for fingerprinting
 * reasons — treat 8 as a lower bound, not an exact measurement. */
export function detectDeviceProfile(): DeviceProfile {
  const ramGB = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4
  const cores = navigator.hardwareConcurrency ?? 4
  let tier: DeviceProfile["tier"] = "eco"
  if (ramGB >= 8 && cores >= 8) tier = "flagship"
  else if (ramGB >= 6 && cores >= 6) tier = "standard"
  return { ramGB, cores, tier }
}

/** True if the model fits comfortably on the given device. */
export function fitsOnDevice(model: CatalogModel, profile: DeviceProfile): boolean {
  return model.minRamGB <= profile.ramGB
}

/** True if the model is the best-fit "eco" pick given the device tier.
 * Used for the "Recommended for this device" green badge. */
export function isRecommendedFor(model: CatalogModel, profile: DeviceProfile): boolean {
  if (!fitsOnDevice(model, profile)) return false
  if (profile.tier === "flagship") return model.deviceClass === "flagship"
  if (profile.tier === "standard") return model.deviceClass === "standard"
  return model.deviceClass === "eco"
}

export const MODEL_CATALOG: CatalogModel[] = [
  {
    id: "gemma-3-4b",
    name: "Gemma 3 4B",
    description: "Google's previous-gen small model — multilingual, great quality",
    size: "2.5 GB",
    sizeBytes: 2_500_000_000,
    url: "https://huggingface.co/bartowski/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_K_M.gguf",
    filename: "gemma-3-4b-it-Q4_K_M.gguf",
    minRamGB: 6,
    deviceClass: "standard",
  },
  {
    id: "qwen2.5-coder-7b",
    name: "Qwen 2.5 Coder 7B",
    description: "Best coding model at this size",
    size: "4.5 GB",
    sizeBytes: 4_500_000_000,
    url: "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf",
    filename: "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
    minRamGB: 8,
    deviceClass: "flagship",
  },
  {
    id: "phi-4-mini",
    name: "Phi-4 Mini 3.8B",
    description: "Microsoft — strong reasoning and STEM",
    size: "2.3 GB",
    sizeBytes: 2_300_000_000,
    url: "https://huggingface.co/bartowski/phi-4-mini-instruct-GGUF/resolve/main/phi-4-mini-instruct-Q4_K_M.gguf",
    filename: "phi-4-mini-instruct-Q4_K_M.gguf",
    minRamGB: 6,
    deviceClass: "standard",
  },
  {
    id: "llama-3.2-3b",
    name: "Llama 3.2 3B",
    description: "Meta's on-device optimized model",
    size: "1.8 GB",
    sizeBytes: 1_800_000_000,
    url: "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    filename: "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    minRamGB: 4,
    deviceClass: "standard",
  },
  {
    id: "gemma-3-1b",
    name: "Gemma 3 1B",
    description: "Ultra-light for quick responses",
    size: "0.7 GB",
    sizeBytes: 700_000_000,
    url: "https://huggingface.co/bartowski/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf",
    filename: "gemma-3-1b-it-Q4_K_M.gguf",
    minRamGB: 2,
    deviceClass: "eco",
  },
  {
    id: "gemma-3-4b",
    name: "Gemma 3 4B",
    description: "Google's coding-capable instruct model — recommended for flagship phones",
    size: "2.5 GB",
    sizeBytes: 2_500_000_000,
    url: "https://huggingface.co/unsloth/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_K_M.gguf",
    filename: "gemma-3-4b-it-Q4_K_M.gguf",
    minRamGB: 6,
    deviceClass: "flagship",
  },
  {
    id: "qwen3-4b",
    name: "Qwen3 4B",
    description: "Alibaba's latest small model — strong reasoning and multilingual",
    size: "2.5 GB",
    sizeBytes: 2_500_000_000,
    url: "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf",
    filename: "Qwen3-4B-Q4_K_M.gguf",
    minRamGB: 6,
    deviceClass: "standard",
  },
  {
    id: "qwen3-1.7b",
    name: "Qwen3 1.7B",
    description: "Lightweight Qwen — good quality at minimal size",
    size: "1.1 GB",
    sizeBytes: 1_100_000_000,
    url: "https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf",
    filename: "Qwen3-1.7B-Q4_K_M.gguf",
    minRamGB: 3,
    deviceClass: "eco",
  },
  {
    id: "qwen3-0.6b",
    name: "Qwen3 0.6B",
    description: "Ultra-light — ideal as draft for speculative decoding",
    size: "0.5 GB",
    sizeBytes: 500_000_000,
    url: "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf",
    filename: "Qwen3-0.6B-Q4_K_M.gguf",
    minRamGB: 2,
    deviceClass: "eco",
  },
]

/** Build a direct HuggingFace download URL for a GGUF file. */
export function huggingFaceUrl(repo: string, file: string): string {
  return `https://huggingface.co/${repo}/resolve/main/${file}`
}
