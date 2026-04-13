/**
 * Auto-start local LLM when a local-llm model is selected in the model picker.
 * Listens for model selection changes and loads the model via Tauri if needed.
 * Passes KV cache, flash attention, and speculative decoding config.
 */
import { invoke } from "@tauri-apps/api/core"

let currentlyLoaded: string | null = null
let loading = false

/** Default LLM config — matches desktop Fast preset */
const DEFAULT_CONFIG = {
  kvCacheType: "q4_0",
  flashAttn: true,
  offloadMode: "auto",
  mmapMode: "auto",
}

/**
 * Call this when the active model changes.
 * If it's a local-llm model, auto-load it in LlamaEngine.
 */
export async function ensureLocalLLMLoaded(providerID: string | undefined, modelID: string | undefined) {
  if (providerID !== "local-llm" || !modelID || loading) return

  const filename = await findGGUFFile(modelID)
  if (!filename) return

  if (currentlyLoaded === filename) return

  loading = true
  try {
    // Read user config from localStorage or use defaults
    const config = loadLlmConfig()

    // Push config to Rust env vars before loading
    console.log("[AutoLLM] Setting config:", config)
    await invoke("set_llm_config", {
      kvCacheType: config.kvCacheType,
      flashAttn: config.flashAttn,
      offloadMode: config.offloadMode,
      mmapMode: config.mmapMode,
    })

    console.log("[AutoLLM] Loading model:", filename)
    await invoke("load_llm_model", { filename, draftModel: null })
    currentlyLoaded = filename
    console.log("[AutoLLM] Model loaded successfully")
  } catch (e) {
    console.error("[AutoLLM] Failed to load model:", e)
  }
  loading = false
}

/** Load LLM config from localStorage (synced with settings-configuration UI) */
function loadLlmConfig() {
  try {
    const stored = localStorage.getItem("opencode-model-config")
    if (stored) {
      const parsed = JSON.parse(stored)
      return {
        kvCacheType: parsed.kvCacheType ?? DEFAULT_CONFIG.kvCacheType,
        flashAttn: parsed.flashAttn ?? DEFAULT_CONFIG.flashAttn,
        offloadMode: parsed.offloadMode ?? DEFAULT_CONFIG.offloadMode,
        mmapMode: parsed.mmapMode ?? DEFAULT_CONFIG.mmapMode,
      }
    }
  } catch { /* ignore parse errors */ }
  return { ...DEFAULT_CONFIG }
}

async function findGGUFFile(modelName: string): Promise<string | null> {
  try {
    const models: Array<{ filename: string; size: number }> = await invoke("list_models")
    // Try exact match first (model name could already be the filename)
    const exact = models.find(m => m.filename === modelName || m.filename === modelName + ".gguf")
    if (exact) return exact.filename

    // Try matching by stripping quality markers from filenames
    const match = models.find(m => {
      const stripped = m.filename.replace(/\.gguf$/i, "").replace(/[-_]Q\d.*$/i, "")
      return stripped === modelName
    })
    return match?.filename ?? null
  } catch {
    return null
  }
}

/** Get device memory info for the VRAM/RAM widget */
export async function getDeviceMemoryInfo(): Promise<{ totalMb: number; availableMb: number; usedMb: number } | null> {
  try {
    const info: { total_mb: number; available_mb: number; used_mb: number } = await invoke("get_memory_info")
    return { totalMb: info.total_mb, availableMb: info.available_mb, usedMb: info.used_mb }
  } catch {
    return null
  }
}

export function markLocalLLMUnloaded() {
  currentlyLoaded = null
}
