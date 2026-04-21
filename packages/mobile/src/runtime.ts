import { invoke } from "@tauri-apps/api/core"

export interface RuntimeInfo {
  ready: boolean
  server_running: boolean
  port: number
  extended_env: boolean
}

/** Check if the embedded runtime is extracted and server status. */
export async function checkRuntime(): Promise<RuntimeInfo> {
  try {
    return await invoke<RuntimeInfo>("check_runtime")
  } catch {
    return { ready: false, server_running: false, port: 14096, extended_env: false }
  }
}

/** Extract runtime binaries from APK assets (first launch). */
export async function extractRuntime(): Promise<void> {
  return invoke("extract_runtime")
}

/** Start the embedded OpenCode server. */
export async function startEmbeddedServer(port: number, password: string): Promise<void> {
  return invoke("start_embedded_server", { port, password })
}

/** Check if the local server is healthy. */
export async function checkLocalHealth(port: number, password?: string): Promise<boolean> {
  try {
    return await invoke<boolean>("check_local_health", { port, password: password ?? null })
  } catch {
    return false
  }
}

/** Append a line to runtime/logs/debug.log (Android only). */
export async function writeDebugLog(message: string): Promise<void> {
  try {
    await invoke("write_debug_log", { message })
  } catch {}
}

/** Stop the local server. */
export async function stopLocalServer(port: number, password?: string): Promise<void> {
  return invoke("stop_local_server", { port, password: password ?? null })
}

/** Download and install the extended environment (proot + Alpine). */
export async function installExtendedEnv(): Promise<void> {
  return invoke("install_extended_env")
}
