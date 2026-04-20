import type { Platform } from "@opencode-ai/app"
import { checkRuntime, extractRuntime, startEmbeddedServer, checkLocalHealth, stopLocalServer as stopLocal, writeDebugLog } from "./runtime"

// Fingerprint du serveur privé (reçu via QR en mode Internet).
// Quand défini, les requêtes HTTPS passent par la commande Rust
// fetch_private_server qui accepte les certs self-signed.
let _privateFp: string | null = null

export function setPrivateServerFp(fp: string | null) {
  _privateFp = fp
}

// IPs RFC1918 + loopback + IPv6 ULA. Utilisé comme fallback quand l'utilisateur
// arrive sur une URL HTTPS LAN sans avoir transité par le deep link `opencode://`
// (cas typique : scan via Google Lens / scanner tiers qui ne route pas les
// schemes custom — l'utilisateur copie-colle l'URL HTTPS à la main, donc fp
// jamais transmis). Sans cette détection, le tauri-plugin-http rejette le cert
// self-signed et l'erreur affichée est un opaque "impossible de joindre".
function isPrivateHostUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase()
    return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost$|::1$|fc|fd)/.test(h)
  } catch {
    return false
  }
}

type PrivateFetchMsg =
  | { kind: "Headers"; status: number; headers: Record<string, string> }
  | { kind: "Chunk"; data: number[] | Uint8Array }
  | { kind: "End" }
  | { kind: "Error"; message: string }

// Fetch routed through the Rust `fetch_private_server` command, which accepts
// self-signed TLS certs. Body is streamed back chunk-by-chunk via a Tauri
// `Channel`, then plumbed into a `ReadableStream` so SSE / chat tokens flow
// incrementally — a buffered text() variant starved the SDK reader and chat
// responses never appeared even though POST /prompt_async returned 200.
async function privateFetch(url: string, init: RequestInit | undefined, input: RequestInfo | URL): Promise<Response> {
  const { invoke, Channel } = await import("@tauri-apps/api/core")
  const channel = new Channel<PrivateFetchMsg>()
  const requestHeaders = Object.fromEntries(
    new Headers(init?.headers ?? (input instanceof Request ? input.headers : {})).entries(),
  )
  const method = init?.method ?? (input instanceof Request ? input.method : "GET")
  // Body extraction must handle both init.body (raw fetch(url, init) calls)
  // AND Request.body (the SDK builds a `new Request(url, fetchOptions)` and
  // calls fetch(request) — in that case `init` is undefined). Without the
  // Request branch, every POST went through with an empty body and the
  // server replied 400 — the chat send "échoue" came from this.
  let body: string | undefined
  if (typeof init?.body === "string") {
    body = init.body
  } else if (input instanceof Request) {
    try {
      const t = await input.clone().text()
      if (t.length > 0) body = t
    } catch {}
  }

  return await new Promise<Response>((resolve, reject) => {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null
    const pending: Uint8Array[] = []
    let closeMode: "open" | "end" | { error: Error } = "open"
    let headersReceived = false

    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
        for (const chunk of pending) c.enqueue(chunk)
        pending.length = 0
        if (closeMode === "end") c.close()
        else if (typeof closeMode === "object") c.error(closeMode.error)
      },
      cancel() {
        controller = null
      },
    })

    channel.onmessage = (msg) => {
      if (msg.kind === "Headers") {
        if (headersReceived) return
        headersReceived = true
        resolve(new Response(stream, { status: msg.status, headers: msg.headers }))
        return
      }
      if (msg.kind === "Chunk") {
        const arr = msg.data instanceof Uint8Array ? msg.data : new Uint8Array(msg.data as any)
        if (controller) controller.enqueue(arr)
        else pending.push(arr)
        return
      }
      if (msg.kind === "End") {
        if (controller) controller.close()
        else closeMode = "end"
        return
      }
      if (msg.kind === "Error") {
        const err = new Error(msg.message)
        if (controller) controller.error(err)
        else closeMode = { error: err }
        if (!headersReceived) {
          headersReceived = true
          reject(err)
        }
      }
    }

    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    if (signal) {
      const onAbort = () => {
        if (!headersReceived) {
          headersReceived = true
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"))
        }
        try { controller?.error(signal.reason ?? new DOMException("Aborted", "AbortError")) } catch {}
        controller = null
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener("abort", onAbort, { once: true })
    }

    invoke("fetch_private_server", {
      url,
      method,
      headers: requestHeaders,
      body,
      onEvent: channel,
    }).catch((e: unknown) => {
      const err = e instanceof Error ? e : new Error(String(e))
      if (!headersReceived) {
        headersReceived = true
        reject(err)
      }
      try { controller?.error(err) } catch {}
    })
  })
}

const pkg = { version: "0.1.0" }

// Lazy-load Tauri plugins to prevent crash if not available
async function loadPlugins() {
  try {
    const [http, os, notification, process, store, clipboard] = await Promise.all([
      import("@tauri-apps/plugin-http").catch(() => null),
      import("@tauri-apps/plugin-os").catch(() => null),
      import("@tauri-apps/plugin-notification").catch(() => null),
      import("@tauri-apps/plugin-process").catch(() => null),
      import("@tauri-apps/plugin-store").catch(() => null),
      import("@tauri-apps/plugin-clipboard-manager").catch(() => null),
    ])
    return { http, os, notification, process, store, clipboard }
  } catch {
    return null
  }
}

export async function createPlatform(): Promise<Platform> {
  const plugins = await loadPlugins()
  const os = plugins?.os?.type?.() ?? "android"

  // Create store with fallback to localStorage
  function createStore(name: string) {
    if (plugins?.store) {
      const { LazyStore } = plugins.store
      return new LazyStore(`${name}.json`)
    }
    return null
  }

  const settingsStore = createStore("settings")

  // Storage adapter — uses Tauri Store or falls back to localStorage
  function makeStorage(store: ReturnType<typeof createStore>) {
    if (store) {
      return {
        async getItem(key: string) {
          return (await store.get<string>(key)) ?? null
        },
        async setItem(key: string, value: string) {
          await store.set(key, value)
          await store.save()
        },
        async removeItem(key: string) {
          await store.delete(key)
          await store.save()
        },
      }
    }
    // Fallback to localStorage
    return {
      async getItem(key: string) { return localStorage.getItem(key) },
      async setItem(key: string, value: string) { localStorage.setItem(key, value) },
      async removeItem(key: string) { localStorage.removeItem(key) },
    }
  }

  const settings = makeStorage(settingsStore)

  // Capture la référence fetch une seule fois, exactement comme l'original.
  // Cela préserve le binding et le contexte du plugin Tauri HTTP.
  const _baseFetch = (plugins?.http?.fetch as unknown as typeof fetch) ?? window.fetch.bind(window)

  return {
    platform: "mobile" as any,
    os: os as any,
    version: pkg.version,

    openLink(url: string) {
      window.open(url, "_blank")
    },

    async restart() {
      if (plugins?.process?.relaunch) {
        await plugins.process.relaunch()
      } else {
        window.location.reload()
      }
    },

    back() { window.history.back() },
    forward() { window.history.forward() },

    // Smart notifications — only show when app is not focused
    async notify(title: string, description?: string) {
      if (!plugins?.notification) return
      // Don't notify if user is actively looking at the app
      if (document.hasFocus()) return
      let granted = await plugins.notification.isPermissionGranted()
      if (!granted) {
        const perm = await plugins.notification.requestPermission()
        granted = perm === "granted"
      }
      if (granted) {
        plugins.notification.sendNotification({ title, body: description })
      }
    },

    // Clipboard image reading — same approach as desktop
    async readClipboardImage() {
      if (!plugins?.clipboard?.readImage) return null
      try {
        const image = await plugins.clipboard.readImage()
        if (!image) return null
        const bytes = await image.rgba()
        const size = await image.size()
        // Convert RGBA bytes to PNG via canvas
        const canvas = document.createElement("canvas")
        canvas.width = size.width
        canvas.height = size.height
        const ctx = canvas.getContext("2d")
        if (!ctx) return null
        const imageData = ctx.createImageData(size.width, size.height)
        imageData.data.set(new Uint8ClampedArray(bytes))
        ctx.putImageData(imageData, 0, 0)
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
        if (!blob) return null
        return new File([blob], `pasted-image-${Date.now()}.png`, { type: "image/png" })
      } catch {
        return null
      }
    },

    // openDirectoryPickerDialog is intentionally NOT defined on mobile.
    // The Tauri Android dialog plugin does not actually support directory
    // selection — it returns null silently. Leaving this property undefined
    // makes the frontend (home.tsx / layout.tsx) fall through to the in-app
    // DialogSelectDirectory, which uses the opencode-cli /file API.

    // List navigable storage roots on Android (internal storage, SD cards,
    // OTG drives, opencode home). The dialog uses these as starting points
    // since Android sandboxes /storage/ from direct enumeration.
    async listStorageRoots() {
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        return await invoke<Array<{ path: string; label: string }>>("list_storage_roots")
      } catch {
        return []
      }
    },

    // File pickers — Tauri Android supports files (not directories)
    async openFilePickerDialog(opts) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog")
        const filters = opts?.extensions?.length
          ? [{ name: "Files", extensions: opts.extensions }]
          : undefined
        const result = await open({
          directory: false,
          multiple: opts?.multiple ?? false,
          title: opts?.title ?? "Choose file",
          filters,
        })
        if (!result) return null
        return result
      } catch {
        return null
      }
    },

    async saveFilePickerDialog(opts) {
      try {
        const { save } = await import("@tauri-apps/plugin-dialog")
        const result = await save({
          title: opts?.title ?? "Save file",
          defaultPath: opts?.defaultPath,
        })
        return result ?? null
      } catch {
        return null
      }
    },

    storage(name?: string) {
      return makeStorage(name ? createStore(name) : settingsStore)
    },

    fetch: (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url
      // Routage via la commande Rust fetch_private_server (accept_invalid_certs)
      // dans deux cas :
      //   1. fp pinning explicite reçu via deep link `opencode://...&fp=...`
      //   2. fallback HTTPS vers IP privée RFC1918 sans fp (scan QR via scanner
      //      tiers qui ne route pas les schemes custom — l'utilisateur a copié
      //      l'URL à la main). Sans ce fallback, l'erreur est silencieuse et
      //      affiche "impossible de joindre".
      const isHttps = /^https:\/\//.test(url)
      const usePrivateFetch = isHttps && (_privateFp || isPrivateHostUrl(url))
      if (usePrivateFetch) {
        return privateFetch(url, init, input)
      }
      // Chemin normal : utilise la référence _baseFetch capturée à la création
      // du platform (identique au code original avant les modifications C1).
      return _baseFetch(input as any, init)
    },

    async getDefaultServer() {
      return ((await settings.getItem("defaultServerUrl")) ?? null) as any
    },

    async setDefaultServer(url: any) {
      if (url) {
        await settings.setItem("defaultServerUrl", url)
      } else {
        await settings.removeItem("defaultServerUrl")
      }
    },

    // ─── Embedded runtime (Android only) ────────────────────────────

    async checkLocalAvailable() {
      if (os !== "android") return false
      const info = await checkRuntime()
      return info.ready
    },

    async startLocalServer() {
      if (os !== "android") return null
      await writeDebugLog("startLocalServer: checking runtime...")
      const info = await checkRuntime()
      await writeDebugLog(`checkRuntime: ready=${info.ready} server_running=${info.server_running} port=${info.port}`)

      if (!info.ready) {
        await writeDebugLog("runtime not ready, extracting...")
        try { await extractRuntime() } catch (e) {
          await writeDebugLog(`extract failed: ${e}`)
          throw new Error(`Extract failed: ${e}`)
        }
      }

      // Note: installExtendedEnv (Alpine rootfs + advanced tools) is
      // handled by ExtractionProgress component at first launch, so it's
      // done before this point when needed. No action here.

      const port = info.port

      if (info.server_running) {
        const savedPw = await settings.getItem("localServerPassword")
        await writeDebugLog(`server_running=true savedPw=${savedPw ? savedPw.slice(0,8)+"..." : "null"}`)
        if (savedPw) {
          await writeDebugLog(`returning cached: url=http://127.0.0.1:${port} pw=${savedPw.slice(0,8)}...`)
          return { url: `http://127.0.0.1:${port}`, username: "opencode", password: savedPw }
        }
        await writeDebugLog("server running but no saved password, restarting...")
        try { await stopLocal(port) } catch {}
      }

      const password = crypto.randomUUID()
      await writeDebugLog(`fresh start: port=${port} pw=${password.slice(0,8)}...`)
      // Save password BEFORE starting server to avoid race conditions
      await settings.setItem("localServerPassword", password)
      await settings.setItem("localServerPort", String(port))

      try {
        await startEmbeddedServer(port, password)
        await writeDebugLog("startEmbeddedServer OK")
      } catch (e) {
        await writeDebugLog(`startEmbeddedServer FAILED: ${e}`)
        throw new Error(`Server start failed: ${e}`)
      }

      await writeDebugLog("waiting for health check (30s)...")
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        const healthy = await checkLocalHealth(port, password)
        await writeDebugLog(`checkLocalHealth(${i+1}): ${healthy}`)
        if (healthy) {
          await writeDebugLog(`returning: url=http://127.0.0.1:${port} pw=${password.slice(0,8)}...`)
          return { url: `http://127.0.0.1:${port}`, username: "opencode", password }
        }
      }
      await writeDebugLog("health check timed out after 30s")
      return null
    },

    async stopLocalServer() {
      if (os !== "android") return
      const portStr = await settings.getItem("localServerPort")
      const port = portStr ? Number(portStr) : 14096
      const password = (await settings.getItem("localServerPassword")) ?? undefined
      try { await stopLocal(port, password) } catch {}
    },
  }
}
