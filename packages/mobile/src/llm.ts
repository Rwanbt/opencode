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

/**
 * Register the local LLM as a provider in the OpenCode server config.
 * This makes the local model appear in the model selector dropdown.
 * @param serverUrl - URL of the OpenCode bun server (e.g. http://127.0.0.1:14096)
 * @param modelName - Display name for the model
 * @param llmPort - Port of the llama-server (default 14097)
 * @param auth - Optional basic auth for the OpenCode server
 */
export async function registerLocalProvider(
  serverUrl: string,
  modelName: string,
  llmPort: number = 14097,
  auth?: { username: string; password: string },
): Promise<boolean> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (auth) {
      headers["Authorization"] = "Basic " + btoa(`${auth.username}:${auth.password}`)
    }

    // Get current config
    const getRes = await fetch(`${serverUrl}/config`, { headers })
    if (!getRes.ok) return false
    const config = await getRes.json()

    // Add local-llm provider with the llama-server endpoint
    config.provider = config.provider ?? {}
    config.provider["local-llm"] = {
      name: "Local LLM",
      npm: "@ai-sdk/openai-compatible",
      options: {
        baseURL: `http://127.0.0.1:${llmPort}/v1`,
        apiKey: "local", // llama-server doesn't require a key but the SDK needs one
      },
      models: {
        [modelName]: {
          name: modelName,
          attachment: false,
        },
      },
    }

    // Patch config
    const patchRes = await fetch(`${serverUrl}/config`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(config),
    })
    return patchRes.ok
  } catch (e) {
    console.error("[OpenCode LLM] Failed to register local provider:", e)
    return false
  }
}

/**
 * Remove the local LLM provider from the OpenCode server config.
 */
export async function unregisterLocalProvider(
  serverUrl: string,
  auth?: { username: string; password: string },
): Promise<boolean> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (auth) {
      headers["Authorization"] = "Basic " + btoa(`${auth.username}:${auth.password}`)
    }

    const getRes = await fetch(`${serverUrl}/config`, { headers })
    if (!getRes.ok) return false
    const config = await getRes.json()

    if (config.provider?.["local-llm"]) {
      delete config.provider["local-llm"]
      const patchRes = await fetch(`${serverUrl}/config`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(config),
      })
      return patchRes.ok
    }
    return true
  } catch {
    return false
  }
}
