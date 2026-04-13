import { invoke } from "@tauri-apps/api/core"

export interface ModelInfo {
  filename: string
  size: number
}

export interface ModelDownloadProgress {
  filename: string
  downloaded: number
  total: number
  progress: number
}

/** List available GGUF models in the models directory. */
export async function listModels(): Promise<ModelInfo[]> {
  try {
    return await invoke<ModelInfo[]>("list_models")
  } catch {
    return []
  }
}

/** Download a GGUF model from a URL (e.g. HuggingFace). Emits "model-download-progress" events. */
export async function downloadModel(url: string, filename: string): Promise<void> {
  return invoke("download_model", { url, filename })
}

/** Delete a downloaded model file. */
export async function deleteModel(filename: string): Promise<void> {
  return invoke("delete_model", { filename })
}

/** Load a GGUF model into memory for inference (JNI/FFI). */
export async function loadModel(filename: string, nCtx?: number, nThreads?: number): Promise<void> {
  return invoke("load_llm_model", { filename, nCtx: nCtx ?? null, nThreads: nThreads ?? null, draftModel: null })
}

/** Unload the current model from memory. */
export async function unloadModel(): Promise<void> {
  return invoke("unload_llm_model")
}

/** Check if a model is currently loaded. */
export async function isModelLoaded(): Promise<boolean> {
  try {
    return await invoke<boolean>("is_llm_loaded")
  } catch {
    return false
  }
}

/** Abort the current generation. */
export async function abortGeneration(): Promise<void> {
  return invoke("abort_llm")
}

/**
 * Generate text from a prompt. Emits "llm-token" events for streaming.
 * @returns The full generated text.
 */
export async function generateText(prompt: string, maxTokens?: number, temperature?: number): Promise<string> {
  return invoke<string>("generate_llm", {
    prompt,
    maxTokens: maxTokens ?? null,
    temperature: temperature ?? null,
  })
}

/** Check if the LLM is ready (model loaded). */
export async function checkLlmHealth(): Promise<boolean> {
  return isModelLoaded()
}
