import { type Component, Show, createMemo, createResource, createSignal } from "solid-js"
import QRCode from "qrcode"
import { Button } from "@opencode-ai/ui/button"
import { Select } from "@opencode-ai/ui/select"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SettingsList } from "./settings-list"
import { SettingsRow } from "./settings-row"

// Extracted from settings-general.tsx (D-04): self-contained remote-access /
// pairing panel. Re-acquires its contexts via hooks so it needs no props.
export const SettingsRemoteAccess: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()

  const [info, setInfo] = createSignal<{
    enabled: boolean
    password: string
    username: string
    port: number
    lanIp: string | null
    tlsEnabled: boolean
    tlsFingerprint?: string
  }>()
  const [reveal, setReveal] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [dirty, setDirty] = createSignal(false)
  const [editUsername, setEditUsername] = createSignal("")
  const [editPassword, setEditPassword] = createSignal("")
  const [editingCredentials, setEditingCredentials] = createSignal(false)

  void platform.getRemoteAccess?.().then(setInfo)

  const mode = () => {
    const data = info()
    if (!data || !data.enabled) return "local"
    return data.tlsEnabled ? "internet" : "lan"
  }

  const modeOptions = () => [
    {
      value: "local" as const,
      label: language.t("settings.desktop.remote.mode.local"),
    },
    {
      value: "lan" as const,
      label: language.t("settings.desktop.remote.mode.lan"),
    },
    {
      value: "internet" as const,
      label: language.t("settings.desktop.remote.mode.internet"),
    },
  ]

  const onModeSelect = (next: "local" | "lan" | "internet") => {
    if (busy()) return
    const data = info()
    if (!data) return

    if (next === mode()) return

    setBusy(true)

    const doUpdate = () => {
      if (next === "internet") {
        return platform.setInternetModeEnabled?.(true)
      }
      if (next === "lan") {
        // Disable TLS if previously in Internet mode, then enable remote.
        if (data.tlsEnabled) {
          return platform.setInternetModeEnabled?.(false)
        }
        return platform.setRemoteAccessEnabled?.(true)
      }
      // local
      return platform.setRemoteAccessEnabled?.(false)
    }

    doUpdate()
      ?.then((updated) => {
        if (updated) setInfo(updated)
        setDirty(true)
      })
      .catch((err: unknown) => {
        showToast({
          variant: "error",
          icon: "circle-x",
          title: "Failed to update remote access",
          description: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => setBusy(false))
  }

  const onResetPassword = () => {
    if (busy()) return
    setBusy(true)
    platform
      .resetRemoteAccessPassword?.()
      .then((updated) => {
        if (updated) setInfo(updated)
        setDirty(true)
      })
      .catch((err: unknown) => {
        showToast({
          variant: "error",
          icon: "circle-x",
          title: "Failed to reset remote password",
          description: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => setBusy(false))
  }

  const onSaveCredentials = () => {
    if (busy()) return
    const u = editUsername().trim()
    const p = editPassword().trim()
    if (!u && !p) return
    setBusy(true)
    platform
      .setRemoteCredentials?.(u, p)
      .then((updated) => {
        if (updated) setInfo(updated)
        setEditUsername("")
        setEditPassword("")
        setEditingCredentials(false)
        setDirty(true)
      })
      .catch((err: unknown) => {
        showToast({
          variant: "error",
          icon: "circle-x",
          title: "Failed to save credentials",
          description: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => setBusy(false))
  }

  const onExportCert = () => {
    if (busy()) return
    setBusy(true)
    platform
      .exportTlsCert?.()
      .then((path) => {
        showToast({
          variant: "default",
          icon: "check",
          title: "Certificate exported",
          description: path,
        })
      })
      .catch((err: unknown) => {
        showToast({
          variant: "error",
          icon: "circle-x",
          title: "Failed to export certificate",
          description: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => setBusy(false))
  }

  const onRotateCert = () => {
    if (busy()) return
    setBusy(true)
    platform
      .rotateTlsCert?.()
      .then((updated) => {
        if (updated) setInfo(updated)
        setDirty(true)
        showToast({
          variant: "default",
          icon: "check",
          title: "Certificate rotated",
          description: "A new certificate has been generated. Restart and re-install it on all clients.",
        })
      })
      .catch((err: unknown) => {
        showToast({
          variant: "error",
          icon: "circle-x",
          title: "Failed to rotate certificate",
          description: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => setBusy(false))
  }

  const connectionUrl = () => {
    const data = info()
    if (!data || !data.enabled || !data.lanIp) return undefined
    const scheme = data.tlsEnabled ? "https" : "http"
    return `${scheme}://${data.lanIp}:${data.port}`
  }

  const maskedPassword = (pw: string) => "•".repeat(Math.min(pw.length, 24))

  // The host to embed in the pairing QR:
  //   - LAN/Internet mode with a detected IP  → that IP (works over Wi-Fi / internet)
  //   - Local mode (or LAN w/o IP)            → loopback (works over USB via `adb reverse`)
  const pairingHost = () => {
    const data = info()
    if (!data) return undefined
    if (data.enabled && data.lanIp) return data.lanIp
    return "localhost"
  }

  const pairingDeepLink = createMemo(() => {
    const data = info()
    const host = pairingHost()
    if (!data || !host || !data.password) return undefined
    const scheme = data.tlsEnabled ? "https" : "http"
    const url = `${scheme}://${host}:${data.port}`
    const params = new URLSearchParams({
      url,
      user: data.username,
      pwd: data.password,
    })
    // Include TLS fingerprint so the client can pin the cert.
    if (data.tlsEnabled && data.tlsFingerprint) {
      params.set("fp", data.tlsFingerprint)
    }
    return `opencode://connect?${params.toString()}`
  })

  // Border color for QR container: green = LAN, orange = Internet, neutral = local
  const qrBorderClass = () => {
    const m = mode()
    if (m === "internet") return "border-orange-400"
    if (m === "lan") return "border-green-500"
    return "border-border"
  }

  const [qrSvg] = createResource(pairingDeepLink, async (link) => {
    if (!link) return undefined
    try {
      return await QRCode.toString(link, {
        type: "svg",
        // Use H (high) error correction when Internet mode to accommodate potential logo overlay
        errorCorrectionLevel: mode() === "internet" ? "H" : "M",
        margin: 1,
        width: 160,
        color: { dark: "#ffffff", light: "#00000000" },
      })
    } catch {
      return undefined
    }
  })

  return (
    <Show when={platform.getRemoteAccess}>
      <div class="flex flex-col gap-1">
        <h3 class="text-14-medium text-text-strong pb-2">
          {language.t("settings.desktop.section.remote")}
        </h3>

        <SettingsList>
          <SettingsRow
            title={language.t("settings.desktop.remote.mode.title")}
            description={language.t("settings.desktop.remote.mode.description")}
          >
            <Select
              data-action="settings-remote-mode"
              options={modeOptions()}
              current={modeOptions().find((o) => o.value === mode())}
              value={(o) => o.value}
              label={(o) => o.label}
              onSelect={(option) => {
                if (!option) return
                onModeSelect(option.value)
              }}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.desktop.remote.password.title")}
            description={language.t("settings.desktop.remote.password.description")}
          >
            <div class="flex flex-col gap-2">
              {/* Current credentials display */}
              <div class="flex items-center gap-2">
                <span class="text-12-regular text-text-weak font-mono">
                  {info() ? info()!.username : "…"}
                  {" / "}
                </span>
                <span class="text-12-regular text-text-weak font-mono select-all">
                  {info() ? (reveal() ? info()!.password : maskedPassword(info()!.password)) : "…"}
                </span>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => setReveal(!reveal())}
                  disabled={!info()}
                >
                  {reveal()
                    ? language.t("settings.desktop.remote.password.hide")
                    : language.t("settings.desktop.remote.password.reveal")}
                </Button>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={onResetPassword}
                  disabled={busy() || !info()}
                >
                  {language.t("settings.desktop.remote.password.reset")}
                </Button>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => {
                    setEditUsername(info()?.username ?? "")
                    setEditPassword("")
                    setEditingCredentials(!editingCredentials())
                  }}
                  disabled={!info()}
                >
                  Personnaliser
                </Button>
              </div>
              {/* Inline editor */}
              <Show when={editingCredentials()}>
                <div class="flex flex-col gap-1.5 rounded-md border border-border-weak-base bg-surface-panel p-2">
                  <div class="flex items-center gap-2">
                    <span class="text-11-regular text-text-weak w-20 shrink-0">{language.t("settings.fork.remote.username")}</span>
                    <input
                      class="flex-1 text-12-regular bg-transparent border border-border-weak-base rounded px-2 py-1 text-text-strong font-mono outline-none focus:border-border-base"
                      value={editUsername()}
                      onInput={(e) => setEditUsername(e.currentTarget.value)}
                      placeholder={info()?.username ?? "opencode"}
                      autocomplete="off"
                      spellcheck={false}
                    />
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-11-regular text-text-weak w-20 shrink-0">{language.t("settings.fork.remote.password")}</span>
                    <input
                      class="flex-1 text-12-regular bg-transparent border border-border-weak-base rounded px-2 py-1 text-text-strong font-mono outline-none focus:border-border-base"
                      value={editPassword()}
                      onInput={(e) => setEditPassword(e.currentTarget.value)}
                      placeholder={language.t("settings.fork.remote.newPassword")}
                      type="password"
                      autocomplete="new-password"
                    />
                  </div>
                  <div class="flex gap-2 justify-end">
                    <Button variant="secondary" size="small" onClick={() => setEditingCredentials(false)}>
                      Annuler
                    </Button>
                    <Button
                      variant="primary"
                      size="small"
                      onClick={onSaveCredentials}
                      disabled={busy() || (!editUsername().trim() && !editPassword().trim())}
                    >
                      Sauvegarder
                    </Button>
                  </div>
                </div>
              </Show>
            </div>
          </SettingsRow>

          <Show when={info()?.enabled}>
            <SettingsRow
              title={language.t("settings.desktop.remote.connection.title")}
              description={language.t("settings.desktop.remote.connection.description")}
            >
              <Show
                when={connectionUrl()}
                fallback={
                  <span class="text-12-regular text-text-weak">
                    {language.t("settings.desktop.remote.connection.noLan")}
                  </span>
                }
              >
                <span class="text-12-regular font-mono text-text-strong select-all">
                  {connectionUrl()}
                </span>
              </Show>
            </SettingsRow>
          </Show>


          {/* Internet (TLS) mode — certificate management */}
          <Show when={mode() === "internet"}>
            <SettingsRow
              title={language.t("settings.desktop.remote.tls.fingerprint.title")}
              description={language.t("settings.desktop.remote.tls.fingerprint.description")}
            >
              <span class="text-10-regular font-mono text-text-weak select-all break-all max-w-[220px]">
                {info()?.tlsFingerprint ?? "…"}
              </span>
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.desktop.remote.tls.export.button")}
              description={language.t("settings.desktop.remote.tls.export.description")}
            >
              <Button
                variant="secondary"
                size="small"
                onClick={onExportCert}
                disabled={busy()}
              >
                {language.t("settings.desktop.remote.tls.export.button")}
              </Button>
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.desktop.remote.tls.rotate.button")}
              description={language.t("settings.desktop.remote.tls.rotate.description")}
            >
              <Button
                variant="secondary"
                size="small"
                onClick={onRotateCert}
                disabled={busy()}
              >
                {language.t("settings.desktop.remote.tls.rotate.button")}
              </Button>
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.desktop.remote.tls.portForward.title")}
              description={language.t("settings.desktop.remote.tls.portForward.description")}
            >
              <span class="text-12-regular font-mono text-text-strong select-all">
                {info()?.port ?? "…"}
              </span>
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.desktop.remote.tls.android.title")}
              description={language.t("settings.desktop.remote.tls.android.description")}
            >
              <Button
                variant="secondary"
                size="small"
                onClick={onExportCert}
                disabled={busy()}
              >
                {language.t("settings.desktop.remote.tls.export.button")}
              </Button>
            </SettingsRow>
          </Show>

          <SettingsRow
            title={language.t("settings.desktop.remote.pair.title")}
            description={
              info()?.enabled
                ? language.t("settings.desktop.remote.pair.descriptionLan")
                : language.t("settings.desktop.remote.pair.descriptionLocal")
            }
          >
            <Show
              when={qrSvg()}
              fallback={
                <span class="text-12-regular text-text-weak">
                  {language.t("settings.desktop.remote.pair.unavailable")}
                </span>
              }
            >
              <div class="flex flex-col items-center gap-1">
                <div
                  class={`rounded-lg border-2 bg-background-elevated p-2 flex items-center justify-center [&_svg]:block ${qrBorderClass()}`}
                  style={{ width: "176px", height: "176px" }}
                  // qrcode returns a self-contained <svg> string, safe to inject.
                  innerHTML={qrSvg()!}
                />
                <Show when={connectionUrl()}>
                  <span class="text-10-regular text-text-weak font-mono truncate max-w-[176px]">
                    {connectionUrl()}
                  </span>
                </Show>
              </div>
            </Show>
          </SettingsRow>
        </SettingsList>

        <div class="flex flex-col gap-1 pt-2">
          <Show when={dirty()}>
            <span class="text-12-regular text-text-accent">
              {language.t("settings.desktop.remote.restartRequired")}
            </span>
          </Show>
          <Show when={mode() === "internet"}>
            <span class="text-11-regular text-text-weak">
              {language.t("settings.desktop.remote.warning.internet")}
            </span>
          </Show>
          <Show when={mode() === "lan"}>
            <span class="text-11-regular text-text-weak">
              {language.t("settings.desktop.remote.warning")}
            </span>
          </Show>
          <Show when={(mode() === "lan" || mode() === "internet") && navigator.platform.toLowerCase().includes("win")}>
            <span class="text-11-regular text-text-weak">
              {language.t("settings.desktop.remote.warning.firewall")}
            </span>
          </Show>
          <Show when={(mode() === "lan" || mode() === "internet") && !info()?.lanIp}>
            <span class="text-11-regular text-text-accent">
              {language.t("settings.desktop.remote.connection.manualHint")}
            </span>
          </Show>
        </div>
      </div>
    </Show>
  )
}
