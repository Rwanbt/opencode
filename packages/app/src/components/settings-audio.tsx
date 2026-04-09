import { Component, createSignal, For, JSX, Show } from "solid-js"
import { Switch } from "@opencode-ai/ui/switch"
import { Select } from "@opencode-ai/ui/select"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { SettingsList } from "./settings-list"
import { createStore } from "solid-js/store"

export type AudioSettings = {
  sttEnabled: boolean
  sttEngine: string
  sttLanguage: string
  ttsEnabled: boolean
  ttsVoice: string
  ttsAutoPlay: boolean
  ttsSpeed: number
}

const DEFAULT_AUDIO: AudioSettings = {
  sttEnabled: true,
  sttEngine: "parakeet",
  sttLanguage: "auto",
  ttsEnabled: true,
  ttsVoice: "alba",
  ttsAutoPlay: false,
  ttsSpeed: 1.0,
}

// Pocket TTS voices (Les Misérables + custom)
const TTS_VOICES: { id: string; label: string }[] = [
  { id: "alba", label: "Alba (default)" },
  { id: "fantine", label: "Fantine" },
  { id: "cosette", label: "Cosette" },
  { id: "eponine", label: "Eponine" },
  { id: "azelma", label: "Azelma" },
  { id: "marius", label: "Marius" },
  { id: "javert", label: "Javert" },
  { id: "jean", label: "Jean" },
]

function invokeTauri(cmd: string, args?: Record<string, unknown>): Promise<any> {
  const tauri = (globalThis as any).__TAURI__
  if (!tauri?.core?.invoke) return Promise.reject("Tauri not available")
  return tauri.core.invoke(cmd, args)
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
            <SettingsRow title="Engine" description="Parakeet TDT 0.6B — fast, 25 languages, ~670 MB">
              <span class="text-12-regular text-text-weak">Parakeet (built-in)</span>
            </SettingsRow>
            <SettingsRow title="Language" description="Language for speech recognition">
              <Select
                size="normal"
                options={["auto", "en", "fr", "de", "es", "it"]}
                current={settings.sttLanguage}
                label={(x) => {
                  const m: Record<string, string> = { auto: "Auto-detect", en: "English", fr: "French", de: "German", es: "Spanish", it: "Italian" }
                  return m[x] ?? x
                }}
                onSelect={(v) => { if (v) update("sttLanguage", v) }}
              />
            </SettingsRow>
          </SettingsList>
        </div>

        {/* Text-to-Speech Section */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">Text to Speech (TTS)</h3>
          <SettingsList>
            <SettingsRow title="Enable TTS" description="Show speaker button under AI responses">
              <Switch checked={settings.ttsEnabled} onChange={(v) => update("ttsEnabled", v)} />
            </SettingsRow>
            <SettingsRow title="Voice" description="Pocket TTS — Kyutai (EN + FR, voice cloning)">
              <Select
                size="normal"
                options={TTS_VOICES.map((v) => v.id)}
                current={settings.ttsVoice}
                label={(id) => TTS_VOICES.find((v) => v.id === id)?.label ?? id}
                onSelect={(v) => { if (v) update("ttsVoice", v) }}
              />
            </SettingsRow>
            <SettingsRow title="Speed" description="Playback speed">
              <Select
                size="normal"
                options={["0.75", "1.0", "1.25", "1.5", "2.0"]}
                current={String(settings.ttsSpeed)}
                label={(x) => `${x}x`}
                onSelect={(v) => { if (v) update("ttsSpeed", parseFloat(v)) }}
              />
            </SettingsRow>
            <SettingsRow title="Auto-play" description="Automatically read AI responses aloud">
              <Switch checked={settings.ttsAutoPlay} onChange={(v) => update("ttsAutoPlay", v)} />
            </SettingsRow>
          </SettingsList>
          <div class="text-11-regular text-text-weak mt-2 px-1">
            Powered by Kyutai Pocket TTS (CC-BY-4.0). French-native, voice cloning supported. Model downloaded on first use. Click to play/pause, double-click to reset.
          </div>
        </div>

        {/* Voice Cloning Section */}
        <VoiceCloneSection
          currentVoice={settings.ttsVoice}
          onSelectClone={(name) => update("ttsVoice", name)}
        />
      </div>
    </div>
  )
}

function VoiceCloneSection(props: { currentVoice: string; onSelectClone: (name: string) => void }) {
  const [clones, setClones] = createSignal<string[]>([])
  const [uploading, setUploading] = createSignal(false)
  const [recording, setRecording] = createSignal(false)
  let mediaRecorder: MediaRecorder | null = null
  let audioChunks: Blob[] = []

  const loadClones = async () => {
    try {
      const list: string[] = await invokeTauri("tts_list_voice_clones")
      setClones(list)
    } catch {}
  }

  // Load on mount
  loadClones()

  const handleUpload = async () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "audio/wav,audio/wave,.wav"
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return

      setUploading(true)
      try {
        const buffer = await file.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        let binary = ""
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        const base64 = btoa(binary)

        const name = file.name.replace(/\.wav$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_")
        await invokeTauri("tts_save_voice_clone", { audioBase64: base64, name })
        await loadClones()
        props.onSelectClone(name)
      } catch (e) {
        console.error("Voice clone upload failed:", e)
      }
      setUploading(false)
    }
    input.click()
  }

  const handleDelete = async (name: string) => {
    try {
      await invokeTauri("tts_delete_voice_clone", { name })
      await loadClones()
      if (props.currentVoice === name) {
        props.onSelectClone("alba")
      }
    } catch (e) {
      console.error("Delete voice clone failed:", e)
    }
  }

  const handleRecord = async () => {
    if (recording()) {
      // Stop recording
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop()
      }
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: { ideal: 24000 }, channelCount: 1 },
      })
      audioChunks = []
      mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      })

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        setRecording(false)
        if (audioChunks.length === 0) return

        setUploading(true)
        try {
          const blob = new Blob(audioChunks, { type: mediaRecorder!.mimeType })
          // Convert to WAV
          const arrayBuffer = await blob.arrayBuffer()
          const audioCtx = new AudioContext({ sampleRate: 24000 })
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
          await audioCtx.close()

          const samples = audioBuffer.getChannelData(0)
          const wavBuffer = encodeWav(samples, 24000)
          const bytes = new Uint8Array(wavBuffer)
          let binary = ""
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
          const base64 = btoa(binary)

          const name = `voice_${Date.now()}`
          await invokeTauri("tts_save_voice_clone", { audioBase64: base64, name })
          await loadClones()
          props.onSelectClone(name)
        } catch (e) {
          console.error("Voice recording failed:", e)
        }
        setUploading(false)
      }

      mediaRecorder.start(250)
      setRecording(true)
    } catch (e) {
      console.error("Mic access failed:", e)
    }
  }

  return (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">Voice Cloning</h3>
      <SettingsList>
        <div class="py-3">
          <div class="flex items-center justify-between gap-2 pb-3">
            <div class="flex flex-col gap-0.5">
              <span class="text-14-medium text-text-strong">Clone a voice</span>
              <span class="text-12-regular text-text-weak">
                {recording() ? "Recording... click mic to stop" : "Upload a WAV or record 5-10s of speech"}
              </span>
            </div>
            <div class="flex items-center gap-1.5">
              <Button
                size="small"
                variant="secondary"
                onClick={handleUpload}
                disabled={uploading() || recording()}
              >
                {uploading() ? "Processing..." : "Upload WAV"}
              </Button>
              <Tooltip placement="top" value={recording() ? "Stop recording" : "Record voice sample"}>
                <IconButton
                  icon="microphone"
                  variant={recording() ? "primary" : "ghost"}
                  class="size-8"
                  aria-label={recording() ? "Stop recording" : "Record voice"}
                  onClick={handleRecord}
                  disabled={uploading()}
                />
              </Tooltip>
            </div>
          </div>
          <Show when={recording()}>
            <div class="flex items-center gap-1 pb-2">
              <div class="flex items-end gap-0.5 h-4">
                <div class="w-0.5 bg-icon-critical-base rounded-full animate-stt-bar1" />
                <div class="w-0.5 bg-icon-critical-base rounded-full animate-stt-bar2" />
                <div class="w-0.5 bg-icon-critical-base rounded-full animate-stt-bar3" />
                <div class="w-0.5 bg-icon-critical-base rounded-full animate-stt-bar4" />
                <div class="w-0.5 bg-icon-critical-base rounded-full animate-stt-bar5" />
                <div class="w-0.5 bg-icon-critical-base rounded-full animate-stt-bar3" />
                <div class="w-0.5 bg-icon-critical-base rounded-full animate-stt-bar1" />
                <div class="w-0.5 bg-icon-critical-base rounded-full animate-stt-bar4" />
              </div>
              <span class="text-12-regular text-text-critical-base ml-1">Recording...</span>
            </div>
          </Show>
          <Show when={clones().length > 0}>
            <div class="flex flex-col gap-1 border-t border-border-weak-base pt-2">
              <span class="text-12-medium text-text-weak pb-1">Custom voices</span>
              <For each={clones()}>
                {(name) => (
                  <div class="flex items-center justify-between gap-2 py-1.5">
                    <button
                      type="button"
                      class="text-13-regular text-text-strong hover:text-text-strong truncate text-left"
                      classList={{ "text-syntax-property!": props.currentVoice === name }}
                      onClick={() => props.onSelectClone(name)}
                    >
                      {name}
                      <Show when={props.currentVoice === name}>
                        <span class="text-11-regular text-text-weak ml-2">(active)</span>
                      </Show>
                    </button>
                    <button
                      type="button"
                      class="text-12-regular text-text-critical-base hover:underline shrink-0"
                      onClick={() => handleDelete(name)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </SettingsList>
      <div class="text-11-regular text-text-weak mt-1 px-1">
        Zero-shot voice cloning: Pocket TTS will mimic the voice from your audio sample. For best results, use a clean recording without background noise.
      </div>
    </div>
  )
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); w(8, "WAVE"); w(12, "fmt ")
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buf
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
