import { createSimpleContext } from "@opencode-ai/ui/context"
import type { AsyncStorage, SyncStorage } from "@solid-primitives/storage"
import type { Accessor } from "solid-js"
import { ServerConnection } from "./server"

type PickerPaths = string | string[] | null
type OpenDirectoryPickerOptions = { title?: string; multiple?: boolean }
type OpenFilePickerOptions = { title?: string; multiple?: boolean; accept?: string[]; extensions?: string[] }
type SaveFilePickerOptions = { title?: string; defaultPath?: string }
type UpdateInfo = { updateAvailable: boolean; version?: string }

export type Platform = {
  /** Platform discriminator */
  platform: "web" | "desktop" | "mobile"

  /** OS (Tauri desktop/mobile) */
  os?: "macos" | "windows" | "linux" | "ios" | "android"

  /** App version */
  version?: string

  /** Open a URL in the default browser */
  openLink(url: string): void

  /** Open a local path in a local app (desktop only) */
  openPath?(path: string, app?: string): Promise<void>

  /** Restart the app  */
  restart(): Promise<void>

  /** Navigate back in history */
  back(): void

  /** Navigate forward in history */
  forward(): void

  /** Send a system notification (optional deep link) */
  notify(title: string, description?: string, href?: string): Promise<void>

  /** Open directory picker dialog (native on Tauri, server-backed on web) */
  openDirectoryPickerDialog?(opts?: OpenDirectoryPickerOptions): Promise<PickerPaths>

  /**
   * List navigable storage roots (Android only).
   * Returns an array of {path, label} entries the user can browse from
   * (internal storage, SD cards, OTG drives, app home). Used by
   * DialogSelectDirectory to bootstrap navigation when /storage/ itself
   * cannot be enumerated due to Android sandbox restrictions.
   */
  listStorageRoots?(): Promise<Array<{ path: string; label: string }>>

  /** Open native file picker dialog (Tauri only) */
  openFilePickerDialog?(opts?: OpenFilePickerOptions): Promise<PickerPaths>

  /** Save file picker dialog (Tauri only) */
  saveFilePickerDialog?(opts?: SaveFilePickerOptions): Promise<string | null>

  /** Storage mechanism, defaults to localStorage */
  storage?: (name?: string) => SyncStorage | AsyncStorage

  /** Check for updates (Tauri only) */
  checkUpdate?(): Promise<UpdateInfo>

  /** Install updates (Tauri only) */
  update?(): Promise<void>

  /** Fetch override */
  fetch?: typeof fetch

  /** Get the configured default server URL (platform-specific) */
  getDefaultServer?(): Promise<ServerConnection.Key | null>

  /** Set the default server URL to use on app startup (platform-specific) */
  setDefaultServer?(url: ServerConnection.Key | null): Promise<void> | void

  /** Get the configured WSL integration (desktop only) */
  getWslEnabled?(): Promise<boolean>

  /** Set the configured WSL integration (desktop only) */
  setWslEnabled?(config: boolean): Promise<void> | void

  /** Read the persisted remote-access config (desktop only) */
  getRemoteAccess?(): Promise<RemoteAccessInfo>

  /** Enable or disable LAN remote access; takes effect on next launch (desktop only) */
  setRemoteAccessEnabled?(enabled: boolean): Promise<RemoteAccessInfo>

  /** Regenerate the remote-access password; takes effect on next launch (desktop only) */
  resetRemoteAccessPassword?(): Promise<RemoteAccessInfo>

  /** Get the preferred display backend (desktop only) */
  getDisplayBackend?(): Promise<DisplayBackend | null> | DisplayBackend | null

  /** Set the preferred display backend (desktop only) */
  setDisplayBackend?(backend: DisplayBackend): Promise<void>

  /** Parse markdown to HTML using native parser (desktop only, returns unprocessed code blocks) */
  parseMarkdown?(markdown: string): Promise<string>

  /** Webview zoom level (desktop only) */
  webviewZoom?: Accessor<number>

  /** Check if an editor app exists (desktop only) */
  checkAppExists?(appName: string): Promise<boolean>

  /** Read image from clipboard (desktop only) */
  readClipboardImage?(): Promise<File | null>

  /** Check if local CLI execution is available (Android Termux) */
  checkLocalAvailable?(): Promise<boolean>

  /** Start a local CLI server (Android Termux via Termux) */
  startLocalServer?(): Promise<{ url: string; username: string; password: string } | null>

  /** Stop the local CLI server */
  stopLocalServer?(): Promise<void>
}

export type DisplayBackend = "auto" | "wayland"

export type RemoteAccessInfo = {
  enabled: boolean
  password: string
  port: number
  lanIp: string | null
}

export const { use: usePlatform, provider: PlatformProvider } = createSimpleContext({
  name: "Platform",
  init: (props: { value: Platform }) => {
    return props.value
  },
})
