// FORK: ADR-0005 Phase 6 — Android Permissions UX + device diagnostics.
// Only shown in dialog-settings.tsx when platform.os === "android".
import { createResource, createSignal, onCleanup, Show, type Component } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { SettingsList } from "./settings-list"
import { SettingsRow } from "./settings-row"

function invokeTauri<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const tauri = (globalThis as any).__TAURI__
  if (!tauri?.core?.invoke) return Promise.reject(new Error("Tauri not available"))
  return tauri.core.invoke(cmd, args)
}

// ─── Thermal widget ──────────────────────────────────────────────────────────

const THERMAL_LABEL: Record<string, string> = {
  nominal: "settings.fork.android.thermalNormal",
  fair: "settings.fork.android.thermalFair",
  serious: "settings.fork.android.thermalSerious",
  critical: "settings.fork.android.thermalCritical",
}

const THERMAL_COLOR: Record<string, string> = {
  nominal: "bg-icon-success-base",
  fair: "bg-yellow-400",
  serious: "bg-orange-400",
  critical: "bg-red-500",
}

function ThermalRow() {
  const language = useLanguage()
  const [thermal, setThermal] = createSignal<"nominal" | "fair" | "serious" | "critical">("nominal")

  const poll = async () => {
    try {
      const state = await invokeTauri<string>("get_thermal_state")
      setThermal(state as "nominal" | "fair" | "serious" | "critical")
    } catch {
      /* unavailable */
    }
  }

  poll()
  const id = setInterval(poll, 15_000)
  onCleanup(() => clearInterval(id))

  return (
    <SettingsRow title={language.t("settings.fork.android.temperature")} description={language.t("settings.fork.android.temperatureDescription")}>
      <div class="flex items-center gap-2">
        <div class={`w-2 h-2 rounded-full shrink-0 ${THERMAL_COLOR[thermal()] ?? "bg-text-weaker"}`} />
        <span class="text-13-regular text-text-base">{(() => {
          const state = thermal()
          const key = THERMAL_LABEL[state]
          return key ? language.t(key as Parameters<typeof language.t>[0]) : state
        })()}</span>
      </div>
    </SettingsRow>
  )
}

// ─── Memory widget ───────────────────────────────────────────────────────────

function MemoryRow() {
  const language = useLanguage()
  const [mem, setMem] = createSignal<{ total_mb: number; available_mb: number; used_mb: number } | null>(null)

  ;(async () => {
    try {
      const info = await invokeTauri<{ total_mb: number; available_mb: number; used_mb: number }>("get_memory_info")
      setMem(info)
    } catch {
      /* unavailable on desktop */
    }
  })()

  return (
    <Show when={mem()}>
      {(info) => {
        const pct = () => Math.round((info().used_mb / info().total_mb) * 100)
        return (
          <SettingsRow title={language.t("settings.fork.android.ram")} description={language.t("settings.fork.android.ramDescription")}>
            <div class="flex flex-col gap-1.5 w-full max-w-[200px]">
              <div class="flex justify-between text-12-regular">
                <span class="text-text-weaker">
                  {info().used_mb} / {info().total_mb} {language.t("settings.fork.android.megabytes")}
                </span>
                <span class="text-text-weak">{pct()}%</span>
              </div>
              <div class="w-full h-1.5 bg-surface-inset rounded-full overflow-hidden">
                <div
                  class="h-full rounded-full transition-all"
                  classList={{
                    "bg-icon-success-base": pct() < 70,
                    "bg-yellow-400": pct() >= 70 && pct() < 90,
                    "bg-red-500": pct() >= 90,
                  }}
                  style={{ width: `${pct()}%` }}
                />
              </div>
            </div>
          </SettingsRow>
        )
      }}
    </Show>
  )
}

// ─── Storage permission widget ───────────────────────────────────────────────

function StoragePermissionRow() {
  const language = useLanguage()
  const platform = usePlatform()
  const [roots] = createResource(async () => {
    try {
      return (await platform.listStorageRoots?.()) ?? []
    } catch {
      return []
    }
  })

  const granted = () => (roots() ?? []).length > 0

  const openSettings = () => {
    // Opens the app's system settings page where the user can manage permissions.
    // On Android, no standard content:// URI works without an intent; instead we
    // try the package details deep-link supported by most launchers.
    platform.openLink?.("content://com.android.settings.application.APP_STORAGE_SETTINGS") ??
      platform.openLink("https://support.google.com/android/answer/9064445")
  }

  return (
    <SettingsRow
      title={language.t("settings.fork.android.storage")}
      description={
        granted()
          ? language.t("settings.fork.android.grantedVolumes", { count: (roots() ?? []).length })
          : language.t("settings.fork.android.storageRequired")
      }
    >
      <Show
        when={granted()}
        fallback={
          <Button size="small" onClick={openSettings}>
            {language.t("settings.fork.android.grant")}
          </Button>
        }
      >
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full bg-icon-success-base" />
          <span class="text-13-regular text-text-base">{language.t("settings.fork.android.granted")}</span>
        </div>
      </Show>
    </SettingsRow>
  )
}

// ─── Battery widget ──────────────────────────────────────────────────────────

function BatteryRow() {
  const language = useLanguage()
  const [battery, setBattery] = createSignal<{ level: number; charging: boolean } | null>(null)

  ;(async () => {
    try {
      // Web Battery API — available in Chromium/WebView
      const b = await (navigator as any).getBattery?.()
      if (!b) return
      setBattery({ level: b.level, charging: b.charging })
      b.addEventListener("levelchange", () => setBattery({ level: b.level, charging: b.charging }))
      b.addEventListener("chargingchange", () => setBattery({ level: b.level, charging: b.charging }))
    } catch {
      /* unavailable */
    }
  })()

  return (
    <Show when={battery()}>
      {(info) => {
        const pct = () => Math.round(info().level * 100)
        return (
          <SettingsRow title={language.t("settings.fork.android.battery")} description={info().charging ? language.t("settings.fork.android.charging") : language.t("settings.fork.android.onBattery")}>
            <div class="flex items-center gap-2">
              <div class="w-2 h-2 rounded-full shrink-0 bg-icon-success-base" classList={{ "bg-yellow-400": pct() < 30, "bg-red-500": pct() < 15 }} />
              <span class="text-13-regular text-text-base">{pct()}%</span>
              <Show when={info().charging}>
                <span class="text-11-regular text-text-weaker">⚡</span>
              </Show>
            </div>
          </SettingsRow>
        )
      }}
    </Show>
  )
}

// ─── Main export ─────────────────────────────────────────────────────────────

// ─── Disk quota widget ───────────────────────────────────────────────────────

const WARN_BYTES = 500 * 1024 * 1024 // 500 MB

function DiskRow() {
  const language = useLanguage()
  const sdk = useSDK()
  const fmtBytes = (n: number) => {
    if (n < 0) return "—"
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)} ${language.t("settings.fork.android.gigabytes")}`
    return `${(n / 1e6).toFixed(0)} ${language.t("settings.fork.android.megabytes")}`
  }
  const [disk] = createResource<{ available: number; total: number } | null>(async () => {
    try {
      const res = await fetch(`${sdk.url}/disk?directory=${encodeURIComponent(sdk.directory)}`)
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  })

  return (
    <Show when={disk()}>
      {(d) => (
        <SettingsRow
          title={language.t("settings.fork.android.disk")}
          description={language.t("settings.fork.android.diskAvailable", { available: fmtBytes(d().available), total: fmtBytes(d().total) })}
        >
          <Show
            when={d().available >= 0 && d().available < WARN_BYTES}
            fallback={
              <span class="text-11-regular text-[#22c55e]">{fmtBytes(d().available)} {language.t("settings.fork.android.diskFree")}</span>
            }
          >
            <span class="text-11-regular text-[#ef4444] font-medium">
              ⚠ {fmtBytes(d().available)} — {language.t("settings.fork.android.diskLow")}
            </span>
          </Show>
        </SettingsRow>
      )}
    </Show>
  )
}

export const SettingsAndroid: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()

  return (
    <div class="flex flex-col gap-6 px-5 py-4">
      {/* Permissions */}
      <div class="flex flex-col gap-2">
        <span class="text-12-medium text-text-weaker uppercase tracking-wider px-1">{language.t("settings.fork.android.permissions")}</span>
        <SettingsList>
          <StoragePermissionRow />
        </SettingsList>
        <p class="text-11-regular text-text-weaker leading-relaxed px-1">
          {language.t("settings.fork.android.allFilesHint")} <span class="font-mono">{language.t("settings.fork.android.allFilesPath")}</span>.
        </p>
      </div>

      {/* Diagnostics */}
      <div class="flex flex-col gap-2">
        <span class="text-12-medium text-text-weaker uppercase tracking-wider px-1">{language.t("settings.fork.android.diagnostics")}</span>
        <SettingsList>
          <ThermalRow />
          <MemoryRow />
          <DiskRow />
          <BatteryRow />
          <SettingsRow title={language.t("settings.fork.android.platformLabel")} description={language.t("settings.fork.android.platformDescription")}>
            <span class="text-13-regular text-text-base font-mono">
              {platform.os ?? "android"} v{platform.version ?? "—"}
            </span>
          </SettingsRow>
        </SettingsList>
      </div>
    </div>
  )
}
