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

/** Start the local LLM server (llama-server) with the given model. */
export async function startLlmServer(model: string, port?: number): Promise<void> {
  return invoke("start_llm_server", { model, port: port ?? null })
}

/** Stop the local LLM server. */
export async function stopLlmServer(): Promise<void> {
  return invoke("stop_llm_server")
}

/** Check if the LLM server is healthy. */
export async function checkLlmHealth(port?: number): Promise<boolean> {
  try {
    return await invoke<boolean>("check_llm_health", { port: port ?? null })
  } catch {
    return false
  }
}
