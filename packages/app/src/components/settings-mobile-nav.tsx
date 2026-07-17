import { type Component, For, Show, createSignal } from "solid-js"
import { Dialog as KobalteDialog } from "@kobalte/core/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SettingsGeneral } from "./settings-general"
import { SettingsAudio } from "./settings-audio"
import { SettingsConfiguration } from "./settings-configuration"
import { SettingsKeybinds } from "./settings-keybinds"
import { SettingsProviders } from "./settings-providers"
import { SettingsModels } from "./settings-models"
import { SettingsBenchmark } from "./settings-benchmark"
import { SettingsPlugins } from "./settings-plugins"
import { SettingsAndroid } from "./settings-android"
import { SettingsObservability } from "./settings-observability"

type CategoryId =
  | "general"
  | "audio"
  | "shortcuts"
  | "providers"
  | "models"
  | "configuration"
  | "benchmark"
  | "plugins"
  | "observability"
  | "android"

// Drill-down list -> detail navigation for narrow viewports, replacing the
// desktop side-by-side tab list + content layout (dialog-settings.tsx). This
// mirrors the desktop Tabs.List categories — keep both in sync when adding
// or removing a settings category.
export const SettingsMobileNav: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const [selected, setSelected] = createSignal<CategoryId | null>(null)

  const categories = () => [
    { value: "general" as const, icon: "sliders" as const, label: language.t("settings.tab.general") },
    { value: "audio" as const, icon: "speaker" as const, label: "Audio" },
    { value: "shortcuts" as const, icon: "keyboard" as const, label: language.t("settings.tab.shortcuts") },
    { value: "providers" as const, icon: "providers" as const, label: language.t("settings.providers.title") },
    { value: "models" as const, icon: "models" as const, label: language.t("settings.models.title") },
    { value: "configuration" as const, icon: "console" as const, label: "Configuration" },
    { value: "benchmark" as const, icon: "settings-gear" as const, label: "Benchmark" },
    { value: "plugins" as const, icon: "mcp" as const, label: "Plugins" },
    { value: "observability" as const, icon: "settings-gear" as const, label: "Observability" },
    ...(platform.os === "android"
      ? [{ value: "android" as const, icon: "settings-gear" as const, label: "Android" }]
      : []),
  ]

  const selectedCategory = () => categories().find((category) => category.value === selected())

  function renderContent(id: CategoryId) {
    switch (id) {
      case "general":
        return <SettingsGeneral />
      case "audio":
        return <SettingsAudio />
      case "shortcuts":
        return <SettingsKeybinds />
      case "providers":
        return <SettingsProviders />
      case "models":
        return <SettingsModels />
      case "configuration":
        return <SettingsConfiguration />
      case "benchmark":
        return <SettingsBenchmark />
      case "plugins":
        return <SettingsPlugins />
      case "observability":
        return <SettingsObservability />
      case "android":
        return <SettingsAndroid />
    }
  }

  return (
    <div class="flex flex-col h-full w-full" data-slot="settings-mobile-nav">
      <div class="flex items-center gap-2 px-2 py-2 border-b border-border-weak-base shrink-0">
        <Show
          when={selectedCategory()}
          fallback={<span class="flex-1 text-14-medium text-text-strong px-2">{language.t("sidebar.settings")}</span>}
        >
          {(category) => (
            <>
              <IconButton
                icon="arrow-left"
                variant="ghost"
                onClick={() => setSelected(null)}
                aria-label={language.t("common.goBack")}
              />
              <span class="flex-1 text-14-medium text-text-strong">{category().label}</span>
            </>
          )}
        </Show>
        <KobalteDialog.CloseButton
          as={IconButton}
          icon="close"
          variant="ghost"
          aria-label={language.t("ui.common.close")}
        />
      </div>
      <Show
        when={selectedCategory()}
        fallback={
          <div class="flex-1 min-h-0 overflow-y-auto no-scrollbar" data-slot="settings-mobile-list">
            <For each={categories()}>
              {(category) => (
                <button
                  type="button"
                  class="flex items-center gap-3 w-full text-left px-4 py-3 border-b border-border-weak-base last:border-none hover:bg-surface-base-hover transition-colors"
                  onClick={() => setSelected(category.value)}
                >
                  <Icon name={category.icon} class="text-icon-base shrink-0" />
                  <span class="flex-1 text-14-medium text-text-base">{category.label}</span>
                  <Icon name="chevron-right" size="small" class="text-text-weak shrink-0" />
                </button>
              )}
            </For>
          </div>
        }
      >
        {(category) => (
          <div class="flex-1 min-h-0 overflow-y-auto no-scrollbar" data-slot="settings-mobile-content">
            {renderContent(category().value)}
          </div>
        )}
      </Show>
    </div>
  )
}
