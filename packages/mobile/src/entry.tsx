/* @refresh reload */
import { createSignal, Show, Switch, Match, onMount } from "solid-js"
import { render } from "solid-js/web"
import { ModeSelector } from "./components/mode-selector"
import { ExtractionProgress } from "./components/extraction-progress"

const root = document.getElementById("root")

// Hide the static loading indicator
const loadingEl = document.getElementById("loading")
if (loadingEl) loadingEl.style.display = "none"

type Mode = "selecting" | "extracting" | "connecting" | "ready"

function App() {
  const [mode, setMode] = createSignal<Mode>("selecting")
  const [error, setError] = createSignal("")

  function handleRemote() {
    // Will lazy-load platform + AppInterface when user chooses remote
    setMode("ready")
  }

  return (
    <Switch>
      <Match when={mode() === "selecting"}>
        <ModeSelector
          onLocal={() => setMode("connecting")}
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
          onComplete={() => setMode("connecting")}
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
        <div style={{
          display: "flex", "align-items": "center", "justify-content": "center",
          height: "100vh", background: "#0a0a0a", color: "#e5e5e5",
          "font-family": "system-ui, -apple-system, sans-serif",
        }}>
          <div style={{ "text-align": "center" }}>
            <div style={{ "font-size": "18px", "font-weight": "600" }}>OpenCode Connected</div>
            <div style={{ color: "#888", "font-size": "14px", "margin-top": "8px" }}>Loading interface...</div>
          </div>
        </div>
      </Match>
    </Switch>
  )
}

render(() => <App />, root!)
