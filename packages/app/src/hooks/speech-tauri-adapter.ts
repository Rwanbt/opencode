/**
 * Shared Tauri adapter for the desktop and mobile speech hooks.
 *
 * Both platforms use the same lazy `(globalThis as any).__TAURI__` shape —
 * there is no legitimate reason to copy-paste these 15 lines across two
 * packages (which we did, and they already drifted once).
 *
 * Bigger follow-up: the *.ts use-speech hooks share ~800 lines of STT/TTS
 * pipeline (MediaRecorder + blobToWavBase64 + chunked Kokoro playback) that
 * should also live here once we have time to factor it cleanly. For now we
 * at least unify the Tauri bridge itself.
 */

export function invokeTauri(cmd: string, args?: Record<string, unknown>): Promise<any> {
  const tauri = (globalThis as any).__TAURI__
  if (!tauri?.core?.invoke) return Promise.reject("Tauri not available")
  return tauri.core.invoke(cmd, args)
}

export function convertFileSrc(path: string): string {
  const tauri = (globalThis as any).__TAURI__
  if (tauri?.core?.convertFileSrc) return tauri.core.convertFileSrc(path)
  return `https://asset.localhost/${encodeURIComponent(path)}`
}
