import { createSignal, createResource, For, Show, onMount, onCleanup } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Tag } from "@opencode-ai/ui/tag"
import { useGlobalSync } from "@/context/global-sync"

// Use Tauri's global API if available (injected by withGlobalTauri: true in tauri.conf.json)
function invokeTauri(cmd: string, args?: Record<string, unknown>): Promise<any> {
  const tauri = (globalThis as any).__TAURI__
  if (!tauri?.core?.invoke) return Promise.reject("Tauri not available")
  return tauri.core.invoke(cmd, args)
}

function listenTauri(event: string, handler: (e: any) => void): Promise<() => void> {
  const tauri = (globalThis as any).__TAURI__
  if (!tauri?.event?.listen) return Promise.resolve(() => {})
  return tauri.event.listen(event, handler)
}

interface ModelInfo { filename: string; size: number }

const MODEL_CATALOG = [
  { id: "gemma-4-e4b", name: "Gemma 4 E4B", description: "Google's latest — recommended", size: "5.0 GB", sizeBytes: 5_000_000_000, url: "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf", filename: "gemma-4-E4B-it-Q4_K_M.gguf", recommended: true },
  { id: "qwen3.5-4b", name: "Qwen 3.5 4B", description: "Great multilingual model", size: "2.7 GB", sizeBytes: 2_700_000_000, url: "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf", filename: "Qwen3.5-4B-Q4_K_M.gguf" },
  { id: "qwen3.5-2b", name: "Qwen 3.5 2B", description: "Fast & lightweight", size: "1.3 GB", sizeBytes: 1_300_000_000, url: "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf", filename: "Qwen3.5-2B-Q4_K_M.gguf" },
  { id: "qwen3.5-0.8b", name: "Qwen 3.5 0.8B", description: "Ultra-light for testing", size: "0.5 GB", sizeBytes: 500_000_000, url: "https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf", filename: "Qwen3.5-0.8B-Q4_K_M.gguf" },
]

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return (bytes / 1_000).toFixed(0) + " KB"
  if (bytes < 1_000_000_000) return (bytes / 1_000_000).toFixed(1) + " MB"
  return (bytes / 1_000_000_000).toFixed(2) + " GB"
}

interface HFModel {
  id: string
  author: string
  downloads: number
  siblings?: { rfilename: string; size?: number }[]
}

interface HFSearchResult {
  id: string
  author: string
  name: string
  downloads: number
  ggufFiles: { filename: string; size: number; url: string }[]
}

async function searchHuggingFace(query: string): Promise<HFSearchResult[]> {
  if (!query.trim()) return []
  const q = encodeURIComponent(query)
  const res = await fetch(
    `https://huggingface.co/api/models?search=${q}&filter=gguf&sort=downloads&direction=-1&limit=15&expand[]=siblings`,
  )
  if (!res.ok) throw new Error("HuggingFace search failed")
  const data: HFModel[] = await res.json()
  return data
    .map((m) => {
      const author = m.id.split("/")[0] ?? ""
      const ggufFiles = (m.siblings ?? [])
        .filter((s) => s.rfilename.endsWith(".gguf") && !s.rfilename.includes("mmproj") && !s.rfilename.includes("imatrix"))
        .map((s) => ({
          filename: s.rfilename.includes("/") ? s.rfilename.split("/").pop()! : s.rfilename,
          size: s.size ?? 0,
          url: `https://huggingface.co/${m.id}/resolve/main/${s.rfilename}`,
        }))
      return {
        id: m.id,
        author,
        name: m.id.split("/").pop() ?? m.id,
        downloads: m.downloads,
        ggufFiles,
      }
    })
    .filter((m) => m.ggufFiles.length > 0)
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return String(n)
}

export function DialogLocalLLM() {
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const [models, { refetch }] = createResource((): Promise<ModelInfo[]> => invokeTauri("list_models").catch(() => []))
  const [activeModel, setActiveModel] = createSignal<string | null>(null)
  const [healthy, setHealthy] = createSignal(false)
  const [error, setError] = createSignal("")
  const [downloading, setDownloading] = createSignal<Record<string, number>>({})
  const [loading, setLoading] = createSignal<string | null>(null)
  const [hfQuery, setHfQuery] = createSignal("")
  const [hfResults, setHfResults] = createSignal<HFSearchResult[]>([])
  const [hfSearching, setHfSearching] = createSignal(false)
  const [hfExpanded, setHfExpanded] = createSignal<string | null>(null)
  const [hfError, setHfError] = createSignal("")

  let hfSearchTimeout: ReturnType<typeof setTimeout> | undefined

  function handleHfSearch(value: string) {
    setHfQuery(value)
    setHfError("")
    if (hfSearchTimeout) clearTimeout(hfSearchTimeout)
    if (!value.trim()) { setHfResults([]); return }
    hfSearchTimeout = setTimeout(async () => {
      setHfSearching(true)
      try {
        const results = await searchHuggingFace(value)
        setHfResults(results)
      } catch (e) {
        setHfError("Search failed. Check your connection.")
        setHfResults([])
      }
      setHfSearching(false)
    }, 400)
  }

  // Poll health + auto-register models on mount
  let healthInterval: ReturnType<typeof setInterval>
  onMount(async () => {
    healthInterval = setInterval(async () => {
      const ok: boolean = await invokeTauri("check_llm_health", { port: null }).catch(() => false)
      setHealthy(ok)
    }, 5000)
    // Register all downloaded models so they appear in the model picker
    await registerLocalModels()
  })
  onCleanup(() => clearInterval(healthInterval))

  // Listen for download progress
  onMount(async () => {
    const unlisten = await listenTauri("model-download-progress", (e: any) => {
      setDownloading((prev) => ({ ...prev, [e.payload.filename]: e.payload.progress }))
    })
    onCleanup(unlisten)
  })

  const isDownloaded = (filename: string) => (models() ?? []).some((m: ModelInfo) => m.filename === filename)

  async function handleDownload(url: string, filename: string) {
    setError("")
    setDownloading((prev) => ({ ...prev, [filename]: 0 }))
    try {
      await invokeTauri("download_model", { url, filename })
      setDownloading((prev) => { const n = { ...prev }; delete n[filename]; return n })
      refetch()
      // Auto-register local-llm provider with all downloaded models
      await registerLocalModels()
    } catch (e) {
      setError(`Download failed: ${e}`)
      setDownloading((prev) => { const n = { ...prev }; delete n[filename]; return n })
    }
  }

  async function registerLocalModels() {
    try {
      const allModels: ModelInfo[] = await invokeTauri("list_models").catch(() => [])
      if (allModels.length === 0) return

      // Read model config from settings
      const configRaw = localStorage.getItem("opencode-model-config")
      const modelConfig = configRaw ? JSON.parse(configRaw) : {}
      const outputTokens = modelConfig.outputTokensMode === "manual"
        ? modelConfig.outputTokensManual || 8192
        : 8192 // auto: reasonable default for local models
      const contextSize = modelConfig.contextMode === "manual"
        ? modelConfig.contextManual || 32768
        : 131072 // auto: use model's native context

      const modelEntries: Record<string, { name: string; limit?: { context: number; output: number } }> = {}
      for (const m of allModels) {
        const name = m.filename.replace(/\.gguf$/i, "").replace(/[-_]Q\d.*$/i, "")
        modelEntries[name] = {
          name,
          limit: { context: contextSize, output: outputTokens },
        }
      }
      await globalSync.updateConfig({
        provider: {
          "local-llm": {
            name: "Local AI",
            options: { baseURL: "http://127.0.0.1:14097/v1", apiKey: "local" },
            models: modelEntries,
          },
        },
        disabled_providers: [],
      })
    } catch {}
  }

  async function handleStart(filename: string) {
    setError("")
    setLoading(filename)
    try {
      await invokeTauri("load_llm_model", { filename })
      setActiveModel(filename)
      setHealthy(true)
      // Register local-llm as a provider and remove from disabled list
      const modelName = filename.replace(/\.gguf$/i, "").replace(/[-_]Q\d.*$/i, "")
      try {
        await globalSync.updateConfig({
          provider: {
            "local-llm": {
              name: "Local AI",
              options: {
                baseURL: "http://127.0.0.1:14097/v1",
                apiKey: "local",
              },
              models: {
                [modelName]: { name: modelName },
              },
            },
          },
          disabled_providers: [], // clear disabled to ensure local-llm is active
        })
        console.log("[LLM] Provider registered:", modelName)
      } catch (e) {
        console.warn("[LLM] Failed to register provider:", e)
      }
    } catch (e) {
      setError(`Load failed: ${e instanceof Error ? e.message : e}`)
    }
    setLoading(null)
  }

  async function handleStop() {
    setLoading("__stop__")
    try {
      await invokeTauri("unload_llm_model")
      setActiveModel(null)
      setHealthy(false)
      // Remove local-llm provider from config
      try {
        await globalSync.updateConfig({
          provider: { "local-llm": undefined as any },
        })
      } catch {}
    } catch (e) {
      setError(`Stop failed: ${e}`)
    }
    setLoading(null)
  }

  async function handleDelete(filename: string) {
    setLoading(filename)
    try {
      if (activeModel() === filename) { await invokeTauri("unload_llm_model"); setActiveModel(null); setHealthy(false) }
      await invokeTauri("delete_model", { filename })
      refetch()
    } catch (e) {
      setError(`Delete failed: ${e}`)
    }
    setLoading(null)
  }

  return (
    <Dialog
      title={
        <IconButton
          tabIndex={-1}
          icon="arrow-left"
          variant="ghost"
          onClick={() => dialog.close()}
          aria-label="Back"
        />
      }
    >
      <div class="flex flex-col gap-4 px-4 pb-6 overflow-y-auto max-h-[70vh]" style={{ "-webkit-overflow-scrolling": "touch" }}>
        {/* Header */}
        <div class="flex items-center gap-3">
          <ProviderIcon id="local-llm" class="size-6 shrink-0" />
          <div>
            <div class="text-16-medium text-text-strong">Local AI Models</div>
            <div class="text-12-regular text-text-weak">
              Run models on-device with llama.cpp
              <Show when={healthy()}>
                <span class="text-icon-success-base"> • Running</span>
              </Show>
            </div>
          </div>
        </div>

        {/* Error */}
        <Show when={error()}>
          <div class="text-13-regular text-text-critical-base bg-surface-critical-base/10 rounded-md px-3 py-2">
            {error()}
          </div>
        </Show>

        {/* Installed models */}
        <Show when={(models() ?? []).length > 0}>
          <div class="flex flex-col gap-1">
            <div class="text-13-medium text-text-weak">Installed</div>
            <For each={models()}>
              {(model) => (
                <div class="flex items-center justify-between gap-2 py-2 border-b border-border-weak-base last:border-none">
                  <div class="flex flex-col min-w-0">
                    <span class="text-14-regular text-text-strong truncate">{model.filename.replace(/\.gguf$/i, "")}</span>
                    <span class="text-12-regular text-text-weak">{formatBytes(model.size)}</span>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <Show when={activeModel() === model.filename}>
                      <Tag>Active</Tag>
                    </Show>
                    <Button size="small" variant="ghost" class="text-text-critical-base" disabled={loading() !== null} onClick={() => handleDelete(model.filename)}>
                      Delete
                    </Button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* Catalog */}
        <div class="flex flex-col gap-1">
          <div class="text-13-medium text-text-weak">Available Models</div>
          <For each={MODEL_CATALOG}>
            {(item) => (
              <div class="flex items-center justify-between gap-2 py-2 border-b border-border-weak-base last:border-none">
                <div class="flex flex-col min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="text-14-regular text-text-strong">{item.name}</span>
                    <Show when={item.recommended}><Tag>Recommended</Tag></Show>
                  </div>
                  <span class="text-12-regular text-text-weak">{item.description} — {item.size}</span>
                </div>
                <Show when={isDownloaded(item.filename)} fallback={
                  <Show when={downloading()[item.filename] !== undefined} fallback={
                    <Button size="small" variant="secondary" onClick={() => handleDownload(item.url, item.filename)}>
                      Download
                    </Button>
                  }>
                    <span class="text-12-regular text-text-weak">{Math.round((downloading()[item.filename] ?? 0) * 100)}%</span>
                  </Show>
                }>
                  <span class="text-12-regular text-icon-success-base">Downloaded ✓</span>
                </Show>
              </div>
            )}
          </For>
        </div>

        {/* HuggingFace Search */}
        <div class="flex flex-col gap-2 pt-2 border-t border-border-weak-base">
          <div class="flex items-center gap-2">
            <Icon name="globe" size="small" class="text-text-weak" />
            <span class="text-13-medium text-text-weak">Search HuggingFace</span>
          </div>
          <div class="flex items-center gap-2 bg-surface-inset rounded-md border border-border-weak-base focus-within:border-border-base transition-colors px-2.5">
            <Icon name="magnifying-glass" size="small" class="text-text-weak" />
            <input
              type="text"
              placeholder="Search GGUF models..."
              value={hfQuery()}
              onInput={(e) => handleHfSearch(e.currentTarget.value)}
              class="w-full py-2 text-13-regular bg-transparent text-text-strong placeholder:text-text-weak outline-none"
            />
          </div>

          <Show when={hfError()}>
            <div class="text-12-regular text-text-critical-base">{hfError()}</div>
          </Show>

          <Show when={hfSearching()}>
            <div class="text-12-regular text-text-weak py-2">Searching...</div>
          </Show>

          <Show when={hfResults().length > 0}>
            <div class="flex flex-col gap-0.5 max-h-64 overflow-y-auto" style={{ "-webkit-overflow-scrolling": "touch" }}>
              <For each={hfResults()}>
                {(result) => {
                  const expanded = () => hfExpanded() === result.id
                  return (
                    <div class="flex flex-col border-b border-border-weak-base last:border-none">
                      <button
                        type="button"
                        class="flex items-center justify-between gap-2 py-2 text-left w-full hover:bg-surface-inset/50 rounded-sm px-1 transition-colors"
                        onClick={() => setHfExpanded(expanded() ? null : result.id)}
                      >
                        <div class="flex flex-col min-w-0 flex-1">
                          <span class="text-13-regular text-text-strong truncate">{result.name}</span>
                          <span class="text-11-regular text-text-weak">{result.author} — {formatDownloads(result.downloads)} downloads — {result.ggufFiles.length} GGUF file{result.ggufFiles.length > 1 ? "s" : ""}</span>
                        </div>
                        <Icon name={expanded() ? "chevron-down" : "chevron-right"} size="small" class="text-text-weak" />
                      </button>
                      <Show when={expanded()}>
                        <div class="flex flex-col gap-0.5 pl-3 pb-2">
                          <For each={result.ggufFiles}>
                            {(file) => {
                              const fname = file.filename.split("/").pop() ?? file.filename
                              return (
                                <div class="flex items-center justify-between gap-2 py-1.5 px-1">
                                  <div class="flex flex-col min-w-0 flex-1">
                                    <span class="text-12-regular text-text-strong truncate">{fname}</span>
                                    <Show when={file.size > 0}>
                                      <span class="text-11-regular text-text-weak">{formatBytes(file.size)}</span>
                                    </Show>
                                  </div>
                                  <Show when={isDownloaded(fname)} fallback={
                                    <Show when={downloading()[fname] !== undefined} fallback={
                                      <Button size="small" variant="secondary" onClick={() => handleDownload(file.url, fname)}>
                                        Download
                                      </Button>
                                    }>
                                      <span class="text-12-regular text-text-weak">{Math.round((downloading()[fname] ?? 0) * 100)}%</span>
                                    </Show>
                                  }>
                                    <span class="text-12-regular text-icon-success-base">Downloaded</span>
                                  </Show>
                                </div>
                              )
                            }}
                          </For>
                        </div>
                      </Show>
                    </div>
                  )
                }}
              </For>
            </div>
          </Show>

          <Show when={!hfSearching() && hfQuery().trim() && hfResults().length === 0 && !hfError()}>
            <div class="text-12-regular text-text-weak py-2">No GGUF models found</div>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
