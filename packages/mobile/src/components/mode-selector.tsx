import { createSignal, Show } from "solid-js"
import { Logo } from "@unifia/ui/logo"

interface Props {
  onLocal: () => void
  onRemote: () => void
  onExtract: () => void
}

export function ModeSelector(props: Props) {
  // Detect Android via user agent — no Tauri plugin import needed
  const isAndroid = /android/i.test(navigator.userAgent)

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
      {/* scheme is pinned: this screen paints its own dark canvas above and runs
          before the theme preload sets data-color-scheme. */}
      <Logo scheme="dark" style={{ width: "200px", height: "auto" }} />
      {/* The wordmark is baked into the logo artwork, so the heading stays in
          the DOM for screen readers. This shell has no Tailwind, hence the
          inline visually-hidden rule rather than a utility class. */}
      <h1 style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        Unifia
      </h1>
      <p style={{ color: "#888", "text-align": "center", margin: "0", "max-width": "320px" }}>
        Choose how to connect to the AI coding agent
      </p>

      <div style={{ display: "flex", "flex-direction": "column", gap: "16px", width: "100%", "max-width": "320px" }}>
        {/* Local mode — Android only */}
        <Show when={isAndroid}>
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
              Run AI agent directly on your phone
            </div>
          </button>
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
            Connect to Unifia running on your PC
          </div>
        </button>

      </div>
    </div>
  )
}
