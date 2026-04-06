/* @refresh reload */
import { createSignal, Show, Switch, Match, onMount } from "solid-js"
import { render } from "solid-js/web"
import { createPlatform } from "./platform"
import { AppInterface } from "@opencode-ai/app"
import { PlatformProvider } from "@opencode-ai/app/context/platform"
import { type ServerConnection } from "@opencode-ai/app/context/server"
import { ModeSelector } from "./components/mode-selector"
import { TermuxSetup } from "./components/termux-setup"
import { LazyStore } from "@tauri-apps/plugin-store"

const root = document.getElementById("root")
const platform = await createPlatform()
const store = new LazyStore("settings.json")

type Mode = "selecting" | "setup" | "connecting" | "local" | "remote" | "ready"

function App() {
  const [mode, setMode] = createSignal<Mode>("selecting")
  const [server, setServer] = createSignal<ServerConnection.Any | null>(null)
  const [error, setError] = createSignal("")

  // Check for saved mode on mount
  onMount(async () => {
    const saved = await store.get<string>("connectionMode")
    if (saved === "local") {
      await connectLocal()
    } else if (saved === "remote") {
      const url = await store.get<string>("defaultServerUrl")
      if (url) {
        setServer({
          type: "http",
          http: { url },
          displayName: "Remote Server",
        })
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
        variant: "termux",
        http: { url: result.url, username: result.username, password: result.password },
        displayName: "OpenCode (Local)",
      }
      setServer(conn)
      await store.set("connectionMode", "local")
      await store.save()
      setMode("ready")
    } else {
      setError("Could not start local server. Check Termux setup.")
      setMode("selecting")
    }
  }

  function handleRemote() {
    // For remote, we rely on the existing RemoteConnect component inside AppInterface
    // Set a placeholder server that AppInterface will replace via its connection flow
    setMode("remote")
  }

  // Handle visibility change — reconnect local server if needed
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState === "visible" && mode() === "ready" && server()?.type === "sidecar") {
        const s = server() as ServerConnection.Sidecar
        if (s.variant === "termux") {
          try {
            const res = await fetch(`${s.http.url}/global/health`, {
              headers: s.http.password
                ? { Authorization: `Basic ${btoa(`${s.http.username}:${s.http.password}`)}` }
                : {},
            })
            if (!res.ok) {
              setError("Local server disconnected. Reconnecting...")
              await connectLocal()
            }
          } catch {
            setError("Local server unreachable. Reconnecting...")
            await connectLocal()
          }
        }
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
            onSetup={() => setMode("setup")}
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

        <Match when={mode() === "setup"}>
          <TermuxSetup
            onComplete={() => { setMode("selecting") }}
            onBack={() => setMode("selecting")}
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
            <div style={{ color: "#888", "font-size": "14px" }}>Waiting for Termux to respond</div>
          </div>
        </Match>

        <Match when={mode() === "ready" || mode() === "remote"}>
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
