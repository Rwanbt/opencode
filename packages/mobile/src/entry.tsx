/* @refresh reload */
import { createSignal, Show, Switch, Match, onMount } from "solid-js"
import { render } from "solid-js/web"
import { createPlatform } from "./platform"
import { AppInterface, PlatformProvider, ServerConnection } from "@opencode-ai/app"
import { ModeSelector } from "./components/mode-selector"
import { ExtractionProgress } from "./components/extraction-progress"
import { LazyStore } from "@tauri-apps/plugin-store"

const root = document.getElementById("root")
const platform = await createPlatform()
const store = new LazyStore("settings.json")

type Mode = "selecting" | "extracting" | "connecting" | "ready"

function App() {
  const [mode, setMode] = createSignal<Mode>("selecting")
  const [server, setServer] = createSignal<ServerConnection.Any | null>(null)
  const [error, setError] = createSignal("")

  onMount(async () => {
    const saved = await store.get<string>("connectionMode")
    if (saved === "local") {
      await connectLocal()
    } else if (saved === "remote") {
      const url = await store.get<string>("defaultServerUrl")
      if (url) {
        setServer({ type: "http", http: { url }, displayName: "Remote Server" })
        setMode("ready")
      }
    }
  })

  async function connectLocal() {
    setMode("connecting")
    setError("")

    const result = await platform.startLocalServer?.()
    if (result) {
      const conn: ServerConnection.Sidecar = {
        type: "sidecar",
        variant: "embedded",
        http: { url: result.url, username: result.username, password: result.password },
        displayName: "OpenCode (Local)",
      }
      setServer(conn)
      await store.set("connectionMode", "local")
      await store.save()
      setMode("ready")
    } else {
      setError("Could not start local server.")
      setMode("selecting")
    }
  }

  function handleRemote() {
    setMode("ready")
  }

  // Reconnect local server on visibility change
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState !== "visible" || mode() !== "ready") return
      const s = server()
      if (s?.type !== "sidecar" || (s as ServerConnection.Sidecar).variant !== "embedded") return
      try {
        const res = await fetch(`${s.http.url}/global/health`, {
          headers: s.http.password
            ? { Authorization: `Basic ${btoa(`${s.http.username}:${s.http.password}`)}` }
            : {},
        })
        if (!res.ok) await connectLocal()
      } catch {
        await connectLocal()
      }
    })
  }

  return (
    <PlatformProvider value={platform}>
      <Switch>
        <Match when={mode() === "selecting"}>
          <ModeSelector
            onLocal={connectLocal}
            onRemote={handleRemote}
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
            onComplete={() => connectLocal()}
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
            <div style={{ "font-size": "18px", "font-weight": "600" }}>Starting local server...</div>
            <div style={{ color: "#888", "font-size": "14px" }}>Embedded runtime booting up</div>
          </div>
        </Match>

        <Match when={mode() === "ready"}>
          <AppInterface
            defaultServer={server() ? ServerConnection.key(server()!) : undefined}
            servers={server() ? [server()!] : []}
          />
        </Match>
      </Switch>
    </PlatformProvider>
  )
}

render(() => <App />, root!)
