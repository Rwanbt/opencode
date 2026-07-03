/**
 * Auto-start local LLM when a local-llm model is selected in the model picker.
 * Desktop version — uses __TAURI__ global API.
 */

import { Store } from "@tauri-apps/plugin-store"

function invokeTauri(cmd: string, args?: Record<string, unknown>): Promise<any> {
  const tauri = (globalThis as any).__TAURI__
  if (!tauri?.core?.invoke) return Promise.reject("Tauri not available")
  return tauri.core.invoke(cmd, args)
}

/**
 * Read the most recently used model from the persisted global store.
 * The app keeps it in the Tauri store "opencode.global.dat" under key "model"
 * (JSON string: { user, recent: [{providerID, modelID}], variant }). Used to
 * decide whether a launch-time local warm-up is actually wanted.
 */
async function getActiveModel(): Promise<{ providerID: string; modelID: string } | null> {
  try {
    const store = await Store.load("opencode.global.dat")
    const raw = await store.get<unknown>("model")
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
    const recent = (parsed as { recent?: Array<{ providerID?: string; modelID?: string }> } | null)?.recent
    const top = Array.isArray(recent) ? recent[0] : undefined
    if (top?.providerID && top?.modelID) return { providerID: top.providerID, modelID: top.modelID }
    return null
  } catch {
    return null
  }
}

let currentlyLoaded: string | null = null
let loading = false

/** Read LLM config from localStorage and push to Rust env vars via set_llm_config */
async function pushConfigToEnv() {
  try {
    const raw = localStorage.getItem("opencode-model-config")
    if (!raw) return
    const c = JSON.parse(raw)
    // Push the full config to the Rust side; load_llm_model() then reads
    // the resulting OPENCODE_* env vars to build llama-server args.
    await invokeTauri("set_llm_config", {
      kvCacheType: c.kvCacheType,
      flashAttn: c.flashAttn,
      offloadMode: c.offloadMode,
      mmapMode: c.mmapMode,
      accelerator: c.accelerator,
      threads: c.threads,
      nBatch: c.nBatch,
      cacheReuse: c.cacheReuse,
      topK: c.topK,
      topP: c.topP,
      temperature: c.temperature,
      systemPrompt: c.systemPrompt,
    })
    console.log("[AutoLLM] Config pushed:", {
      kvCacheType: c.kvCacheType, offloadMode: c.offloadMode, mmapMode: c.mmapMode,
      threads: c.threads, nBatch: c.nBatch, flashAttn: c.flashAttn, cacheReuse: c.cacheReuse,
      accelerator: c.accelerator,
    })
  } catch (e) {
    console.error("[AutoLLM] Failed to push config:", e)
  }
}

/** Read the draft model filename from localStorage config */
function getDraftModel(): string | null {
  try {
    const raw = localStorage.getItem("opencode-model-config")
    if (!raw) return null
    const c = JSON.parse(raw)
    return c.draftModel || null
  } catch { return null }
}

export async function ensureLocalLLMLoaded(providerID: string | undefined, modelID: string | undefined) {
  if (providerID !== "local-llm" || !modelID || loading) return

  const filename = await findGGUFFile(modelID)
  if (!filename) return
  if (currentlyLoaded === filename) return

  loading = true
  try {
    await pushConfigToEnv()
    const draftModel = getDraftModel()
    console.log("[AutoLLM] Loading model:", filename, draftModel ? `(draft: ${draftModel})` : "")
    await invokeTauri("load_llm_model", { filename, draftModel })
    currentlyLoaded = filename
    console.log("[AutoLLM] Model loaded successfully")
  } catch (e) {
    console.error("[AutoLLM] Failed to load model:", e)
  }
  loading = false
}

/**
 * On app launch, check if there are downloaded models and preload the first one.
 * This ensures the server is ready before the user sends a message.
 */
export async function autoStartLocalLLM() {
  try {
    // Only warm up a local model when the active (most-recent) model is local.
    // For cloud providers (e.g. GLM) eagerly loading gemma at launch wastes
    // CPU/disk/VRAM during the most latency-sensitive moment and slows the app
    // open. Local models still load on demand via ensureLocalLLMLoaded (the
    // "model-selected" event), so nothing is lost — it's just deferred.
    const active = await getActiveModel()
    if (!active || active.providerID !== "local-llm") {
      if (active) console.log("[AutoLLM] Skipping launch warm-up — active model is cloud:", active.providerID)
      return
    }

    const models: Array<{ filename: string; size: number }> = await invokeTauri("list_models")
    if (models.length === 0) return

    // Prefer the GGUF matching the active model; fall back to the first available.
    const filename = (await findGGUFFile(active.modelID)) ?? models[0].filename

    // Check if server is already running
    const healthy: boolean = await invokeTauri("check_llm_health", { port: null }).catch(() => false)
    if (healthy) {
      currentlyLoaded = filename
      console.log("[AutoLLM] Server already running")
      return
    }

    const draftModel = getDraftModel()
    console.log("[AutoLLM] Auto-starting active local model on launch:", filename, draftModel ? `(draft: ${draftModel})` : "")
    loading = true
    await pushConfigToEnv()
    await invokeTauri("load_llm_model", { filename, draftModel })
    currentlyLoaded = filename
    console.log("[AutoLLM] Model auto-started successfully")
  } catch (e) {
    console.error("[AutoLLM] Auto-start failed:", e)
  }
  loading = false
}

/**
 * Set up idle-unload: when all sessions become idle (session.all_idle event),
 * wait 30 seconds and then unload the model to free VRAM.
 * The timer is cancelled if a new session starts (session.status → busy).
 * Call this once from the desktop app's root component (requires GlobalSDK context).
 */
export function setupLLMIdleUnload(
  eventListen: (handler: (e: { details: { type: string } }) => void) => () => void,
): () => void {
  let idleTimer: ReturnType<typeof setTimeout> | undefined

  const unsub = eventListen((e) => {
    const type = e.details.type

    if (type === "session.all_idle") {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(async () => {
        idleTimer = undefined
        try {
          await invokeTauri("unload_llm_model")
          currentlyLoaded = null
          console.log("[AutoLLM] Model unloaded after idle timeout")
        } catch (err) {
          console.error("[AutoLLM] Failed to unload model on idle:", err)
        }
      }, 30_000)
    }

    // Cancel the timer if inference resumes (session becomes busy again)
    if (type === "session.status" && idleTimer) {
      const detail = e.details as any
      if (detail.properties?.status?.type === "busy") {
        clearTimeout(idleTimer)
        idleTimer = undefined
      }
    }
  })

  return () => {
    if (idleTimer) clearTimeout(idleTimer)
    unsub()
  }
}

async function findGGUFFile(modelName: string): Promise<string | null> {
  try {
    const models: Array<{ filename: string; size: number }> = await invokeTauri("list_models")

    // Try exact match
    const exact = models.find(m => m.filename === modelName || m.filename === modelName + ".gguf")
    if (exact) return exact.filename

    // Try matching by stripping quality markers
    const match = models.find(m => {
      const stripped = m.filename.replace(/\.gguf$/i, "").replace(/[-_]Q\d.*$/i, "")
      return stripped === modelName
    })
    return match?.filename ?? null
  } catch {
    return null
  }
}
