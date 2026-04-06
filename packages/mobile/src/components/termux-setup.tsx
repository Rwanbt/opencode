import { createSignal, Show } from "solid-js"
import { openTermuxSetup, checkTermux, TERMUX_BOOTSTRAP_CMD } from "../termux"

interface Props {
  onComplete: () => void
  onBack: () => void
}

export function TermuxSetup(props: Props) {
  const [step, setStep] = createSignal(1)
  const [copied, setCopied] = createSignal(false)
  const [checking, setChecking] = createSignal(false)
  const [error, setError] = createSignal("")

  async function copyBootstrap() {
    try {
      await navigator.clipboard.writeText(TERMUX_BOOTSTRAP_CMD)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: select text
    }
  }

  async function openTermux() {
    try {
      await openTermuxSetup()
    } catch {
      setError("Could not open Termux. Is it installed?")
    }
  }

  async function verify() {
    setChecking(true)
    setError("")
    const info = await checkTermux()
    setChecking(false)
    if (info.installed && info.bun_available) {
      props.onComplete()
    } else if (!info.installed) {
      setError("Termux not detected. Please install it from F-Droid.")
    } else {
      setError("Bun/OpenCode not found in Termux. Run the setup command first.")
    }
  }

  const sectionStyle = {
    padding: "16px",
    "border-radius": "12px",
    background: "#1a1a1a",
    border: "1px solid #333",
  }

  return (
    <div style={{
      display: "flex",
      "flex-direction": "column",
      height: "100vh",
      padding: "24px",
      gap: "20px",
      "font-family": "system-ui, -apple-system, sans-serif",
      background: "#0a0a0a",
      color: "#e5e5e5",
      "overflow-y": "auto",
    }}>
      <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
        <button
          onClick={props.onBack}
          style={{ background: "none", border: "none", color: "#888", "font-size": "18px", cursor: "pointer", padding: "4px" }}
        >
          &larr;
        </button>
        <h1 style={{ "font-size": "22px", "font-weight": "700", margin: "0" }}>
          Termux Setup
        </h1>
      </div>

      {/* Step 1: Install Termux */}
      <div style={sectionStyle}>
        <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-bottom": "8px" }}>
          <span style={{
            width: "24px", height: "24px", "border-radius": "50%",
            background: step() >= 1 ? "#3b82f6" : "#333",
            display: "flex", "align-items": "center", "justify-content": "center",
            "font-size": "13px", "font-weight": "700",
          }}>1</span>
          <span style={{ "font-weight": "600" }}>Install Termux</span>
        </div>
        <p style={{ color: "#888", "font-size": "14px", margin: "0 0 12px 0" }}>
          Download Termux from F-Droid (NOT Google Play — that version is outdated).
        </p>
        <button
          onClick={() => { window.open("https://f-droid.org/packages/com.termux/", "_blank"); setStep(2) }}
          style={{
            padding: "10px 16px", "border-radius": "8px",
            background: "#3b82f6", border: "none", color: "white",
            "font-size": "14px", cursor: "pointer",
          }}
        >
          Open F-Droid
        </button>
      </div>

      {/* Step 2: Run bootstrap command */}
      <div style={sectionStyle}>
        <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-bottom": "8px" }}>
          <span style={{
            width: "24px", height: "24px", "border-radius": "50%",
            background: step() >= 2 ? "#3b82f6" : "#333",
            display: "flex", "align-items": "center", "justify-content": "center",
            "font-size": "13px", "font-weight": "700",
          }}>2</span>
          <span style={{ "font-weight": "600" }}>Install Bun + OpenCode</span>
        </div>
        <p style={{ color: "#888", "font-size": "14px", margin: "0 0 8px 0" }}>
          Open Termux and paste this command:
        </p>
        <div style={{
          background: "#0d1117", padding: "12px", "border-radius": "8px",
          "font-family": "monospace", "font-size": "12px", color: "#c9d1d9",
          "word-break": "break-all", "margin-bottom": "8px",
        }}>
          {TERMUX_BOOTSTRAP_CMD}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={copyBootstrap}
            style={{
              padding: "8px 12px", "border-radius": "8px",
              background: "#333", border: "none", color: "#e5e5e5",
              "font-size": "13px", cursor: "pointer",
            }}
          >
            {copied() ? "Copied!" : "Copy"}
          </button>
          <button
            onClick={() => { openTermux(); setStep(3) }}
            style={{
              padding: "8px 12px", "border-radius": "8px",
              background: "#333", border: "none", color: "#e5e5e5",
              "font-size": "13px", cursor: "pointer",
            }}
          >
            Open Termux
          </button>
        </div>
      </div>

      {/* Step 3: Enable external apps */}
      <div style={sectionStyle}>
        <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-bottom": "8px" }}>
          <span style={{
            width: "24px", height: "24px", "border-radius": "50%",
            background: step() >= 3 ? "#3b82f6" : "#333",
            display: "flex", "align-items": "center", "justify-content": "center",
            "font-size": "13px", "font-weight": "700",
          }}>3</span>
          <span style={{ "font-weight": "600" }}>Allow External Apps</span>
        </div>
        <p style={{ color: "#888", "font-size": "14px", margin: "0 0 8px 0" }}>
          In Termux, run this to allow OpenCode to start the server:
        </p>
        <div style={{
          background: "#0d1117", padding: "12px", "border-radius": "8px",
          "font-family": "monospace", "font-size": "12px", color: "#c9d1d9",
        }}>
          echo "allow-external-apps=true" >> ~/.termux/termux.properties
        </div>
      </div>

      {/* Step 4: Verify */}
      <div style={sectionStyle}>
        <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-bottom": "8px" }}>
          <span style={{
            width: "24px", height: "24px", "border-radius": "50%",
            background: step() >= 4 ? "#22c55e" : "#333",
            display: "flex", "align-items": "center", "justify-content": "center",
            "font-size": "13px", "font-weight": "700",
          }}>4</span>
          <span style={{ "font-weight": "600" }}>Verify Setup</span>
        </div>
        <button
          onClick={() => { setStep(4); verify() }}
          disabled={checking()}
          style={{
            padding: "10px 16px", "border-radius": "8px",
            background: "#22c55e", border: "none", color: "white",
            "font-size": "14px", cursor: "pointer",
            opacity: checking() ? "0.6" : "1",
          }}
        >
          {checking() ? "Checking..." : "Verify Installation"}
        </button>
        <Show when={error()}>
          <p style={{ color: "#ef4444", "font-size": "13px", margin: "8px 0 0 0" }}>
            {error()}
          </p>
        </Show>
      </div>
    </div>
  )
}
