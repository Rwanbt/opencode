import { invoke } from "@tauri-apps/api/core"

export interface TermuxInfo {
  installed: boolean
  server_running: boolean
  port: number
  bun_available: boolean
}

/** Check if Termux is installed and if a local server is running. */
export async function checkTermux(): Promise<TermuxInfo> {
  try {
    return await invoke<TermuxInfo>("check_termux")
  } catch {
    return { installed: false, server_running: false, port: 14096, bun_available: false }
  }
}

/** Launch the OpenCode server inside Termux via Android intent. */
export async function launchTermuxServer(port: number, password: string): Promise<void> {
  return invoke("launch_termux_server", { port, password })
}

/** Check if the local server is healthy. */
export async function checkLocalHealth(port: number, password?: string): Promise<boolean> {
  try {
    return await invoke<boolean>("check_local_health", { port, password: password ?? null })
  } catch {
    return false
  }
}

/** Open Termux app for manual setup. */
export async function openTermuxSetup(): Promise<void> {
  return invoke("open_termux_setup")
}

/** Stop the local OpenCode server. */
export async function stopLocalServer(port: number, password?: string): Promise<void> {
  return invoke("stop_local_server", { port, password: password ?? null })
}

/** The bootstrap command users should run in Termux to install everything. */
export const TERMUX_BOOTSTRAP_CMD =
  "pkg update -y && pkg install -y git && curl -fsSL https://bun.sh/install | bash && source ~/.bashrc && bun i -g opencode-ai"
