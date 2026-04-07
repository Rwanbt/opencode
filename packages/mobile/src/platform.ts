import type { Platform } from "@opencode-ai/app"
import { checkRuntime, extractRuntime, startEmbeddedServer, checkLocalHealth, stopLocalServer as stopLocal } from "./runtime"

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

    // File pickers — use Tauri dialog plugin for native Android picker
    async openDirectoryPickerDialog(opts) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog")
        const result = await open({
          directory: true,
          multiple: opts?.multiple ?? false,
          title: opts?.title ?? "Choose folder",
        })
        if (!result) return null
        return result
      } catch {
        return null
      }
    },

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

    fetch: (plugins?.http?.fetch as unknown as typeof fetch) ?? window.fetch.bind(window),

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
      console.log("[OpenCode] startLocalServer: checking runtime...")
      const info = await checkRuntime()
      console.log("[OpenCode] runtime info:", JSON.stringify(info))

      if (!info.ready) {
        console.log("[OpenCode] runtime not ready, extracting...")
        try { await extractRuntime() } catch (e) {
          console.error("[OpenCode] extract failed:", e)
          throw new Error(`Extract failed: ${e}`)
        }
      }

      const port = info.port
      const password = crypto.randomUUID()

      if (info.server_running) {
        const savedPw = await settings.getItem("localServerPassword")
        return { url: `http://127.0.0.1:${port}`, username: "opencode", password: savedPw ?? "" }
      }

      console.log("[OpenCode] starting embedded server on port", port)
      try {
        await startEmbeddedServer(port, password)
      } catch (e) {
        console.error("[OpenCode] startEmbeddedServer failed:", e)
        throw new Error(`Server start failed: ${e}`)
      }

      await settings.setItem("localServerPassword", password)
      await settings.setItem("localServerPort", String(port))

      console.log("[OpenCode] waiting for health check...")
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        if (await checkLocalHealth(port, password)) {
          console.log("[OpenCode] server healthy!")
          return { url: `http://127.0.0.1:${port}`, username: "opencode", password }
        }
      }
      console.error("[OpenCode] health check timed out after 30s")
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
