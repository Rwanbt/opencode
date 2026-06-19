// FORK: ADR-0005 Phase 6 — Android Permissions UX + device diagnostics.
// Only shown in dialog-settings.tsx when platform.os === "android".
import { createResource, createSignal, onCleanup, Show, type Component } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { usePlatform } from "@/context/platform"
import { SettingsList } from "./settings-list"
import { SettingsRow } from "./settings-row"

function invokeTauri<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const tauri = (globalThis as any).__TAURI__
  if (!tauri?.core?.invoke) return Promise.reject(new Error("Tauri not available"))
  return tauri.core.invoke(cmd, args)
}

// ─── Thermal widget ──────────────────────────────────────────────────────────

const THERMAL_LABEL: Record<string, string> = {
  nominal: "Normal",
  fair: "Chaud",
  serious: "Très chaud",
  critical: "Critique",
}

const THERMAL_COLOR: Record<string, string> = {
  nominal: "bg-icon-success-base",
  fair: "bg-yellow-400",
  serious: "bg-orange-400",
  critical: "bg-red-500",
}

function ThermalRow() {
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
    <SettingsRow title="Température" description="État thermique du processeur / GPU">
      <div class="flex items-center gap-2">
        <div class={`w-2 h-2 rounded-full shrink-0 ${THERMAL_COLOR[thermal()] ?? "bg-text-weaker"}`} />
        <span class="text-13-regular text-text-base">{THERMAL_LABEL[thermal()] ?? thermal()}</span>
      </div>
    </SettingsRow>
  )
}

// ─── Memory widget ───────────────────────────────────────────────────────────

function MemoryRow() {
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
          <SettingsRow title="RAM" description="Mémoire vive utilisée par le système">
            <div class="flex flex-col gap-1.5 w-full max-w-[200px]">
              <div class="flex justify-between text-12-regular">
                <span class="text-text-weaker">
                  {info().used_mb} / {info().total_mb} Mo
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
      title="Stockage (All Files Access)"
      description={
        granted()
          ? `Accordé — ${(roots() ?? []).length} volume(s) accessible(s)`
          : "Requis pour accéder aux fichiers de l'espace de stockage partagé"
      }
    >
      <Show
        when={granted()}
        fallback={
          <Button size="small" onClick={openSettings}>
            Accorder
          </Button>
        }
      >
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full bg-icon-success-base" />
          <span class="text-13-regular text-text-base">Accordé</span>
        </div>
      </Show>
    </SettingsRow>
  )
}

// ─── Battery widget ──────────────────────────────────────────────────────────

function BatteryRow() {
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
          <SettingsRow title="Batterie" description={info().charging ? "En charge" : "Sur batterie"}>
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

export const SettingsAndroid: Component = () => {
  const platform = usePlatform()

  return (
    <div class="flex flex-col gap-6 px-5 py-4">
      {/* Permissions */}
      <div class="flex flex-col gap-2">
        <span class="text-12-medium text-text-weaker uppercase tracking-wider px-1">Permissions</span>
        <SettingsList>
          <StoragePermissionRow />
        </SettingsList>
        <p class="text-11-regular text-text-weaker leading-relaxed px-1">
          L'accès All Files Access est nécessaire pour que le terminal puisse lire et écrire dans le
          stockage partagé. Si le bouton ne s'ouvre pas directement, allez dans{" "}
          <span class="font-mono">Paramètres → Applications → OpenCode → Autorisations → Accès à tous les fichiers</span>.
        </p>
      </div>

      {/* Diagnostics */}
      <div class="flex flex-col gap-2">
        <span class="text-12-medium text-text-weaker uppercase tracking-wider px-1">Diagnostics</span>
        <SettingsList>
          <ThermalRow />
          <MemoryRow />
          <BatteryRow />
          <SettingsRow title="Plateforme" description="Version du système">
            <span class="text-13-regular text-text-base font-mono">
              {platform.os ?? "android"} v{platform.version ?? "—"}
            </span>
          </SettingsRow>
        </SettingsList>
      </div>
    </div>
  )
}
