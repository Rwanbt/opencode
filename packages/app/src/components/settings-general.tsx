import { Component, Show, createMemo, createResource, createSignal, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import QRCode from "qrcode"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Select } from "@opencode-ai/ui/select"
import { Switch } from "@opencode-ai/ui/switch"
import { TextField } from "@opencode-ai/ui/text-field"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useTheme, type ColorScheme } from "@opencode-ai/ui/theme/context"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import {
  monoDefault,
  monoFontFamily,
  monoInput,
  sansDefault,
  sansFontFamily,
  sansInput,
  useSettings,
} from "@/context/settings"
import { playSoundById, SOUND_OPTIONS } from "@/utils/sound"
import { Link } from "./link"
import { SettingsList } from "./settings-list"

let demoSoundState = {
  cleanup: undefined as (() => void) | undefined,
  timeout: undefined as NodeJS.Timeout | undefined,
  run: 0,
}

type ThemeOption = {
  id: string
  name: string
}

// To prevent audio from overlapping/playing very quickly when navigating the settings menus,
// delay the playback by 100ms during quick selection changes and pause existing sounds.
const stopDemoSound = () => {
  demoSoundState.run += 1
  if (demoSoundState.cleanup) {
    demoSoundState.cleanup()
  }
  clearTimeout(demoSoundState.timeout)
  demoSoundState.cleanup = undefined
}

const playDemoSound = (id: string | undefined) => {
  stopDemoSound()
  if (!id) return

  const run = ++demoSoundState.run
  demoSoundState.timeout = setTimeout(() => {
    void playSoundById(id).then((cleanup) => {
      if (demoSoundState.run !== run) {
        cleanup?.()
        return
      }
      demoSoundState.cleanup = cleanup
    })
  }, 100)
}

export const SettingsGeneral: Component = () => {
  const theme = useTheme()
  const language = useLanguage()
  const platform = usePlatform()
  const settings = useSettings()

  onMount(() => {
    void theme.loadThemes()
  })

  const [store, setStore] = createStore({
    checking: false,
  })

  const linux = createMemo(() => platform.platform === "desktop" && platform.os === "linux")

  const check = () => {
    if (!platform.checkUpdate) return
    setStore("checking", true)

    void platform
      .checkUpdate()
      .then((result) => {
        if (!result.updateAvailable) {
          showToast({
            variant: "success",
            icon: "circle-check",
            title: language.t("settings.updates.toast.latest.title"),
            description: language.t("settings.updates.toast.latest.description", { version: platform.version ?? "" }),
          })
          return
        }

        const actions =
          platform.update && platform.restart
            ? [
                {
                  label: language.t("toast.update.action.installRestart"),
                  onClick: async () => {
                    await platform.update!()
                    await platform.restart!()
                  },
                },
                {
                  label: language.t("toast.update.action.notYet"),
                  onClick: "dismiss" as const,
                },
              ]
            : [
                {
                  label: language.t("toast.update.action.notYet"),
                  onClick: "dismiss" as const,
                },
              ]

        showToast({
          persistent: true,
          icon: "download",
          title: language.t("toast.update.title"),
          description: language.t("toast.update.description", { version: result.version ?? "" }),
          actions,
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
      .finally(() => setStore("checking", false))
  }

  const themeOptions = createMemo<ThemeOption[]>(() => theme.ids().map((id) => ({ id, name: theme.name(id) })))

  const colorSchemeOptions = createMemo((): { value: ColorScheme; label: string }[] => [
    { value: "system", label: language.t("theme.scheme.system") },
    { value: "light", label: language.t("theme.scheme.light") },
    { value: "dark", label: language.t("theme.scheme.dark") },
  ])

  const languageOptions = createMemo(() =>
    language.locales.map((locale) => ({
      value: locale,
      label: language.label(locale),
    })),
  )

  const noneSound = { id: "none", label: "sound.option.none" } as const
  const soundOptions = [noneSound, ...SOUND_OPTIONS]
  const mono = () => monoInput(settings.appearance.font())
  const sans = () => sansInput(settings.appearance.uiFont())

  const soundSelectProps = (
    enabled: () => boolean,
    current: () => string,
    setEnabled: (value: boolean) => void,
    set: (id: string) => void,
  ) => ({
    options: soundOptions,
    current: enabled() ? (soundOptions.find((o) => o.id === current()) ?? noneSound) : noneSound,
    value: (o: (typeof soundOptions)[number]) => o.id,
    label: (o: (typeof soundOptions)[number]) => language.t(o.label),
    onHighlight: (option: (typeof soundOptions)[number] | undefined) => {
      if (!option) return
      playDemoSound(option.id === "none" ? undefined : option.id)
    },
    onSelect: (option: (typeof soundOptions)[number] | undefined) => {
      if (!option) return
      if (option.id === "none") {
        setEnabled(false)
        stopDemoSound()
        return
      }
      setEnabled(true)
      set(option.id)
      playDemoSound(option.id)
    },
    variant: "secondary" as const,
    size: "small" as const,
    triggerVariant: "settings" as const,
  })

  const GeneralSection = () => (
    <div class="flex flex-col gap-1">
      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.row.language.title")}
          description={language.t("settings.general.row.language.description")}
        >
          <Select
            data-action="settings-language"
            options={languageOptions()}
            current={languageOptions().find((o) => o.value === language.locale())}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(option) => option && language.setLocale(option.value)}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.reasoningSummaries.title")}
          description={language.t("settings.general.row.reasoningSummaries.description")}
        >
          <div data-action="settings-feed-reasoning-summaries">
            <Switch
              checked={settings.general.showReasoningSummaries()}
              onChange={(checked) => settings.general.setShowReasoningSummaries(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.shellToolPartsExpanded.title")}
          description={language.t("settings.general.row.shellToolPartsExpanded.description")}
        >
          <div data-action="settings-feed-shell-tool-parts-expanded">
            <Switch
              checked={settings.general.shellToolPartsExpanded()}
              onChange={(checked) => settings.general.setShellToolPartsExpanded(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.editToolPartsExpanded.title")}
          description={language.t("settings.general.row.editToolPartsExpanded.description")}
        >
          <div data-action="settings-feed-edit-tool-parts-expanded">
            <Switch
              checked={settings.general.editToolPartsExpanded()}
              onChange={(checked) => settings.general.setEditToolPartsExpanded(checked)}
            />
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const AppearanceSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.appearance")}</h3>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.row.colorScheme.title")}
          description={language.t("settings.general.row.colorScheme.description")}
        >
          <Select
            data-action="settings-color-scheme"
            options={colorSchemeOptions()}
            current={colorSchemeOptions().find((o) => o.value === theme.colorScheme())}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(option) => option && theme.setColorScheme(option.value)}
            onHighlight={(option) => {
              if (!option) return
              theme.previewColorScheme(option.value)
              return () => theme.cancelPreview()
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
            triggerStyle={{ "min-width": "220px" }}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.theme.title")}
          description={
            <>
              {language.t("settings.general.row.theme.description")}{" "}
              <Link href="https://opencode.ai/docs/themes/">{language.t("common.learnMore")}</Link>
            </>
          }
        >
          <Select
            data-action="settings-theme"
            options={themeOptions()}
            current={themeOptions().find((o) => o.id === theme.themeId())}
            value={(o) => o.id}
            label={(o) => o.name}
            onSelect={(option) => {
              if (!option) return
              theme.setTheme(option.id)
            }}
            onHighlight={(option) => {
              if (!option) return
              theme.previewTheme(option.id)
              return () => theme.cancelPreview()
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.uiFont.title")}
          description={language.t("settings.general.row.uiFont.description")}
        >
          <div class="w-full sm:w-[220px]">
            <TextField
              data-action="settings-ui-font"
              label={language.t("settings.general.row.uiFont.title")}
              hideLabel
              type="text"
              value={sans()}
              onChange={(value) => settings.appearance.setUIFont(value)}
              placeholder={sansDefault}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              class="text-12-regular"
              style={{ "font-family": sansFontFamily(settings.appearance.uiFont()) }}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.font.title")}
          description={language.t("settings.general.row.font.description")}
        >
          <div class="w-full sm:w-[220px]">
            <TextField
              data-action="settings-code-font"
              label={language.t("settings.general.row.font.title")}
              hideLabel
              type="text"
              value={mono()}
              onChange={(value) => settings.appearance.setFont(value)}
              placeholder={monoDefault}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              class="text-12-regular"
              style={{ "font-family": monoFontFamily(settings.appearance.font()) }}
            />
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const NotificationsSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.notifications")}</h3>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.notifications.agent.title")}
          description={language.t("settings.general.notifications.agent.description")}
        >
          <div data-action="settings-notifications-agent">
            <Switch
              checked={settings.notifications.agent()}
              onChange={(checked) => settings.notifications.setAgent(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.notifications.permissions.title")}
          description={language.t("settings.general.notifications.permissions.description")}
        >
          <div data-action="settings-notifications-permissions">
            <Switch
              checked={settings.notifications.permissions()}
              onChange={(checked) => settings.notifications.setPermissions(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.notifications.errors.title")}
          description={language.t("settings.general.notifications.errors.description")}
        >
          <div data-action="settings-notifications-errors">
            <Switch
              checked={settings.notifications.errors()}
              onChange={(checked) => settings.notifications.setErrors(checked)}
            />
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const SoundsSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.sounds")}</h3>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.sounds.agent.title")}
          description={language.t("settings.general.sounds.agent.description")}
        >
          <Select
            data-action="settings-sounds-agent"
            {...soundSelectProps(
              () => settings.sounds.agentEnabled(),
              () => settings.sounds.agent(),
              (value) => settings.sounds.setAgentEnabled(value),
              (id) => settings.sounds.setAgent(id),
            )}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.sounds.permissions.title")}
          description={language.t("settings.general.sounds.permissions.description")}
        >
          <Select
            data-action="settings-sounds-permissions"
            {...soundSelectProps(
              () => settings.sounds.permissionsEnabled(),
              () => settings.sounds.permissions(),
              (value) => settings.sounds.setPermissionsEnabled(value),
              (id) => settings.sounds.setPermissions(id),
            )}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.sounds.errors.title")}
          description={language.t("settings.general.sounds.errors.description")}
        >
          <Select
            data-action="settings-sounds-errors"
            {...soundSelectProps(
              () => settings.sounds.errorsEnabled(),
              () => settings.sounds.errors(),
              (value) => settings.sounds.setErrorsEnabled(value),
              (id) => settings.sounds.setErrors(id),
            )}
          />
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const RemoteAccessSection = () => {
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
                      <span class="text-11-regular text-text-weak w-20 shrink-0">Username</span>
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
                      <span class="text-11-regular text-text-weak w-20 shrink-0">Password</span>
                      <input
                        class="flex-1 text-12-regular bg-transparent border border-border-weak-base rounded px-2 py-1 text-text-strong font-mono outline-none focus:border-border-base"
                        value={editPassword()}
                        onInput={(e) => setEditPassword(e.currentTarget.value)}
                        placeholder="Nouveau mot de passe…"
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
          </div>
        </div>
      </Show>
    )
  }

  const UpdatesSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.updates")}</h3>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.updates.row.startup.title")}
          description={language.t("settings.updates.row.startup.description")}
        >
          <div data-action="settings-updates-startup">
            <Switch
              checked={settings.updates.startup()}
              disabled={!platform.checkUpdate}
              onChange={(checked) => settings.updates.setStartup(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.releaseNotes.title")}
          description={language.t("settings.general.row.releaseNotes.description")}
        >
          <div data-action="settings-release-notes">
            <Switch
              checked={settings.general.releaseNotes()}
              onChange={(checked) => settings.general.setReleaseNotes(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.updates.row.check.title")}
          description={language.t("settings.updates.row.check.description")}
        >
          <Button size="small" variant="secondary" disabled={store.checking || !platform.checkUpdate} onClick={check}>
            {store.checking
              ? language.t("settings.updates.action.checking")
              : language.t("settings.updates.action.checkNow")}
          </Button>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.tab.general")}</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        <GeneralSection />

        <AppearanceSection />

        <NotificationsSection />

        <SoundsSection />

        {/*<Show when={platform.platform === "desktop" && platform.os === "windows" && platform.getWslEnabled}>
          {(_) => {
            const [enabledResource, actions] = createResource(() => platform.getWslEnabled?.())
            const enabled = () => (enabledResource.state === "pending" ? undefined : enabledResource.latest)

            return (
              <div class="flex flex-col gap-1">
                <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.desktop.section.wsl")}</h3>

                <SettingsList>
                  <SettingsRow
                    title={language.t("settings.desktop.wsl.title")}
                    description={language.t("settings.desktop.wsl.description")}
                  >
                    <div data-action="settings-wsl">
                      <Switch
                        checked={enabled() ?? false}
                        disabled={enabledResource.state === "pending"}
                        onChange={(checked) => platform.setWslEnabled?.(checked)?.finally(() => actions.refetch())}
                      />
                    </div>
                  </SettingsRow>
                </SettingsList>
              </div>
            )
          }}
        </Show>*/}

        <RemoteAccessSection />

        <UpdatesSection />

        <Show when={linux()}>
          {(_) => {
            const [valueResource, actions] = createResource(() => platform.getDisplayBackend?.())
            const value = () => (valueResource.state === "pending" ? undefined : valueResource.latest)

            const onChange = (checked: boolean) =>
              platform.setDisplayBackend?.(checked ? "wayland" : "auto").finally(() => actions.refetch())

            return (
              <div class="flex flex-col gap-1">
                <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.display")}</h3>

                <SettingsList>
                  <SettingsRow
                    title={
                      <div class="flex items-center gap-2">
                        <span>{language.t("settings.general.row.wayland.title")}</span>
                        <Tooltip value={language.t("settings.general.row.wayland.tooltip")} placement="top">
                          <span class="text-text-weak">
                            <Icon name="help" size="small" />
                          </span>
                        </Tooltip>
                      </div>
                    }
                    description={language.t("settings.general.row.wayland.description")}
                  >
                    <div data-action="settings-wayland">
                      <Switch checked={value() === "wayland"} onChange={onChange} />
                    </div>
                  </SettingsRow>
                </SettingsList>
              </div>
            )
          }}
        </Show>
      </div>
    </div>
  )
}

interface SettingsRowProps {
  title: string | JSX.Element
  description: string | JSX.Element
  children: JSX.Element
}

const SettingsRow: Component<SettingsRowProps> = (props) => {
  return (
    <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{props.children}</div>
    </div>
  )
}
