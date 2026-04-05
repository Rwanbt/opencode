import { Log } from "../util/log"
import type {
  AnythingLLMWorkspace,
  AnythingLLMDocument,
  AnythingLLMSearchResult,
  AnythingLLMChatMessage,
} from "./types"

const log = Log.create({ service: "anythingllm" })

export namespace AnythingLLMClient {
  export interface Config {
    url: string
    apiKey: string
    timeout?: number
  }

  let _config: Config | null = null

  export function configure(config: Config) {
    _config = config
    log.info("configured", { url: config.url })
  }

  export function isConfigured(): boolean {
    return _config !== null
  }

  async function request<T>(path: string, opts?: RequestInit): Promise<T> {
    if (!_config) throw new Error("AnythingLLM client not configured")

    const url = `${_config.url.replace(/\/+$/, "")}${path}`
    const response = await fetch(url, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${_config.apiKey}`,
        ...opts?.headers,
      },
      signal: opts?.signal ?? AbortSignal.timeout(_config.timeout ?? 15000),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new Error(`AnythingLLM API error ${response.status}: ${text}`)
    }

    return response.json()
  }

  /** List all workspaces */
  export async function listWorkspaces(): Promise<AnythingLLMWorkspace[]> {
    const result = await request<{ workspaces: AnythingLLMWorkspace[] }>("/api/v1/workspaces")
    return result.workspaces
  }

  /** Get a specific workspace by slug */
  export async function getWorkspace(slug: string): Promise<AnythingLLMWorkspace | null> {
    try {
      const result = await request<{ workspace: AnythingLLMWorkspace }>(`/api/v1/workspace/${slug}`)
      return result.workspace
    } catch {
      return null
    }
  }

  /** List documents in a workspace */
  export async function getDocuments(slug: string): Promise<AnythingLLMDocument[]> {
    const result = await request<{ localFiles: { items: AnythingLLMDocument[] } }>(
      `/api/v1/workspace/${slug}/documents`,
    )
    return result.localFiles?.items ?? []
  }

  /** Semantic search within a workspace */
  export async function search(
    slug: string,
    query: string,
    topK: number = 5,
  ): Promise<AnythingLLMSearchResult[]> {
    const result = await request<{ results: AnythingLLMSearchResult[] }>(
      `/api/v1/workspace/${slug}/search`,
      {
        method: "POST",
        body: JSON.stringify({ query, topN: topK }),
      },
    )
    return result.results ?? []
  }

  /** Chat with a workspace */
  export async function chat(
    slug: string,
    message: string,
    mode: "chat" | "query" = "query",
  ): Promise<AnythingLLMChatMessage> {
    const result = await request<AnythingLLMChatMessage>(`/api/v1/workspace/${slug}/chat`, {
      method: "POST",
      body: JSON.stringify({ message, mode }),
    })
    return result
  }

  /** Search across all configured workspaces */
  export async function searchAll(
    query: string,
    workspaceSlugs?: string[],
    topK: number = 5,
  ): Promise<{ workspace: string; results: AnythingLLMSearchResult[] }[]> {
    const slugs = workspaceSlugs ?? (await listWorkspaces()).map((w) => w.slug)
    const results = await Promise.all(
      slugs.map(async (slug) => {
        try {
          const results = await search(slug, query, topK)
          return { workspace: slug, results }
        } catch (e) {
          log.warn("search failed for workspace", { slug, error: String(e) })
          return { workspace: slug, results: [] }
        }
      }),
    )
    return results.filter((r) => r.results.length > 0)
  }

  /** Check if AnythingLLM server is reachable */
  export async function healthCheck(): Promise<boolean> {
    try {
      await request<any>("/api/v1/auth")
      return true
    } catch {
      return false
    }
  }
}
