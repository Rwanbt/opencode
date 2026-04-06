import type { Platform } from "@opencode-ai/app/context/platform"
import { fetch as tauriFetch } from "@tauri-apps/plugin-http"
import { type as osType } from "@tauri-apps/plugin-os"
import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification"
import { relaunch } from "@tauri-apps/plugin-process"
import { LazyStore } from "@tauri-apps/plugin-store"

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
  }
}
