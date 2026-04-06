import { createSignal, createResource, For, Show, onMount, onCleanup } from "solid-js"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import {
  listModels,
  downloadModel,
  deleteModel,
  startLlmServer,
  stopLlmServer,
  checkLlmHealth,
  type ModelInfo,
  type ModelDownloadProgress,
} from "../llm"
import { MODEL_CATALOG, type CatalogModel } from "../model-catalog"

interface Props {
  onClose: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return (bytes / 1_000).toFixed(0) + " KB"
  if (bytes < 1_000_000_000) return (bytes / 1_000_000).toFixed(1) + " MB"
  return (bytes / 1_000_000_000).toFixed(2) + " GB"
}

export function ModelManager(props: Props) {
  const [models, { refetch }] = createResource(listModels)
  const [healthy, setHealthy] = createSignal(false)
  const [activeModel, setActiveModel] = createSignal<string | null>(null)
  const [actionLoading, setActionLoading] = createSignal<string | null>(null)
  const [downloadProgress, setDownloadProgress] = createSignal<Record<string, ModelDownloadProgress>>({})
  const [customUrl, setCustomUrl] = createSignal("")
  const [error, setError] = createSignal("")

  let unlisten: UnlistenFn | undefined

  onMount(async () => {
    // Listen for download progress events
    unlisten = await listen<ModelDownloadProgress>("model-download-progress", (event) => {
      setDownloadProgress((prev) => ({ ...prev, [event.payload.filename]: event.payload }))
      // If download finished, refresh the model list
      if (event.payload.progress >= 1.0) {
        setTimeout(() => {
          refetch()
          // Clean up progress entry after a short delay
          setDownloadProgress((prev) => {
            const next = { ...prev }
            delete next[event.payload.filename]
            return next
          })
        }, 500)
      }
    })

    // Check health on mount
    const h = await checkLlmHealth()
    setHealthy(h)
  })

  onCleanup(() => {
    unlisten?.()
  })

  function clearError() {
    setError("")
  }

  function totalDownloadedSize(): number {
    const m = models()
    if (!m) return 0
    return m.reduce((sum, model) => sum + model.size, 0)
  }

  function isDownloaded(filename: string): boolean {
    const m = models()
    if (!m) return false
    return m.some((model) => model.filename === filename)
  }

  function isDownloading(filename: string): boolean {
    return filename in downloadProgress()
  }

  async function handleStartServer(filename: string) {
    clearError()
    setActionLoading(filename)
    try {
      await startLlmServer(filename)
      setActiveModel(filename)
      setHealthy(true)
    } catch (err) {
      setError("Failed to start server: " + (err instanceof Error ? err.message : String(err)))
    } finally {
      setActionLoading(null)
    }
  }

  async function handleStopServer() {
    clearError()
    setActionLoading("__stop__")
    try {
      await stopLlmServer()
      setActiveModel(null)
      setHealthy(false)
    } catch (err) {
      setError("Failed to stop server: " + (err instanceof Error ? err.message : String(err)))
    } finally {
      setActionLoading(null)
    }
  }

  async function handleDelete(filename: string) {
    clearError()
    setActionLoading(filename)
    try {
      if (activeModel() === filename) {
        await stopLlmServer()
        setActiveModel(null)
        setHealthy(false)
      }
      await deleteModel(filename)
      refetch()
    } catch (err) {
      setError("Failed to delete: " + (err instanceof Error ? err.message : String(err)))
    } finally {
      setActionLoading(null)
    }
  }

  async function handleCatalogDownload(catalog: CatalogModel) {
    clearError()
    try {
      await downloadModel(catalog.url, catalog.filename)
    } catch (err) {
      setError("Download failed: " + (err instanceof Error ? err.message : String(err)))
    }
  }

  async function handleCustomDownload() {
    clearError()
    const url = customUrl().trim()
    if (!url) return
    // Extract filename from URL
    const parts = url.split("/")
    const filename = parts[parts.length - 1] || "custom-model.gguf"
    try {
      await downloadModel(url, filename)
      setCustomUrl("")
    } catch (err) {
      setError("Download failed: " + (err instanceof Error ? err.message : String(err)))
    }
  }

  // Styles
  const containerStyle = {
    position: "fixed" as const,
    top: "0",
    left: "0",
    right: "0",
    bottom: "0",
    background: "#0a0a0a",
    color: "#e5e5e5",
    "font-family": "system-ui, -apple-system, sans-serif",
    "overflow-y": "auto" as const,
    "z-index": "1000",
  }

  const headerStyle = {
    display: "flex",
    "align-items": "center",
    padding: "16px 20px",
    "border-bottom": "1px solid #222",
    position: "sticky" as const,
    top: "0",
    background: "#0a0a0a",
    "z-index": "10",
  }

  const sectionStyle = {
    padding: "20px",
  }

  const sectionTitleStyle = {
    "font-size": "15px",
    "font-weight": "600",
    color: "#888",
    "text-transform": "uppercase" as const,
    "letter-spacing": "0.5px",
    "margin-bottom": "12px",
  }

  const cardStyle = {
    background: "#1a1a1a",
    "border-radius": "12px",
    border: "1px solid #2a2a2a",
    padding: "14px 16px",
    "margin-bottom": "10px",
  }

  const activeCardStyle = {
    ...cardStyle,
    border: "1px solid #22c55e",
    background: "#0a1f0a",
  }

  const btnBase = {
    padding: "10px 16px",
    "border-radius": "8px",
    border: "none",
    "font-size": "13px",
    "font-weight": "600",
    cursor: "pointer",
    "min-height": "44px",
    "min-width": "44px",
    display: "inline-flex",
    "align-items": "center",
    "justify-content": "center",
  }

  const btnPrimary = {
    ...btnBase,
    background: "#1e3a5f",
    color: "#93c5fd",
    border: "1px solid #3b82f6",
  }

  const btnDanger = {
    ...btnBase,
    background: "#3f1111",
    color: "#fca5a5",
    border: "1px solid #7f1d1d",
  }

  const btnSuccess = {
    ...btnBase,
    background: "#0a2f0a",
    color: "#86efac",
    border: "1px solid #22c55e",
  }

  const btnDisabled = {
    ...btnBase,
    background: "#1a1a1a",
    color: "#555",
    border: "1px solid #333",
    cursor: "default",
  }

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <button
          onClick={props.onClose}
          style={{
            ...btnBase,
            background: "transparent",
            color: "#888",
            padding: "8px",
            "margin-right": "12px",
            "font-size": "20px",
          }}
          aria-label="Close"
        >
          &larr;
        </button>
        <div style={{ flex: "1" }}>
          <div style={{ "font-size": "18px", "font-weight": "700" }}>Local AI Models</div>
          <div style={{ "font-size": "12px", color: "#666", "margin-top": "2px" }}>
            {formatBytes(totalDownloadedSize())} used
            <Show when={healthy()}>
              <span style={{ color: "#22c55e", "margin-left": "12px" }}>
                ● Server running
              </span>
            </Show>
            <Show when={!healthy()}>
              <span style={{ color: "#555", "margin-left": "12px" }}>
                ○ Server stopped
              </span>
            </Show>
          </div>
        </div>
      </div>

      {/* Error banner */}
      <Show when={error()}>
        <div style={{
          margin: "12px 20px 0",
          padding: "10px 14px",
          "border-radius": "8px",
          background: "#7f1d1d",
          color: "#fca5a5",
          "font-size": "13px",
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
        }}>
          <span>{error()}</span>
          <button
            onClick={clearError}
            style={{ background: "none", border: "none", color: "#fca5a5", cursor: "pointer", padding: "4px 8px", "font-size": "16px" }}
          >
            &times;
          </button>
        </div>
      </Show>

      {/* Installed Models */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Installed Models</div>
        <Show when={models.loading}>
          <div style={{ color: "#555", "font-size": "14px", padding: "12px 0" }}>Loading...</div>
        </Show>
        <Show when={!models.loading && (!models() || models()!.length === 0)}>
          <div style={{ ...cardStyle, color: "#555", "text-align": "center", "font-size": "14px" }}>
            No models downloaded yet
          </div>
        </Show>
        <For each={models()}>
          {(model) => {
            const isActive = () => activeModel() === model.filename
            const isLoading = () => actionLoading() === model.filename

            return (
              <div style={isActive() ? activeCardStyle : cardStyle}>
                <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
                  <div style={{ flex: "1", "min-width": "0" }}>
                    <div style={{
                      "font-size": "15px",
                      "font-weight": "600",
                      "white-space": "nowrap",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                    }}>
                      {model.filename}
                    </div>
                    <div style={{ "font-size": "12px", color: "#666", "margin-top": "2px" }}>
                      {formatBytes(model.size)}
                      <Show when={isActive()}>
                        <span style={{ color: "#22c55e", "margin-left": "8px" }}>Running</span>
                      </Show>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "8px", "margin-left": "12px", "flex-shrink": "0" }}>
                    <Show when={isActive()}>
                      <button
                        onClick={handleStopServer}
                        disabled={isLoading() || actionLoading() === "__stop__"}
                        style={isLoading() || actionLoading() === "__stop__" ? btnDisabled : btnDanger}
                      >
                        {actionLoading() === "__stop__" ? "..." : "Stop"}
                      </button>
                    </Show>
                    <Show when={!isActive()}>
                      <button
                        onClick={() => handleStartServer(model.filename)}
                        disabled={isLoading()}
                        style={isLoading() ? btnDisabled : btnSuccess}
                      >
                        {isLoading() ? "..." : "Start"}
                      </button>
                    </Show>
                    <button
                      onClick={() => handleDelete(model.filename)}
                      disabled={isLoading()}
                      style={isLoading() ? btnDisabled : btnDanger}
                    >
                      {isLoading() ? "..." : "Delete"}
                    </button>
                  </div>
                </div>
              </div>
            )
          }}
        </For>
      </div>

      {/* Download Models from Catalog */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Available Models</div>
        <For each={MODEL_CATALOG}>
          {(catalog) => {
            const downloaded = () => isDownloaded(catalog.filename)
            const downloading = () => isDownloading(catalog.filename)
            const progress = () => downloadProgress()[catalog.filename]

            return (
              <div style={cardStyle}>
                <div style={{ display: "flex", "align-items": "flex-start", "justify-content": "space-between" }}>
                  <div style={{ flex: "1", "min-width": "0" }}>
                    <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                      <span style={{ "font-size": "15px", "font-weight": "600" }}>{catalog.name}</span>
                      <Show when={catalog.recommended}>
                        <span style={{
                          "font-size": "10px",
                          "font-weight": "700",
                          padding: "2px 6px",
                          "border-radius": "4px",
                          background: "#1e3a5f",
                          color: "#93c5fd",
                        }}>
                          Recommended
                        </span>
                      </Show>
                    </div>
                    <div style={{ "font-size": "13px", color: "#888", "margin-top": "4px" }}>
                      {catalog.description}
                    </div>
                    <div style={{ "font-size": "12px", color: "#555", "margin-top": "4px" }}>
                      {catalog.size}
                    </div>
                  </div>
                  <div style={{ "margin-left": "12px", "flex-shrink": "0" }}>
                    <Show when={downloaded()}>
                      <div style={{
                        ...btnBase,
                        background: "transparent",
                        color: "#22c55e",
                        border: "1px solid #22c55e33",
                        cursor: "default",
                        "font-size": "13px",
                      }}>
                        Downloaded
                      </div>
                    </Show>
                    <Show when={!downloaded() && !downloading()}>
                      <button
                        onClick={() => handleCatalogDownload(catalog)}
                        style={btnPrimary}
                      >
                        Download
                      </button>
                    </Show>
                    <Show when={downloading()}>
                      <div style={{
                        ...btnBase,
                        background: "#1a1a1a",
                        color: "#93c5fd",
                        border: "1px solid #333",
                        cursor: "default",
                        "font-size": "12px",
                        "min-width": "80px",
                      }}>
                        {Math.round((progress()?.progress ?? 0) * 100)}%
                      </div>
                    </Show>
                  </div>
                </div>
                {/* Download progress bar */}
                <Show when={downloading()}>
                  <div style={{
                    "margin-top": "10px",
                    height: "4px",
                    "border-radius": "2px",
                    background: "#222",
                    overflow: "hidden",
                  }}>
                    <div style={{
                      height: "100%",
                      width: `${Math.round((progress()?.progress ?? 0) * 100)}%`,
                      background: "#3b82f6",
                      "border-radius": "2px",
                      transition: "width 0.3s ease",
                    }} />
                  </div>
                  <div style={{ "font-size": "11px", color: "#555", "margin-top": "4px" }}>
                    {formatBytes(progress()?.downloaded ?? 0)} / {formatBytes(progress()?.total ?? 0)}
                  </div>
                </Show>
              </div>
            )
          }}
        </For>
      </div>

      {/* Custom Download */}
      <div style={{ ...sectionStyle, "padding-bottom": "40px" }}>
        <div style={sectionTitleStyle}>Custom Model</div>
        <div style={cardStyle}>
          <div style={{ "font-size": "13px", color: "#888", "margin-bottom": "10px" }}>
            Download a GGUF model from a HuggingFace URL
          </div>
          <input
            type="url"
            placeholder="https://huggingface.co/.../model.gguf"
            value={customUrl()}
            onInput={(e) => setCustomUrl(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCustomDownload()}
            style={{
              width: "100%",
              padding: "12px 14px",
              "border-radius": "8px",
              border: "1px solid #333",
              background: "#111",
              color: "#e5e5e5",
              "font-size": "14px",
              outline: "none",
              "box-sizing": "border-box",
              "margin-bottom": "10px",
            }}
          />
          <button
            onClick={handleCustomDownload}
            disabled={!customUrl().trim()}
            style={customUrl().trim() ? btnPrimary : btnDisabled}
          >
            Download
          </button>
        </div>
      </div>
    </div>
  )
}
