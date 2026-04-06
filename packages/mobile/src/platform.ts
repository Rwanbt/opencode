import type { Platform } from "@opencode-ai/app/context/platform"
import { fetch as tauriFetch } from "@tauri-apps/plugin-http"
import { type as osType } from "@tauri-apps/plugin-os"
import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification"
import { relaunch } from "@tauri-apps/plugin-process"
import { LazyStore } from "@tauri-apps/plugin-store"
import { checkRuntime, extractRuntime, startEmbeddedServer, checkLocalHealth, stopLocalServer as stopLocal } from "./runtime"

const pkg = { version: "0.1.0" }

export async function createPlatform(): Promise<Platform> {
  const os = osType()

  // Initialize store for persistent settings
  const settingsStore = new LazyStore("settings.json")

  return {
    platform: "mobile" as any, // Extend Platform type to include "mobile"
    os: os as any,
    version: pkg.version,

    openLink(url: string) {
      // On mobile, open in system browser
      window.open(url, "_blank")
    },

    async restart() {
      await relaunch()
    },

    back() {
      window.history.back()
    },

    forward() {
      window.history.forward()
    },

    async notify(title: string, description?: string) {
      let permissionGranted = await isPermissionGranted()
      if (!permissionGranted) {
        const permission = await requestPermission()
        permissionGranted = permission === "granted"
      }
      if (permissionGranted) {
        sendNotification({ title, body: description })
      }
    },

    // No file dialogs on mobile — these are undefined
    openDirectoryPickerDialog: undefined,
    openFilePickerDialog: undefined,
    saveFilePickerDialog: undefined,

    storage(name?: string) {
      const store = name ? new LazyStore(`${name}.json`) : settingsStore
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
    },

    // Use Tauri HTTP plugin for CORS-free fetching
    fetch: tauriFetch as unknown as typeof fetch,

    async getDefaultServer() {
      const url = await settingsStore.get<string>("defaultServerUrl")
      return url ?? null
    },

    async setDefaultServer(url: string | null) {
      if (url) {
        await settingsStore.set("defaultServerUrl", url)
      } else {
        await settingsStore.delete("defaultServerUrl")
      }
      await settingsStore.save()
    },

    // ─── Termux local server (Android only) ────────────────────────

    async checkLocalAvailable() {
      if (os !== "android") return false
      const info = await checkRuntime()
      return info.ready
    },

    async startLocalServer() {
      if (os !== "android") return null

      const info = await checkRuntime()

      // Extract runtime if not ready
      if (!info.ready) {
        try {
          await extractRuntime()
        } catch {
          return null
        }
      }

      const port = info.port
      const password = crypto.randomUUID()

      // If server already running, just connect
      if (info.server_running) {
        const savedPw = await settingsStore.get<string>("localServerPassword")
        return {
          url: `http://127.0.0.1:${port}`,
          username: "opencode",
          password: savedPw ?? "",
        }
      }

      // Start embedded server
      try {
        await startEmbeddedServer(port, password)
      } catch {
        return null
      }

      // Save credentials for reconnection
      await settingsStore.set("localServerPassword", password)
      await settingsStore.set("localServerPort", port)
      await settingsStore.save()

      // Poll health check (30s timeout)
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
      const port = (await settingsStore.get<number>("localServerPort")) ?? 14096
      const password = (await settingsStore.get<string>("localServerPassword")) ?? undefined
      try {
        await stopLocal(port, password)
      } catch {
        // Server may already be stopped
      }
    },
  }
}
