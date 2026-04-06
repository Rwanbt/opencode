import { createSignal, onMount, onCleanup } from "solid-js"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { extractRuntime } from "../runtime"

interface Props {
  onComplete: () => void
  onError: (msg: string) => void
}

interface ProgressEvent {
  phase: string
  progress: number
}

export function ExtractionProgress(props: Props) {
  const [phase, setPhase] = createSignal("Preparing runtime...")
  const [progress, setProgress] = createSignal(0)
  const [error, setError] = createSignal("")
  let unlisten: UnlistenFn | undefined

  onMount(async () => {
    // Listen for progress events from Rust
    unlisten = await listen<ProgressEvent>("extraction-progress", (event) => {
      setPhase(event.payload.phase)
      setProgress(Math.round(event.payload.progress * 100))
    })

    try {
      await extractRuntime()
      props.onComplete()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      props.onError(msg)
    }
  })

  onCleanup(() => {
    unlisten?.()
  })

  const barWidth = () => `${progress()}%`

  return (
    <div style={{
      display: "flex",
      "flex-direction": "column",
      "align-items": "center",
      "justify-content": "center",
      height: "100vh",
      padding: "32px",
      gap: "24px",
      "font-family": "system-ui, -apple-system, sans-serif",
      background: "#0a0a0a",
      color: "#e5e5e5",
    }}>
      <h1 style={{ "font-size": "24px", "font-weight": "700", margin: "0" }}>
        OpenCode
      </h1>

      <p style={{ color: "#888", "font-size": "15px", margin: "0", "text-align": "center" }}>
        Setting up the embedded runtime...
      </p>

      {/* Progress bar */}
      <div style={{
        width: "100%",
        "max-width": "300px",
        height: "8px",
        "border-radius": "4px",
        background: "#1a1a1a",
        overflow: "hidden",
      }}>
        <div style={{
          width: barWidth(),
          height: "100%",
          "border-radius": "4px",
          background: "#3b82f6",
          transition: "width 0.3s ease",
        }} />
      </div>

      <p style={{ color: "#666", "font-size": "13px", margin: "0" }}>
        {phase()} {progress() > 0 ? `(${progress()}%)` : ""}
      </p>

      {error() && (
        <div style={{
          padding: "12px 16px",
          "border-radius": "8px",
          background: "#7f1d1d",
          color: "#fca5a5",
          "font-size": "13px",
          "max-width": "300px",
          "text-align": "center",
        }}>
          {error()}
        </div>
      )}

      <p style={{ color: "#444", "font-size": "12px", margin: "0", "text-align": "center" }}>
        First launch only — this extracts Bun, Git, and tools (~15 seconds)
      </p>
    </div>
  )
}
