// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Original work. No upstream derivation.
//
// Memory settings — the vault the agent recalls from and records into.
//
// The feature shipped reachable only through `unifia.json`, which is the same
// failure the whole memory work has been closing: correct, present, and
// findable by nobody. This panel is the surface that makes it real for
// someone who never opens a config file.
//
// Everything here writes to the global config through the same API the other
// panels use; there is no separate store to drift out of sync with the file.
import { type Component, createResource, createSignal, Show } from "solid-js"
import { Button } from "@unifia/ui/button"
import { Switch as SwitchComponent } from "@unifia/ui/switch"
import { TextField } from "@unifia/ui/text-field"
import { showToast } from "@unifia/ui/toast"
import { useSDK } from "@/context/sdk"
import { unwrap } from "@/utils/sdk-unwrap"
import { SettingsList } from "./settings-list"
import { SettingsRow } from "./settings-row"
import { useLanguage } from "@/context/language"

type MemorySettings = {
  enabled?: boolean
  directory?: string
  remote_recall?: boolean
  max_notes?: number
  deadline_ms?: number
}

/** Mirrors DEFAULT_MEMORY_DIRECTORY in the knowledge core. */
const DEFAULT_SUBDIRECTORY = ".unifia/memory"
const DEFAULT_MAX_NOTES = 5
const DEFAULT_DEADLINE_MS = 1500

/**
 * A blur on the text input.
 *
 * `TextField` forwards unlisted handlers straight to its inner `<input>`, so
 * this is the native event; spelling the type out keeps `currentTarget.value`
 * honest rather than reaching it through `any`.
 */
type InputBlur = FocusEvent & { currentTarget: HTMLInputElement }

/**
 * Join the project path and the default vault subdirectory.
 *
 * The separator is read off the project path rather than off a platform flag:
 * this panel also runs in a browser talking to a server on another machine,
 * where the viewer's platform says nothing about the server's paths.
 */
function defaultVaultPath(directory: string): string {
  // No project open yet: show the relative default rather than joining it to
  // an empty string, which produced a plausible-looking "/.unifia/memory".
  if (directory.trim() === "") return DEFAULT_SUBDIRECTORY
  const separator = directory.includes("\\") ? "\\" : "/"
  const base = directory.replace(/[\\/]+$/, "")
  return `${base}${separator}${DEFAULT_SUBDIRECTORY.replace(/\//g, separator)}`
}

export const SettingsMemory: Component = () => {
  const language = useLanguage()
  const sdk = useSDK()
  const [busy, setBusy] = createSignal(false)
  // Held separately from the saved value so typing a path does not write on
  // every keystroke; committed on blur, like the other text settings.
  const [draftDirectory, setDraftDirectory] = createSignal<string | null>(null)

  // A rejected resource propagates to the nearest ErrorBoundary, which here
  // is the application root: an unreachable server would replace the whole
  // window with a crash screen instead of one unavailable settings panel.
  // The failure is shown in the panel and the controls stay on their
  // defaults, disabled — visibly not-loaded rather than silently wrong.
  const [config, configActions] = createResource(async () => {
    try {
      return { value: await unwrap(sdk.client.global.config.get()), error: undefined }
    } catch (error) {
      return { value: undefined, error: error instanceof Error ? error.message : String(error) }
    }
  })
  const loadError = () => config()?.error
  const memory = (): MemorySettings => config()?.value?.memory ?? {}
  const enabled = () => memory().enabled !== false
  const defaultPath = () => defaultVaultPath(sdk.directory)
  const resolvedPath = () => {
    const configured = memory().directory?.trim()
    return configured === undefined || configured === "" ? defaultPath() : configured
  }

  const update = async (patch: MemorySettings) => {
    setBusy(true)
    try {
      const current = await unwrap(sdk.client.global.config.get())
      await unwrap(
        sdk.client.global.config.update({
          config: { ...current, memory: { ...current.memory, ...patch } },
        }),
      )
      await configActions.refetch()
      showToast({ variant: "success", title: language.t("settings.fork.memory.saveSuccess") })
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("settings.fork.memory.saveError"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  /**
   * Clearing the setting writes an empty string, not an absent key.
   *
   * The config endpoint merges rather than replaces, and `JSON.stringify`
   * drops an `undefined` value, so sending `directory: undefined` left the
   * old path in the file and the reset silently did nothing. An empty string
   * survives the merge, and `resolveMemoryRoot` already reads a blank
   * directory as "use the default" — so this is the value that means unset,
   * on both sides.
   */
  const UNSET = ""

  const commitDirectory = (value: string) => {
    const next = value.trim()
    setDraftDirectory(null)
    if (next === (memory().directory ?? UNSET)) return
    void update({ directory: next })
  }

  const useDefault = () => {
    setDraftDirectory(null)
    if ((memory().directory ?? UNSET) === UNSET) return
    void update({ directory: UNSET })
  }

  const numeric = (value: string, fallback: number) => {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  return (
    <div class="flex flex-col gap-6">
      <div>
        <h3 class="pb-2 text-14-medium text-text-strong">{language.t("settings.fork.memory.title")}</h3>
        <p class="text-12-regular text-text-weak">{language.t("settings.fork.memory.description")}</p>
      </div>

      <Show when={loadError()}>
        {(message) => (
          <div class="rounded-md border border-border-critical-base bg-surface-critical-weak px-3 py-2 text-12-regular text-text-strong">
            {language.t("settings.fork.memory.loadError")} {message()}
          </div>
        )}
      </Show>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.fork.memory.enableTitle")}
          description={language.t("settings.fork.memory.enableDescription")}
        >
          <SwitchComponent
            checked={enabled()}
            disabled={busy() || config.loading || loadError() !== undefined}
            onChange={(value) => void update({ enabled: value })}
          />
        </SettingsRow>
      </SettingsList>

      <section classList={{ "opacity-50 pointer-events-none": !enabled() }}>
        <h3 class="pb-2 text-14-medium text-text-strong">{language.t("settings.fork.memory.vaultSection")}</h3>
        <SettingsList>
          <SettingsRow
            title={language.t("settings.fork.memory.directoryTitle")}
            description={language.t("settings.fork.memory.directoryDescription")}
          >
            <div class="flex w-full items-center gap-2 sm:w-96">
              <TextField
                size="small"
                variant="normal"
                class="min-w-0 flex-1"
                placeholder={defaultPath()}
                value={draftDirectory() ?? memory().directory ?? UNSET}
                disabled={busy() || loadError() !== undefined}
                onChange={setDraftDirectory}
                onBlur={(event: InputBlur) => commitDirectory(event.currentTarget.value)}
                onKeyDown={(event: KeyboardEvent) => {
                  // `onKeyDown` is one of the props TextField splits off to
                  // the Kobalte root, so `currentTarget` here is a wrapper
                  // element and blurring it does nothing. The draft signal is
                  // the value, and reading it needs no DOM at all.
                  if (event.key === "Enter") commitDirectory(draftDirectory() ?? memory().directory ?? UNSET)
                }}
              />
              <Button
                size="small"
                variant="secondary"
                disabled={busy() || loadError() !== undefined || (memory().directory ?? UNSET) === UNSET}
                onClick={useDefault}
              >
                {language.t("settings.fork.memory.directoryReset")}
              </Button>
            </div>
          </SettingsRow>
        </SettingsList>
        <p class="pt-2 text-11-regular text-text-weak break-all">
          {language.t("settings.fork.memory.directoryResolved", { path: resolvedPath() })}
        </p>
      </section>

      <section classList={{ "opacity-50 pointer-events-none": !enabled() }}>
        <h3 class="pb-2 text-14-medium text-text-strong">{language.t("settings.fork.memory.privacySection")}</h3>
        <SettingsList>
          <SettingsRow
            title={language.t("settings.fork.memory.remoteRecallTitle")}
            description={language.t("settings.fork.memory.remoteRecallDescription")}
          >
            <SwitchComponent
              checked={memory().remote_recall === true}
              disabled={busy() || config.loading || loadError() !== undefined}
              onChange={(value) => void update({ remote_recall: value })}
            />
          </SettingsRow>
        </SettingsList>
        <div
          class="mt-2 rounded-md px-3 py-2 text-12-regular"
          classList={{
            // Warning styling belongs to the state that widens what may
            // leave the machine. Painting the safe default in the same
            // colour teaches the reader that the banner means nothing.
            "bg-surface-warning-base text-text-strong": memory().remote_recall === true,
            "bg-surface-inset text-text-weak": memory().remote_recall !== true,
          }}
        >
          <Show
            when={memory().remote_recall === true}
            fallback={language.t("settings.fork.memory.remoteRecallOffNotice")}
          >
            {language.t("settings.fork.memory.remoteRecallOnNotice")}
          </Show>
        </div>
      </section>

      <section classList={{ "opacity-50 pointer-events-none": !enabled() }}>
        <h3 class="pb-2 text-14-medium text-text-strong">{language.t("settings.fork.memory.recallSection")}</h3>
        <SettingsList>
          <SettingsRow
            title={language.t("settings.fork.memory.maxNotesTitle")}
            description={language.t("settings.fork.memory.maxNotesDescription")}
          >
            <TextField
              size="small"
              variant="normal"
              type="number"
              class="w-24"
              placeholder={String(DEFAULT_MAX_NOTES)}
              value={String(memory().max_notes ?? "")}
              disabled={busy() || loadError() !== undefined}
              onBlur={(event: InputBlur) => {
                const raw = event.currentTarget.value.trim()
                const next = raw === "" ? undefined : numeric(raw, DEFAULT_MAX_NOTES)
                if (next !== memory().max_notes) void update({ max_notes: next })
              }}
            />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.fork.memory.deadlineTitle")}
            description={language.t("settings.fork.memory.deadlineDescription")}
          >
            <TextField
              size="small"
              variant="normal"
              type="number"
              class="w-24"
              placeholder={String(DEFAULT_DEADLINE_MS)}
              value={String(memory().deadline_ms ?? "")}
              disabled={busy() || loadError() !== undefined}
              onBlur={(event: InputBlur) => {
                const raw = event.currentTarget.value.trim()
                const next = raw === "" ? undefined : numeric(raw, DEFAULT_DEADLINE_MS)
                if (next !== memory().deadline_ms) void update({ deadline_ms: next })
              }}
            />
          </SettingsRow>
        </SettingsList>
      </section>
    </div>
  )
}
