import { type Component, Show } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useMobileLayout } from "@/hooks/use-mobile-layout"
import { SettingsMobileNav } from "./settings-mobile-nav"
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

export const DialogSettings: Component = () => {
  const mobileLayout = useMobileLayout()

  return (
    <Dialog size="x-large" transition>
      <Show when={mobileLayout().isMobile} fallback={<DialogSettingsDesktop />}>
        <SettingsMobileNav />
      </Show>
    </Dialog>
  )
}

const DialogSettingsDesktop: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()

  return (
    <Tabs orientation="vertical" variant="settings" defaultValue="general" class="h-full settings-dialog">
      <Tabs.List>
        <div class="flex flex-col justify-between h-full w-full">
          <div class="flex flex-col gap-3 w-full pt-3">
            <div class="flex flex-col gap-3">
              <div class="flex flex-col gap-1.5">
                <Tabs.SectionTitle>{language.t("settings.section.desktop")}</Tabs.SectionTitle>
                <div class="flex flex-col gap-1.5 w-full">
                  <Tabs.Trigger value="general">
                    <Icon name="sliders" />
                    {language.t("settings.tab.general")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="audio">
                    <Icon name="speaker" />
                    {language.t("settings.fork.audio.title")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="shortcuts">
                    <Icon name="keyboard" />
                    {language.t("settings.tab.shortcuts")}
                  </Tabs.Trigger>
                </div>
              </div>

              <div class="flex flex-col gap-1.5">
                <Tabs.SectionTitle>{language.t("settings.section.server")}</Tabs.SectionTitle>
                <div class="flex flex-col gap-1.5 w-full">
                  <Tabs.Trigger value="providers">
                    <Icon name="providers" />
                    {language.t("settings.providers.title")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="models">
                    <Icon name="models" />
                    {language.t("settings.models.title")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="configuration">
                    <Icon name="console" />
                    {language.t("settings.localConfig.title")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="benchmark">
                    <Icon name="speedometer" />
                    {language.t("settings.fork.benchmark.title")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="observability">
                    <Icon name="eye" />
                    {language.t("settings.fork.observability.title")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="plugins">
                    <Icon name="mcp" />
                    {language.t("settings.fork.plugins.title")}
                  </Tabs.Trigger>
                  <Show when={platform.os === "android"}>
                    <Tabs.Trigger value="android">
                      <Icon name="settings-gear" />
                      {language.t("settings.fork.android.title")}
                    </Tabs.Trigger>
                  </Show>
                </div>
              </div>
            </div>
          </div>
          <div class="flex flex-col gap-1 pl-1 py-1 text-12-medium text-text-weak">
            <span>{language.t("app.name.desktop")}</span>
            <span class="text-11-regular">v{platform.version}</span>
          </div>
        </div>
      </Tabs.List>
      <Tabs.Content value="general" class="no-scrollbar">
        <SettingsGeneral />
      </Tabs.Content>
      <Tabs.Content value="audio" class="no-scrollbar">
        <SettingsAudio />
      </Tabs.Content>
      <Tabs.Content value="shortcuts" class="no-scrollbar">
        <SettingsKeybinds />
      </Tabs.Content>
      <Tabs.Content value="providers" class="no-scrollbar">
        <SettingsProviders />
      </Tabs.Content>
      <Tabs.Content value="models" class="no-scrollbar">
        <SettingsModels />
      </Tabs.Content>
      <Tabs.Content value="configuration" class="no-scrollbar">
        <SettingsConfiguration />
      </Tabs.Content>
      <Tabs.Content value="benchmark" class="no-scrollbar">
        <SettingsBenchmark />
      </Tabs.Content>
      <Tabs.Content value="observability" class="no-scrollbar">
        <SettingsObservability />
      </Tabs.Content>
      <Tabs.Content value="plugins" class="no-scrollbar">
        <SettingsPlugins />
      </Tabs.Content>
      <Show when={platform.os === "android"}>
        <Tabs.Content value="android" class="no-scrollbar">
          <SettingsAndroid />
        </Tabs.Content>
      </Show>
    </Tabs>
  )
}
