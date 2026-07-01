/**
 * Auto-start local LLM when a local-llm model is selected in the model picker.
 * Listens for model selection changes and loads the model via Tauri if needed.
 * Passes KV cache, flash attention, and speculative decoding config.
 */
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

let currentlyLoaded: string | null = null
let loading = false

/** Default LLM config — matches desktop Fast preset */
const DEFAULT_CONFIG = {
  kvCacheType: "q4_0",
  flashAttn: true,
  offloadMode: "auto",
  mmapMode: "auto",
  accelerator: "auto",
  threads: 0,
  nBatch: 512,
  cacheReuse: true,
  topK: 64,
  topP: 0.95,
  temperature: 0.7,
  systemPrompt: "",
  draftModel: "",
}

/**
 * Call this when the active model changes.
 * If it's a local-llm model, auto-load it in LlamaEngine.
 */
export async function ensureLocalLLMLoaded(providerID: string | undefined, modelID: string | undefined) {
  if (providerID !== "local-llm" || !modelID || loading) return

  const filename = await findGGUFFile(modelID)
  if (!filename) {
    // No matching model found — prompt the user to open the model manager
    window.dispatchEvent(new CustomEvent("no-model-found", { detail: { modelID } }))
    return
  }

  if (currentlyLoaded === filename) return

  loading = true
  window.dispatchEvent(new CustomEvent("llm-loading-progress", {
    detail: { elapsed_secs: 0, max_secs: 240, filename, loading: true },
  }))
  // Subscribe to Rust progress events and forward them as DOM events
  const unlisten = await listen<{ elapsed_secs: number; max_secs: number; filename: string }>(
    "llm-model-loading",
    (event) => {
      window.dispatchEvent(new CustomEvent("llm-loading-progress", {
        detail: { ...event.payload, loading: true },
      }))
    },
  )
  try {
    // Read user config from localStorage or use defaults
    const config = loadLlmConfig()

    // Push config to Rust env vars before loading
    await invoke("set_llm_config", {
      kvCacheType: config.kvCacheType,
      flashAttn: config.flashAttn,
      offloadMode: config.offloadMode,
      mmapMode: config.mmapMode,
      accelerator: config.accelerator,
      threads: config.threads,
      nBatch: config.nBatch,
      cacheReuse: config.cacheReuse,
      topK: config.topK,
      topP: config.topP,
      temperature: config.temperature,
      systemPrompt: config.systemPrompt,
    })

    await invoke("load_llm_model", {
      filename,
      draftModel: config.draftModel ? config.draftModel : null,
    })
    currentlyLoaded = filename
  } catch (e) {
    // The Rust circuit breaker (llm.rs::load_llm_model) tracks OOM
    // crash-loops via a durable on-disk marker — a WebView localStorage
    // marker isn't reliable here since the whole app process gets killed
    // and localStorage writes aren't guaranteed to be flushed by then.
    const message = e instanceof Error ? e.message : String(e)
    if (message.startsWith("blocked:")) {
      window.dispatchEvent(new CustomEvent("llm-load-blocked", { detail: { filename } }))
    } else {
      console.error("[AutoLLM] Failed to load model:", e)
    }
  } finally {
    unlisten()
    window.dispatchEvent(new CustomEvent("llm-loading-progress", { detail: { loading: false } }))
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
        accelerator: parsed.accelerator ?? DEFAULT_CONFIG.accelerator,
        threads: parsed.threads ?? DEFAULT_CONFIG.threads,
        nBatch: parsed.nBatch ?? DEFAULT_CONFIG.nBatch,
        cacheReuse: parsed.cacheReuse ?? DEFAULT_CONFIG.cacheReuse,
        topK: parsed.topK ?? DEFAULT_CONFIG.topK,
        topP: parsed.topP ?? DEFAULT_CONFIG.topP,
        temperature: parsed.temperature ?? DEFAULT_CONFIG.temperature,
        systemPrompt: parsed.systemPrompt ?? DEFAULT_CONFIG.systemPrompt,
        draftModel: parsed.draftModel ?? DEFAULT_CONFIG.draftModel,
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
