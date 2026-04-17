/**
 * Mobile speech hooks.
 *
 * STT: mic → MediaRecorder (webm/opus) → WAV 16 kHz → Parakeet ONNX → text
 * TTS: text → Kokoro ONNX → WAV file → HTMLAudioElement playback
 *
 * Mobile has no Pocket TTS (would require a Python sidecar, not viable on
 * Android). The only on-device TTS engine is Kokoro. For API parity with the
 * desktop hook the `ttsProvider` setting is still read but forced to Kokoro.
 */

function invokeTauri(cmd: string, args?: Record<string, unknown>): Promise<any> {
  const tauri = (globalThis as any).__TAURI__
  if (!tauri?.core?.invoke) return Promise.reject("Tauri not available")
  return tauri.core.invoke(cmd, args)
}

function convertFileSrc(path: string): string {
  const tauri = (globalThis as any).__TAURI__
  if (tauri?.core?.convertFileSrc) return tauri.core.convertFileSrc(path)
  return `https://asset.localhost/${encodeURIComponent(path)}`
}

let mediaRecorder: MediaRecorder | null = null
let audioChunks: Blob[] = []

export function initSpeechListeners() {
  window.addEventListener("stt-start", handleSttStart)
  window.addEventListener("stt-stop", handleSttStop)
  window.addEventListener("tts-toggle", ((e: Event) => { handleTtsToggle(e as CustomEvent) }) as EventListener)
  void preloadModels()
}

export function cleanupSpeechListeners() {
  window.removeEventListener("stt-start", handleSttStart)
  window.removeEventListener("stt-stop", handleSttStop)
}

async function preloadModels() {
  try {
    const available = await invokeTauri("stt_available")
    if (available) await invokeTauri("stt_load_model")
  } catch (e) {
    console.warn("[STT] Pre-load failed:", e)
  }
  try {
    const available = await invokeTauri("kokoro_available")
    if (available) await invokeTauri("kokoro_load")
  } catch (e) {
    console.warn("[TTS] Pre-load failed:", e)
  }
}

// ─── STT ───────────────────────────────────────────────────────────────

async function handleSttStart() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: { ideal: 16000 }, channelCount: 1 },
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
      if (audioChunks.length === 0) return

      const blob = new Blob(audioChunks, { type: mediaRecorder!.mimeType })

      try {
        const available = await invokeTauri("stt_available")
        if (!available) {
          await invokeTauri("stt_download_model")
        }

        const wavBase64 = await blobToWavBase64(blob)
        const text: string = await invokeTauri("stt_transcribe", { audioBase64: wavBase64 })
        if (text.trim()) insertTextInEditor(text.trim())
      } catch (e) {
        console.error("[STT] Failed:", e)
      }
    }

    mediaRecorder.start(250)
  } catch (e) {
    console.error("[STT] Mic access failed:", e)
    // Reset the recording signal so the UI button doesn't stay stuck in "stop"
    window.dispatchEvent(new CustomEvent("stt-start-failed"))
  }
}

function handleSttStop() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop()
  }
}

// ─── TTS (Kokoro only) ─────────────────────────────────────────────────

type TtsState = "idle" | "loading" | "playing" | "paused"
let ttsState: TtsState = "idle"
let currentAudio: HTMLAudioElement | null = null
let lastDblClick = 0
let chunkQueue: string[] = []
let prefetchedPath: string | null = null
let prefetchPromise: Promise<string> | null = null
let ttsAborted = false

function getAudioSettings() {
  try {
    const raw = localStorage.getItem("opencode-audio-settings")
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

/** Extract a tiny first chunk (~10-15 chars) to minimise time-to-first-audio. */
function splitFirstTinyChunk(text: string): [string, string] {
  const t = text.trim()
  if (t.length < 15) return [t, ""]
  const MIN = 8
  const MAX = 15
  for (let i = MIN; i <= MAX && i < t.length; i++) {
    const c = t[i]
    if (c === "," || c === ":" || c === ";") {
      return [t.slice(0, i + 1).trim(), t.slice(i + 1).trim()]
    }
  }
  for (let i = MIN; i < t.length; i++) {
    if (t[i] === " ") return [t.slice(0, i).trim(), t.slice(i + 1).trim()]
  }
  return [t, ""]
}

const CHUNK_HARD_MAX = 100
const CHUNK_MIN_CUT = 50
const CHUNK_MERGE_TARGET = 80

function splitLongSentence(s: string): string[] {
  if (s.length <= CHUNK_HARD_MAX) return [s.trim()].filter(p => p.length > 0)
  const parts: string[] = []
  let start = 0
  while (start < s.length) {
    const remaining = s.length - start
    if (remaining <= CHUNK_HARD_MAX) {
      const tail = s.slice(start).trim()
      if (tail.length > 0) parts.push(tail)
      break
    }
    const minCut = start + CHUNK_MIN_CUT
    const maxCut = Math.min(start + CHUNK_HARD_MAX, s.length - 1)
    const targetCut = remaining < CHUNK_HARD_MAX * 2
      ? start + Math.floor(remaining / 2)
      : start + CHUNK_HARD_MAX
    let cut = -1
    for (let i = minCut; i <= maxCut; i++) {
      const c = s[i]
      if (c === "," || c === ":" || c === ";") { cut = i + 1; break }
    }
    if (cut === -1) {
      let bestDist = Infinity
      let bestPos = -1
      for (let i = minCut; i <= maxCut; i++) {
        if (s[i] === " ") {
          const dist = Math.abs(i - targetCut)
          if (dist < bestDist) { bestDist = dist; bestPos = i }
        }
      }
      if (bestPos !== -1) cut = bestPos
    }
    if (cut === -1) cut = maxCut
    const part = s.slice(start, cut).trim()
    if (part.length > 0) parts.push(part)
    start = cut
    while (start < s.length && s[start] === " ") start++
  }
  return parts
}

function mergeShortChunks(chunks: string[], maxLen: number): string[] {
  if (chunks.length <= 1) return chunks
  const merged: string[] = []
  let current = chunks[0]
  for (let i = 1; i < chunks.length; i++) {
    const next = chunks[i]
    const combined = current + " " + next
    if (combined.length <= maxLen) current = combined
    else { merged.push(current); current = next }
  }
  merged.push(current)
  return merged
}

function splitIntoChunks(text: string): string[] {
  const [firstTiny, rest] = splitFirstTinyChunk(text)
  if (!firstTiny) return []
  if (!rest) return [firstTiny]
  const sentences = rest.split(/(?<=[.!?\n])\s+/).filter(s => s.trim().length > 0)
  const bodyChunks: string[] = []
  for (const sentence of sentences) {
    const trimmed = sentence.trim()
    if (trimmed.length === 0) continue
    if (trimmed.length <= CHUNK_HARD_MAX) bodyChunks.push(trimmed)
    else for (const part of splitLongSentence(trimmed)) bodyChunks.push(part)
  }
  return [firstTiny, ...mergeShortChunks(bodyChunks, CHUNK_MERGE_TARGET)]
}

function synthesizeChunk(text: string, voice: string, speed: number): Promise<string> {
  return invokeTauri("kokoro_synthesize", { text, voice, speed })
}

function stopPlayback() {
  ttsAborted = true
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.currentTime = 0
    currentAudio = null
  }
  chunkQueue = []
  prefetchedPath = null
  prefetchPromise = null
  ttsState = "idle"
}

async function playNextChunk(voice: string, speed: number) {
  if (ttsAborted) return

  let wavPath: string | null = null
  if (prefetchedPath) {
    wavPath = prefetchedPath
    prefetchedPath = null
  } else if (prefetchPromise) {
    try { wavPath = await prefetchPromise } catch { /* handled below */ }
    prefetchPromise = null
  }

  if (!wavPath || ttsAborted) { stopPlayback(); return }

  if (chunkQueue.length > 0 && !prefetchPromise && !prefetchedPath) {
    const nextText = chunkQueue.shift()!
    prefetchPromise = synthesizeChunk(nextText, voice, speed)
    prefetchPromise.then(path => {
      prefetchedPath = path
      prefetchPromise = null
    }).catch(() => {
      prefetchedPath = null
      prefetchPromise = null
    })
  }

  const audioUrl = convertFileSrc(wavPath)
  const audio = new Audio(audioUrl)
  currentAudio = audio

  audio.onended = () => {
    currentAudio = null
    if (ttsAborted) { stopPlayback(); return }
    if (chunkQueue.length > 0 || prefetchedPath || prefetchPromise) {
      void playNextChunk(voice, speed)
    } else {
      stopPlayback()
    }
  }
  audio.onerror = () => { stopPlayback() }

  try {
    await audio.play()
    ttsState = "playing"
  } catch {
    stopPlayback()
  }
}

async function handleTtsToggle(e: CustomEvent) {
  const now = Date.now()
  const isDoubleClick = now - lastDblClick < 400
  lastDblClick = now

  if (isDoubleClick) { stopPlayback(); return }

  if (ttsState === "playing" && currentAudio) {
    currentAudio.pause()
    ttsState = "paused"
    return
  }
  if (ttsState === "paused" && currentAudio) {
    void currentAudio.play()
    ttsState = "playing"
    return
  }
  if (ttsState === "loading") return

  const text = e.detail?.text
  if (!text) return

  const settings = getAudioSettings()
  const voice = settings.ttsVoice || "af_heart"
  const speed = settings.ttsSpeed || 1.0

  ttsAborted = false
  ttsState = "loading"

  const chunks = splitIntoChunks(text)
  if (chunks.length === 0) return

  const firstText = chunks.shift()!
  const secondText = chunks.shift()
  chunkQueue = chunks

  try {
    const synth1Promise = synthesizeChunk(firstText, voice, speed)
    let synth2Promise: Promise<string> | null = null
    if (secondText) {
      synth2Promise = synthesizeChunk(secondText, voice, speed)
      synth2Promise.catch(() => {})
    }

    const firstPath = await synth1Promise
    if (ttsAborted) return
    prefetchedPath = firstPath

    if (synth2Promise) {
      const s2 = synth2Promise
      prefetchPromise = s2
      s2.then(path => {
        if (prefetchPromise === s2) {
          prefetchedPath = path
          prefetchPromise = null
        }
      }).catch(() => {
        if (prefetchPromise === s2) {
          prefetchedPath = null
          prefetchPromise = null
        }
      })
    }

    await playNextChunk(voice, speed)
  } catch (err) {
    console.error("[TTS] Failed:", err)
    stopPlayback()
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

function insertTextInEditor(text: string) {
  const editor = document.querySelector("[data-component='prompt-input'][contenteditable='true']") as HTMLDivElement
  if (!editor) return
  editor.focus()
  document.execCommand("insertText", false, text)
}

async function blobToWavBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer()
  const audioCtx = new AudioContext({ sampleRate: 16000 })
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
  await audioCtx.close()

  const samples = audioBuffer.getChannelData(0)
  const targetRate = 16000
  const resampled = audioBuffer.sampleRate !== targetRate
    ? resample(samples, audioBuffer.sampleRate, targetRate)
    : samples

  const wavBuffer = encodeWav(resampled, targetRate)
  return arrayBufferToBase64(wavBuffer)
}

function resample(samples: Float32Array, from: number, to: number): Float32Array {
  const ratio = from / to
  const len = Math.round(samples.length / ratio)
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    const idx = i * ratio
    const lo = Math.floor(idx)
    const hi = Math.min(lo + 1, samples.length - 1)
    const frac = idx - lo
    out[i] = samples[lo] * (1 - frac) + samples[hi] * frac
  }
  return out
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buf)
  const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)) }
  writeStr(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, "WAVE")
  writeStr(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, "data")
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buf
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ""
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}
