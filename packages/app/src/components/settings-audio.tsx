import { Component, JSX } from "solid-js"
import { Switch } from "@opencode-ai/ui/switch"
import { Select } from "@opencode-ai/ui/select"
import { SettingsList } from "./settings-list"
import { createStore } from "solid-js/store"

export type AudioSettings = {
  sttEnabled: boolean
  sttEngine: string
  sttLanguage: string
  sttMurmurePort: number
  ttsEnabled: boolean
  ttsVoice: string
  ttsAutoPlay: boolean
  ttsSpeed: number
}

const DEFAULT_AUDIO: AudioSettings = {
  sttEnabled: true,
  sttEngine: "parakeet",
  sttLanguage: "auto",
  sttMurmurePort: 7680,
  ttsEnabled: true,
  ttsVoice: "default",
  ttsAutoPlay: false,
  ttsSpeed: 1.0,
}

const STORAGE_KEY = "opencode-audio-settings"

export function loadAudioSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_AUDIO, ...JSON.parse(raw) }
  } catch {}
  return { ...DEFAULT_AUDIO }
}

function saveSettings(s: AudioSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

export const SettingsAudio: Component = () => {
  const [settings, setSettings] = createStore<AudioSettings>(loadAudioSettings())

  const update = <K extends keyof AudioSettings>(key: K, value: AudioSettings[K]) => {
    setSettings(key, value as any)
    saveSettings({ ...settings })
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">Audio</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        {/* Speech-to-Text Section */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">Speech to Text (STT)</h3>
          <SettingsList>
            <SettingsRow title="Enable STT" description="Show microphone button in prompt input">
              <Switch checked={settings.sttEnabled} onChange={(v) => update("sttEnabled", v)} />
            </SettingsRow>
            <SettingsRow title="Engine" description="STT engine to use for transcription">
              <Select
                size="normal"
                options={["parakeet", "whisper"]}
                current={settings.sttEngine}
                label={(x) =>
                  x === "parakeet"
                    ? "Parakeet TDT 0.6B (recommended)"
                    : "Whisper"
                }
                onSelect={(v) => { if (v) update("sttEngine", v) }}
              />
            </SettingsRow>
            <SettingsRow title="Language" description="Language for speech recognition">
              <Select
                size="normal"
                options={["auto", "en", "fr"]}
                current={settings.sttLanguage}
                label={(x) => x === "auto" ? "Auto-detect" : x === "en" ? "English" : "French"}
                onSelect={(v) => { if (v) update("sttLanguage", v) }}
              />
            </SettingsRow>
          </SettingsList>
          <div class="text-11-regular text-text-weak mt-2 px-1">
            Murmure is a free local STT app. Install it from <span class="text-text-strong">murmure.app</span> and enable its HTTP API in Settings &gt; System.
          </div>
        </div>

        {/* Text-to-Speech Section */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">Text to Speech (TTS)</h3>
          <SettingsList>
            <SettingsRow title="Enable TTS" description="Show speaker button under AI responses">
              <Switch checked={settings.ttsEnabled} onChange={(v) => update("ttsEnabled", v)} />
            </SettingsRow>
            <SettingsRow title="Auto-play" description="Automatically play audio when AI responds">
              <Switch checked={settings.ttsAutoPlay} onChange={(v) => update("ttsAutoPlay", v)} />
            </SettingsRow>
            <SettingsRow title="Voice" description="TTS voice selection">
              <Select
                size="normal"
                options={["default", "alba", "aria"]}
                current={settings.ttsVoice}
                label={(x) => x === "default" ? "Default" : x.charAt(0).toUpperCase() + x.slice(1)}
                onSelect={(v) => { if (v) update("ttsVoice", v) }}
              />
            </SettingsRow>
            <SettingsRow title="Speed" description="Playback speed">
              <Select
                size="normal"
                options={["0.75", "1.0", "1.25", "1.5"]}
                current={String(settings.ttsSpeed)}
                label={(x) => `${x}x`}
                onSelect={(v) => { if (v) update("ttsSpeed", parseFloat(v)) }}
              />
            </SettingsRow>
          </SettingsList>
        </div>
      </div>
    </div>
  )
}

interface SettingsRowProps {
  title: string
  description: string
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
