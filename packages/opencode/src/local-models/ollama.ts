import { Log } from "../util/log"
import { OllamaModelList, OllamaModelInfo, type OllamaModel, type OllamaPullProgress } from "./types"

const log = Log.create({ service: "ollama" })
const DEFAULT_URL = "http://localhost:11434"

export namespace Ollama {
  export async function isRunning(baseUrl = DEFAULT_URL): Promise<boolean> {
    try {
      const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) })
      return res.ok
    } catch {
      return false
    }
  }

  export async function listModels(baseUrl = DEFAULT_URL): Promise<OllamaModel[]> {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`Ollama API error: ${res.status} ${res.statusText}`)
    const data = OllamaModelList.parse(await res.json())
    return data.models
  }

  export async function show(name: string, baseUrl = DEFAULT_URL): Promise<OllamaModelInfo> {
    const res = await fetch(`${baseUrl}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) throw new Error(`Ollama API error: ${res.status} ${res.statusText}`)
    return OllamaModelInfo.parse(await res.json())
  }

  export async function pull(
    name: string,
    opts?: {
      baseUrl?: string
      onProgress?: (progress: OllamaPullProgress) => void
    },
  ): Promise<void> {
    const baseUrl = opts?.baseUrl ?? DEFAULT_URL
    log.info("pulling model", { name, baseUrl })

    // No top-level timeout: /api/pull is a long-running NDJSON stream that
    // can take minutes on large models. Per-chunk liveness is implicit via
    // reader.read() — a stalled TCP connection will surface as no data and
    // the caller should abort via its own AbortSignal if needed.
    const res = await fetch(`${baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, stream: true }),
    })

    if (!res.ok) throw new Error(`Ollama API error: ${res.status} ${res.statusText}`)
    if (!res.body) throw new Error("No response body")

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const progress = JSON.parse(line) as OllamaPullProgress
          opts?.onProgress?.(progress)
          if (progress.status === "success") {
            log.info("model pulled successfully", { name })
            return
          }
        } catch {
          // skip malformed lines
        }
      }
    }
  }

  export async function remove(name: string, baseUrl = DEFAULT_URL): Promise<void> {
    const res = await fetch(`${baseUrl}/api/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) throw new Error(`Ollama API error: ${res.status} ${res.statusText}`)
    log.info("model removed", { name })
  }

  export function formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`
  }
}
