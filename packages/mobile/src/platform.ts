import type { Platform } from "@opencode-ai/app"
import { checkRuntime, extractRuntime, startEmbeddedServer, checkLocalHealth, stopLocalServer as stopLocal } from "./runtime"

const pkg = { version: "0.1.0" }

// Lazy-load Tauri plugins to prevent crash if not available
async function loadPlugins() {
  try {
    const [http, os, notification, process, store] = await Promise.all([
      import("@tauri-apps/plugin-http").catch(() => null),
      import("@tauri-apps/plugin-os").catch(() => null),
      import("@tauri-apps/plugin-notification").catch(() => null),
      import("@tauri-apps/plugin-process").catch(() => null),
      import("@tauri-apps/plugin-store").catch(() => null),
    ])
    return { http, os, notification, process, store }
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

    async notify(title: string, description?: string) {
      if (!plugins?.notification) return
      let granted = await plugins.notification.isPermissionGranted()
      if (!granted) {
        const perm = await plugins.notification.requestPermission()
        granted = perm === "granted"
      }
      if (granted) {
        plugins.notification.sendNotification({ title, body: description })
      }
    },

    openDirectoryPickerDialog: undefined,
    openFilePickerDialog: undefined,
    saveFilePickerDialog: undefined,

    storage(name?: string) {
      return makeStorage(name ? createStore(name) : settingsStore)
    },

    fetch: (plugins?.http?.fetch as unknown as typeof fetch) ?? window.fetch.bind(window),

    async getDefaultServer() {
      return (await settings.getItem("defaultServerUrl")) ?? null
    },

    async setDefaultServer(url: string | null) {
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
      const info = await checkRuntime()

      if (!info.ready) {
        try { await extractRuntime() } catch { return null }
      }

      const port = info.port
      const password = crypto.randomUUID()

      if (info.server_running) {
        const savedPw = await settings.getItem("localServerPassword")
        return { url: `http://127.0.0.1:${port}`, username: "opencode", password: savedPw ?? "" }
      }

      try { await startEmbeddedServer(port, password) } catch { return null }

      await settings.setItem("localServerPassword", password)
      await settings.setItem("localServerPort", String(port))

      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        if (await checkLocalHealth(port, password)) {
          return { url: `http://127.0.0.1:${port}`, username: "opencode", password }
        }
      }
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
