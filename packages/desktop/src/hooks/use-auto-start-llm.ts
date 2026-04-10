/**
 * Auto-start local LLM when a local-llm model is selected in the model picker.
 * Desktop version — uses __TAURI__ global API.
 */

function invokeTauri(cmd: string, args?: Record<string, unknown>): Promise<any> {
  const tauri = (globalThis as any).__TAURI__
  if (!tauri?.core?.invoke) return Promise.reject("Tauri not available")
  return tauri.core.invoke(cmd, args)
}

let currentlyLoaded: string | null = null
let loading = false

/** Read LLM config from localStorage and push to Rust env vars */
function pushConfigToEnv() {
  try {
    const raw = localStorage.getItem("opencode-model-config")
    if (!raw) return
    const c = JSON.parse(raw)
    // Desktop llm.rs reads these env vars when starting the server
    if (c.kvCacheType) (globalThis as any).__OPENCODE_KV_CACHE = c.kvCacheType
    if (c.offloadMode) (globalThis as any).__OPENCODE_OFFLOAD = c.offloadMode
    if (c.mmapMode) (globalThis as any).__OPENCODE_MMAP = c.mmapMode
    // Pass via Tauri env — Rust reads OPENCODE_KV_CACHE_TYPE etc.
    // These are picked up by llm.rs load_llm_model()
    console.log("[AutoLLM] Config:", c.kvCacheType, c.offloadMode, c.mmapMode)
  } catch { /* ignore */ }
}

export async function ensureLocalLLMLoaded(providerID: string | undefined, modelID: string | undefined) {
  if (providerID !== "local-llm" || !modelID || loading) return

  const filename = await findGGUFFile(modelID)
  if (!filename) return
  if (currentlyLoaded === filename) return

  loading = true
  try {
    pushConfigToEnv()
    console.log("[AutoLLM] Loading model:", filename)
    await invokeTauri("load_llm_model", { filename })
    currentlyLoaded = filename
    console.log("[AutoLLM] Model loaded successfully")
  } catch (e) {
    console.error("[AutoLLM] Failed to load model:", e)
  }
  loading = false
}

/**
 * On app launch, check if there are downloaded models and preload the first one.
 * This ensures the server is ready before the user sends a message.
 */
export async function autoStartLocalLLM() {
  try {
    const models: Array<{ filename: string; size: number }> = await invokeTauri("list_models")
    if (models.length === 0) return

    // Check if server is already running
    const healthy: boolean = await invokeTauri("check_llm_health", { port: null }).catch(() => false)
    if (healthy) {
      currentlyLoaded = models[0].filename
      console.log("[AutoLLM] Server already running")
      return
    }

    // Load the first available model
    const filename = models[0].filename
    console.log("[AutoLLM] Auto-starting model on launch:", filename)
    loading = true
    await invokeTauri("load_llm_model", { filename })
    currentlyLoaded = filename
    console.log("[AutoLLM] Model auto-started successfully")
  } catch (e) {
    console.error("[AutoLLM] Auto-start failed:", e)
  }
  loading = false
}

async function findGGUFFile(modelName: string): Promise<string | null> {
  try {
    const models: Array<{ filename: string; size: number }> = await invokeTauri("list_models")

    // Try exact match
    const exact = models.find(m => m.filename === modelName || m.filename === modelName + ".gguf")
    if (exact) return exact.filename

    // Try matching by stripping quality markers
    const match = models.find(m => {
      const stripped = m.filename.replace(/\.gguf$/i, "").replace(/[-_]Q\d.*$/i, "")
      return stripped === modelName
    })
    return match?.filename ?? null
  } catch {
    return null
  }
}
