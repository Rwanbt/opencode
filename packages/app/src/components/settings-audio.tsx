import { type Component, createSignal, For, type JSX, onMount, Show } from "solid-js"
import { Switch } from "@opencode-ai/ui/switch"
import { Select } from "@opencode-ai/ui/select"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { showToast } from "@opencode-ai/ui/toast"
import { SettingsList } from "./settings-list"
import { createStore } from "solid-js/store"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"

export type AudioSettings = {
  sttEnabled: boolean
  sttEngine: string
  sttLanguage: string
  ttsEnabled: boolean
  ttsProvider: "pocket" | "kokoro"
  ttsVoice: string
  ttsAutoPlay: boolean
  ttsSpeed: number
}

const DEFAULT_AUDIO: AudioSettings = {
  sttEnabled: true,
  sttEngine: "parakeet",
  sttLanguage: "auto",
  ttsEnabled: true,
  ttsProvider: "pocket",
  ttsVoice: "alba",
  ttsAutoPlay: false,
  ttsSpeed: 1.0,
}

// Pocket TTS voices (Les Misérables + custom)
const TTS_VOICES: { id: string; label: string }[] = [
  { id: "alba", label: "Alba" },
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
  const language = useLanguage()
  const platform = usePlatform()
  // Mobile has no Pocket TTS (no Python sidecar), so the only TTS engine is
  // Kokoro. Voice cloning (Pocket-only feature) is also hidden. We still
  // show the Provider row on desktop so the user can switch engines.
  const isMobile = () => platform.platform === "mobile"

  const [settings, setSettings] = createStore<AudioSettings>(loadAudioSettings())
  const [kokoroVoices, setKokoroVoices] = createSignal<string[]>([])
  const [kokoroAvailable, setKokoroAvailable] = createSignal(false)
  const [kokoroDownloading, setKokoroDownloading] = createSignal(false)
  const [downloadProgress, _setDownloadProgress] = createSignal(0)

  // On mobile, force provider to kokoro (Pocket is not available).
  onMount(() => {
    if (isMobile() && settings.ttsProvider !== "kokoro") {
      update("ttsProvider", "kokoro")
      update("ttsVoice", "af_heart")
    }
  })

  // Check Kokoro availability on mount
  ;(async () => {
    try {
      const avail = await invokeTauri("kokoro_available")
      setKokoroAvailable(avail)
      if (avail) {
        const loaded = await invokeTauri("kokoro_loaded")
        if (loaded) {
          const voices: string[] = await invokeTauri("kokoro_voices")
          setKokoroVoices(voices)
        }
      }
    } catch {}
  })()

  const handleDownloadKokoro = async () => {
    setKokoroDownloading(true)
    try {
      await invokeTauri("kokoro_download_model")
      setKokoroAvailable(true)
      await invokeTauri("kokoro_load")
      const voices: string[] = await invokeTauri("kokoro_voices")
      setKokoroVoices(voices)
    } catch (e) {
      console.error("Kokoro download failed:", e)
    }
    setKokoroDownloading(false)
  }

  const update = <K extends keyof AudioSettings>(key: K, value: AudioSettings[K]) => {
    setSettings(key, value as any)
    saveSettings({ ...settings })
  }

  const handleProviderChange = async (provider: "pocket" | "kokoro") => {
    update("ttsProvider", provider)
    if (provider === "kokoro") {
      update("ttsVoice", "af_heart")
      if (kokoroAvailable() && kokoroVoices().length === 0) {
        try {
          await invokeTauri("kokoro_load")
          const voices: string[] = await invokeTauri("kokoro_voices")
          setKokoroVoices(voices)
        } catch {}
      }
    } else {
      update("ttsVoice", "alba")
    }
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.fork.audio.title")}</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        {/* Speech-to-Text Section */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.fork.audio.stt")}</h3>
          <SettingsList>
            <SettingsRow title={language.t("settings.fork.audio.enableStt")} description={language.t("settings.fork.audio.enableSttDescription")}>
              <Switch checked={settings.sttEnabled} onChange={(v) => update("sttEnabled", v)} />
            </SettingsRow>
            <SettingsRow title={language.t("settings.fork.audio.engine")} description={language.t("settings.fork.audio.engineDescription")}>
              <span class="text-12-regular text-text-weak">{language.t("settings.fork.audio.parakeet")}</span>
            </SettingsRow>
            <SettingsRow title={language.t("settings.fork.audio.language")} description={language.t("settings.fork.audio.languageDescription")}>
              <Select
                size="normal"
                options={["auto", "en", "fr", "de", "es", "it"]}
                current={settings.sttLanguage}
                label={(x) => {
                  const m: Record<string, Parameters<typeof language.t>[0]> = { auto: "settings.fork.audio.languageAuto", en: "settings.fork.audio.languageEnglish", fr: "settings.fork.audio.languageFrench", de: "settings.fork.audio.languageGerman", es: "settings.fork.audio.languageSpanish", it: "settings.fork.audio.languageItalian" }
                  return m[x] ? language.t(m[x]) : x
                }}
                onSelect={(v) => { if (v) update("sttLanguage", v) }}
              />
            </SettingsRow>
          </SettingsList>
        </div>

        {/* Text-to-Speech Section */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.fork.audio.tts")}</h3>
          <SettingsList>
            <SettingsRow title={language.t("settings.fork.audio.enableTts")} description={language.t("settings.fork.audio.enableTtsDescription")}>
              <Switch checked={settings.ttsEnabled} onChange={(v) => update("ttsEnabled", v)} />
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.fork.audio.provider")}
              description={isMobile()
                ? language.t("settings.fork.audio.kokoroProviderDescription")
                : language.t("settings.fork.audio.providerDescription")}
            >
              <div class="flex items-center gap-2">
                <Show
                  when={!isMobile()}
                  fallback={<span class="text-12-regular text-text-weak">{language.t("settings.fork.audio.kokoro")}</span>}
                >
                  <Select
                    size="normal"
                    options={["pocket", "kokoro"]}
                    current={settings.ttsProvider || "pocket"}
                    label={(id) => id === "kokoro" ? language.t("settings.fork.audio.kokoroOption") : language.t("settings.fork.audio.pocketOption")}
                    onSelect={(v) => { if (v) handleProviderChange(v as "pocket" | "kokoro") }}
                  />
                </Show>
                <Show when={settings.ttsProvider === "kokoro" && !kokoroAvailable()}>
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={handleDownloadKokoro}
                    disabled={kokoroDownloading()}
                  >
                    {kokoroDownloading() ? language.t("settings.fork.audio.downloading", { progress: Math.round(downloadProgress() * 100) }) : language.t("settings.fork.audio.downloadModel")}
                  </Button>
                </Show>
              </div>
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.fork.audio.voice")}
              description={settings.ttsProvider === "kokoro"
                ? language.t("settings.fork.audio.kokoroVoiceDescription", { count: kokoroVoices().length })
                : language.t("settings.fork.audio.pocketVoiceDescription")
              }
            >
              <Show when={settings.ttsProvider === "kokoro"} fallback={
                <Select
                  size="normal"
                  options={TTS_VOICES.map((v) => v.id)}
                  current={settings.ttsVoice}
                  label={(id) => TTS_VOICES.find((v) => v.id === id)?.label ?? id}
                  onSelect={(v) => { if (v) update("ttsVoice", v) }}
                />
              }>
                <Select
                  size="normal"
                  options={kokoroVoices().length > 0 ? kokoroVoices() : ["af_heart"]}
                  current={settings.ttsVoice}
                  label={(id) => id}
                  onSelect={(v) => { if (v) update("ttsVoice", v) }}
                />
              </Show>
            </SettingsRow>
            <SettingsRow title={language.t("settings.fork.audio.speed")} description={language.t("settings.fork.audio.speedDescription")}>
              <Select
                size="normal"
                options={["0.75", "1.0", "1.25", "1.5", "2.0"]}
                current={String(settings.ttsSpeed)}
                label={(x) => `${x}x`}
                onSelect={(v) => { if (v) update("ttsSpeed", parseFloat(v)) }}
              />
            </SettingsRow>
            <SettingsRow title={language.t("settings.fork.audio.autoPlay")} description={language.t("settings.fork.audio.autoPlayDescription")}>
              <Switch checked={settings.ttsAutoPlay} onChange={(v) => update("ttsAutoPlay", v)} />
            </SettingsRow>
          </SettingsList>
          <div class="text-11-regular text-text-weak mt-2 px-1">
            <Show when={settings.ttsProvider === "kokoro"} fallback={
              <>{language.t("settings.fork.audio.poweredPocket")}</>
            }>
              {language.t("settings.fork.audio.poweredKokoro")}
            </Show>
          </div>
        </div>

        {/* Voice Cloning Section — Pocket TTS desktop only.
            Kokoro does not support speaker cloning (fixed [1,256] style
            embeddings, no voice encoder) and mobile has no Pocket TTS. */}
        <Show when={!isMobile() && settings.ttsProvider !== "kokoro"}>
          <VoiceCloneSection
            currentVoice={settings.ttsVoice}
            onSelectClone={(name) => update("ttsVoice", name)}
          />
        </Show>
      </div>
    </div>
  )
}

function VoiceCloneSection(props: { currentVoice: string; onSelectClone: (name: string) => void }) {
  const language = useLanguage()
  const [clones, setClones] = createSignal<string[]>([])
  const [uploading, setUploading] = createSignal(false)
  const [recording, setRecording] = createSignal(false)
  const [testing, setTesting] = createSignal<string | null>(null)
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

  // Synthesize a short test phrase with a given voice so the user can verify
  // a freshly-recorded clone actually produces audio before triggering TTS
  // on a real message. The common failure mode is the Pocket TTS server
  // accepting the WAV but returning empty/garbled audio for a voice the
  // user thought was selected — this button surfaces it immediately.
  const handleTest = async (voiceName: string) => {
    if (testing()) return
    setTesting(voiceName)
    try {
      const wavPath: string = await invokeTauri("tts_speak", {
        text: "Voice test, one two three.",
        voice: voiceName,
      })
      // `convertFileSrc` from the shared speech adapter routes through the
      // Tauri asset protocol so the file URL actually resolves inside the
      // webview. Inlining the helper would duplicate the import path;
      // we intentionally keep it inline to avoid a circular dep into the
      // speech hook from a settings component.
      const tauri = (globalThis as any).__TAURI__
      const url =
        tauri?.core?.convertFileSrc?.(wavPath) ??
        (wavPath.startsWith("http") ? wavPath : `file://${wavPath}`)
      await new Audio(url).play()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      showToast({
        title: language.t("settings.fork.audio.voiceTestFailed"),
        description: language.t("settings.fork.audio.voiceTestError", { voice: voiceName, error: msg }),
        variant: "error",
      })
    } finally {
      setTesting(null)
    }
  }

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
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.fork.audio.voiceCloning")}</h3>
      <SettingsList>
        <div class="py-3">
          <div class="flex items-center justify-between gap-2 pb-3">
            <div class="flex flex-col gap-0.5">
              <span class="text-14-medium text-text-strong">{language.t("settings.fork.audio.cloneVoice")}</span>
              <span class="text-12-regular text-text-weak">
                {recording() ? language.t("settings.fork.audio.stopRecording") : language.t("settings.fork.audio.cloneDescription")}
              </span>
            </div>
            <div class="flex items-center gap-1.5">
              <Button
                size="small"
                variant="secondary"
                onClick={handleUpload}
                disabled={uploading() || recording()}
              >
                {uploading() ? language.t("settings.fork.audio.processing") : language.t("settings.fork.audio.uploadWav")}
              </Button>
              <Tooltip placement="top" value={recording() ? language.t("settings.fork.audio.stopRecording") : language.t("settings.fork.audio.recordVoice")}>
                <IconButton
                  icon="microphone"
                  variant={recording() ? "primary" : "ghost"}
                  class="size-8"
                  aria-label={recording() ? language.t("settings.fork.audio.stopRecording") : language.t("settings.fork.audio.recordVoice")}
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
              <span class="text-12-regular text-text-critical-base ml-1">{language.t("settings.fork.audio.recording")}</span>
            </div>
          </Show>
          <Show when={clones().length > 0}>
            <div class="flex flex-col gap-1 border-t border-border-weak-base pt-2">
              <span class="text-12-medium text-text-weak pb-1">{language.t("settings.fork.audio.customVoices")}</span>
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
                        <span class="text-11-regular text-text-weak ml-2">{language.t("settings.fork.audio.active")}</span>
                      </Show>
                    </button>
                    <div class="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        class="text-12-regular text-text-weak hover:text-text-strong disabled:opacity-50"
                        disabled={testing() !== null}
                        onClick={() => handleTest(name)}
                      >
                        {testing() === name ? language.t("settings.fork.audio.voiceTesting") : language.t("settings.fork.audio.voiceTest")}
                      </button>
                      <button
                        type="button"
                        class="text-12-regular text-text-critical-base hover:underline"
                        onClick={() => handleDelete(name)}
                      >
                        {language.t("settings.fork.audio.voiceDelete")}
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </SettingsList>
      <div class="text-11-regular text-text-weak mt-1 px-1">
        {language.t("settings.fork.audio.cloningDescription")}
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
