/* @refresh reload */
import { createSignal, Show, Switch, Match, onMount, onCleanup } from "solid-js"
import { render } from "solid-js/web"
import {
  AppBaseProviders,
  AppInterface,
  PlatformProvider,
  ServerConnection,
} from "@opencode-ai/app"
import "@opencode-ai/app/index.css"
import "./mobile.css"
import { ModeSelector } from "./components/mode-selector"
import { ExtractionProgress } from "./components/extraction-progress"
import { ModelManager } from "./components/model-manager"
import { createPlatform } from "./platform"
import { ensureLocalLLMLoaded } from "./hooks/use-auto-start-llm"

const root = document.getElementById("root")

// Hide the static loading indicator
const loadingEl = document.getElementById("loading")
if (loadingEl) loadingEl.style.display = "none"

type Mode = "selecting" | "extracting" | "connecting" | "remote-prompt" | "ready"

interface ServerInfo {
  url: string
  username?: string
  password?: string
  variant: "embedded" | "http"
}

function App() {
  const [mode, setMode] = createSignal<Mode>("selecting")
  const [error, setError] = createSignal("")
  const [serverInfo, setServerInfo] = createSignal<ServerInfo | null>(null)
  const [platform, setPlatform] = createSignal<Awaited<ReturnType<typeof createPlatform>> | null>(null)
  const [remoteUrl, setRemoteUrl] = createSignal("")
  const [connectStatus, setConnectStatus] = createSignal("Starting local server...")
  const [showModelManager, setShowModelManager] = createSignal(false)

  // Lazy-init platform
  async function ensurePlatform() {
    let p = platform()
    if (!p) {
      p = await createPlatform()
      setPlatform(p)
    }
    return p
  }

  // Handle local mode: extract → connect
  async function handleLocalConnect() {
    setMode("connecting")
    setConnectStatus("Starting local server...")
    try {
      const p = await ensurePlatform()
      const result = await p.startLocalServer?.()
      if (result) {
        setServerInfo({
          url: result.url,
          username: result.username,
          password: result.password,
          variant: "embedded",
        })
        setMode("ready")
      } else {
        setError("Server started but health check timed out after 30s.")
        setMode("selecting")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setMode("selecting")
    }
  }

  // Handle remote mode: prompt for URL
  function handleRemotePrompt() {
    setMode("remote-prompt")
  }

  async function handleRemoteConnect() {
    const url = remoteUrl().trim()
    if (!url) return
    const normalized = /^https?:\/\//.test(url) ? url : `http://${url}`
    const p = await ensurePlatform()
    await p.setDefaultServer?.(normalized as any)
    setServerInfo({ url: normalized, variant: "http" })
    setMode("ready")
  }

  return (
    <>
    <Show when={showModelManager()}>
      <ModelManager
        onClose={() => setShowModelManager(false)}
        serverUrl={serverInfo()?.url}
        serverAuth={serverInfo()?.username ? { username: serverInfo()!.username!, password: serverInfo()!.password! } : undefined}
      />
    </Show>
    <Switch>
      <Match when={mode() === "selecting"}>
        <ModeSelector
          onLocal={() => setMode("extracting")}
          onRemote={handleRemotePrompt}
          onExtract={() => setMode("extracting")}
        />
        <Show when={error()}>
          <div style={{
            position: "fixed", bottom: "24px", left: "24px", right: "24px",
            padding: "12px 16px", "border-radius": "8px",
            background: "#7f1d1d", color: "#fca5a5", "font-size": "14px",
            "text-align": "center",
          }}>
            {error()}
          </div>
        </Show>
      </Match>

      <Match when={mode() === "extracting"}>
        <ExtractionProgress
          onComplete={() => handleLocalConnect()}
          onError={(msg) => { setError(msg); setMode("selecting") }}
        />
      </Match>

      <Match when={mode() === "connecting"}>
        <div style={{
          display: "flex", "flex-direction": "column", "align-items": "center",
          "justify-content": "center", height: "100vh", gap: "16px",
          background: "#0a0a0a", color: "#e5e5e5",
          "font-family": "system-ui, -apple-system, sans-serif",
        }}>
          <div style={{ "font-size": "18px", "font-weight": "600" }}>{connectStatus()}</div>
          <div style={{ color: "#888", "font-size": "14px" }}>Waiting for health check...</div>
          {/* Simple spinner */}
          <div style={{
            width: "32px", height: "32px", border: "3px solid #333",
            "border-top-color": "#3b82f6", "border-radius": "50%",
            animation: "spin 1s linear infinite",
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      </Match>

      <Match when={mode() === "remote-prompt"}>
        <div style={{
          display: "flex", "flex-direction": "column", "align-items": "center",
          "justify-content": "center", height: "100vh", padding: "24px", gap: "24px",
          background: "#0a0a0a", color: "#e5e5e5",
          "font-family": "system-ui, -apple-system, sans-serif",
        }}>
          <h1 style={{ "font-size": "24px", "font-weight": "700", margin: "0" }}>
            Connect to Server
          </h1>
          <p style={{ color: "#888", "font-size": "14px", margin: "0", "text-align": "center", "max-width": "320px" }}>
            Enter the URL of your OpenCode server running on your PC
          </p>
          <input
            type="url"
            placeholder="192.168.1.100:3000"
            value={remoteUrl()}
            onInput={(e) => setRemoteUrl(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRemoteConnect()}
            style={{
              width: "100%", "max-width": "320px", padding: "14px 16px",
              "border-radius": "10px", border: "1px solid #333",
              background: "#1a1a1a", color: "#e5e5e5", "font-size": "16px",
              outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: "12px", width: "100%", "max-width": "320px" }}>
            <button
              onClick={() => setMode("selecting")}
              style={{
                flex: "1", padding: "14px", "border-radius": "10px",
                border: "1px solid #333", background: "#1a1a1a",
                color: "#888", "font-size": "15px", cursor: "pointer",
              }}
            >
              Back
            </button>
            <button
              onClick={handleRemoteConnect}
              style={{
                flex: "1", padding: "14px", "border-radius": "10px",
                border: "1px solid #3b82f6", background: "#1e3a5f",
                color: "#e5e5e5", "font-size": "15px", cursor: "pointer",
                "font-weight": "600",
              }}
            >
              Connect
            </button>
          </div>
        </div>
      </Match>

      <Match when={mode() === "ready" && serverInfo() && platform()}>
        <FullApp
          platform={platform()!}
          serverInfo={serverInfo()!}
          onOpenModelManager={() => setShowModelManager(true)}
        />
      </Match>
    </Switch>
    </>
  )
}

function FullApp(props: {
  platform: Awaited<ReturnType<typeof createPlatform>>;
  serverInfo: ServerInfo;
  onOpenModelManager?: () => void;
}) {
  // Listen for "open-model-manager" custom event from the model selector
  onMount(() => {
    const handler = () => props.onOpenModelManager?.()
    window.addEventListener("open-model-manager", handler)
    onCleanup(() => window.removeEventListener("open-model-manager", handler))
  })

  // Auto-start local LLM when model is selected
  onMount(() => {
    const handler = (e: CustomEvent) => {
      const { providerID, modelID } = e.detail ?? {}
      ensureLocalLLMLoaded(providerID, modelID)
    }
    window.addEventListener("model-selected" as any, handler as any)
    onCleanup(() => window.removeEventListener("model-selected" as any, handler as any))
  })
  const connection = (): ServerConnection.Any => {
    if (props.serverInfo.variant === "embedded") {
      return {
        type: "sidecar",
        variant: "embedded",
        http: {
          url: props.serverInfo.url,
          username: props.serverInfo.username,
          password: props.serverInfo.password,
        },
      }
    }
    return {
      type: "http",
      http: { url: props.serverInfo.url },
    }
  }

  const defaultKey = () => ServerConnection.key(connection())
  const servers = () => [connection()]

  return (
    <PlatformProvider value={props.platform}>
      <AppBaseProviders>
        <AppInterface
          defaultServer={defaultKey()}
          servers={servers()}
        />
      </AppBaseProviders>
    </PlatformProvider>
  )
}

render(() => <App />, root!)
