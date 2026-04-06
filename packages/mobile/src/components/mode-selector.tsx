import { createSignal, Show, onMount } from "solid-js"
import { type as osType } from "@tauri-apps/plugin-os"
import { checkRuntime, type RuntimeInfo } from "../runtime"

interface Props {
  onLocal: () => void
  onRemote: () => void
  onExtract: () => void
}

export function ModeSelector(props: Props) {
  const os = osType()
  const isAndroid = os === "android"
  const [runtimeInfo, setRuntimeInfo] = createSignal<RuntimeInfo | null>(null)
  const [checking, setChecking] = createSignal(true)

  onMount(async () => {
    if (isAndroid) {
      const info = await checkRuntime()
      setRuntimeInfo(info)
    }
    setChecking(false)
  })

  return (
    <div style={{
      display: "flex",
      "flex-direction": "column",
      "align-items": "center",
      "justify-content": "center",
      height: "100vh",
      padding: "24px",
      gap: "24px",
      "font-family": "system-ui, -apple-system, sans-serif",
      background: "#0a0a0a",
      color: "#e5e5e5",
    }}>
      <h1 style={{ "font-size": "28px", "font-weight": "700", margin: "0" }}>
        OpenCode
      </h1>
      <p style={{ color: "#888", "text-align": "center", margin: "0", "max-width": "320px" }}>
        Choose how to connect to the AI coding agent
      </p>

      <div style={{ display: "flex", "flex-direction": "column", gap: "16px", width: "100%", "max-width": "320px" }}>
        {/* Local mode — Android only */}
        <Show when={isAndroid && !checking()}>
          <Show
            when={runtimeInfo()?.ready}
            fallback={
              <button
                onClick={props.onExtract}
                style={{
                  padding: "16px 24px",
                  "border-radius": "12px",
                  border: "1px solid #3b82f6",
                  background: "#1e3a5f",
                  color: "#e5e5e5",
                  "font-size": "16px",
                  cursor: "pointer",
                  "text-align": "left",
                }}
              >
                <div style={{ "font-weight": "600" }}>Local Mode</div>
                <div style={{ "font-size": "13px", color: "#94a3b8", "margin-top": "4px" }}>
                  Set up embedded runtime (~15 seconds, one-time)
                </div>
              </button>
            }
          >
            <button
              onClick={props.onLocal}
              style={{
                padding: "16px 24px",
                "border-radius": "12px",
                border: "1px solid #3b82f6",
                background: "#1e3a5f",
                color: "#e5e5e5",
                "font-size": "16px",
                cursor: "pointer",
                "text-align": "left",
              }}
            >
              <div style={{ "font-weight": "600" }}>
                Local Mode
                <Show when={runtimeInfo()?.server_running}>
                  <span style={{ color: "#22c55e", "margin-left": "8px", "font-size": "13px" }}>running</span>
                </Show>
              </div>
              <div style={{ "font-size": "13px", color: "#94a3b8", "margin-top": "4px" }}>
                Run AI agent directly on your phone
              </div>
            </button>
          </Show>
        </Show>

        {/* Remote mode — always available */}
        <button
          onClick={props.onRemote}
          style={{
            padding: "16px 24px",
            "border-radius": "12px",
            border: "1px solid #333",
            background: "#1a1a1a",
            color: "#e5e5e5",
            "font-size": "16px",
            cursor: "pointer",
            "text-align": "left",
          }}
        >
          <div style={{ "font-weight": "600" }}>Remote Server</div>
          <div style={{ "font-size": "13px", color: "#888", "margin-top": "4px" }}>
            Connect to OpenCode running on your PC
          </div>
        </button>
      </div>
    </div>
  )
}
