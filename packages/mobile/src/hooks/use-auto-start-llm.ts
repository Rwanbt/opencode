/**
 * Auto-start local LLM when a local-llm model is selected in the model picker.
 * Listens for model selection changes and loads the model via Tauri if needed.
 */
import { invoke } from "@tauri-apps/api/core"

let currentlyLoaded: string | null = null
let loading = false

/**
 * Call this when the active model changes.
 * If it's a local-llm model, auto-load it in LlamaEngine.
 */
export async function ensureLocalLLMLoaded(providerID: string | undefined, modelID: string | undefined) {
  if (providerID !== "local-llm" || !modelID || loading) return

  // Build the expected gguf filename from the model name
  // The model name is derived from filename by stripping .gguf and quality markers
  // We need to find the matching .gguf file
  const filename = await findGGUFFile(modelID)
  if (!filename) return

  if (currentlyLoaded === filename) return

  loading = true
  try {
    console.log("[AutoLLM] Loading model:", filename)
    await invoke("load_llm_model", { filename })
    currentlyLoaded = filename
    console.log("[AutoLLM] Model loaded successfully")
  } catch (e) {
    console.error("[AutoLLM] Failed to load model:", e)
  }
  loading = false
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

export function markLocalLLMUnloaded() {
  currentlyLoaded = null
}
