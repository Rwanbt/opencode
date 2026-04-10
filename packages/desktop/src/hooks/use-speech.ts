/**
 * Speech hooks for desktop.
 * STT: record mic → WAV → Parakeet ONNX → text in editor
 * TTS: Pocket TTS HTTP server → WAV file → audio playback
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
  console.log("[Speech] All listeners initialized (stt-start, stt-stop, tts-toggle)")
  // Pre-load Parakeet model so it's warm when user presses mic
  preloadModels()
}

async function preloadModels() {
  try {
    const available = await invokeTauri("stt_available")
    if (available) {
      console.log("[STT] Pre-loading Parakeet model...")
      await invokeTauri("stt_load_model")
      console.log("[STT] Model loaded")
    }
  } catch (e) {
    console.warn("[STT] Pre-load failed:", e)
  }
  // Pre-start TTS based on selected provider
  const settings = getAudioSettings()
  const provider = settings.ttsProvider || "pocket"
  try {
    if (provider === "kokoro") {
      const available = await invokeTauri("kokoro_available")
      if (available) {
        console.log("[TTS] Pre-loading Kokoro model...")
        await invokeTauri("kokoro_load")
        console.log("[TTS] Kokoro ready")
      }
    } else {
      console.log("[TTS] Starting Pocket TTS server...")
      await invokeTauri("tts_start")
      console.log("[TTS] Pocket TTS ready")
    }
  } catch (e) {
    console.warn("[TTS] Pre-start failed:", e)
  }
}

export function cleanupSpeechListeners() {
  window.removeEventListener("stt-start", handleSttStart)
  window.removeEventListener("stt-stop", handleSttStop)
  // Note: can't remove exact reference since we wrapped it, but cleanup on app close is fine
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
      console.log("[STT] Recorded", blob.size, "bytes")

      try {
        // Download model on first use if needed
        const available = await invokeTauri("stt_available")
        if (!available) {
          console.log("[STT] Downloading Parakeet model (first time)...")
          await invokeTauri("stt_download_model")
        }

        const wavBase64 = await blobToWavBase64(blob)
        console.log("[STT] Transcribing with Parakeet...")
        const text: string = await invokeTauri("stt_transcribe", { audioBase64: wavBase64 })
        console.log("[STT] Result:", text)
        if (text.trim()) insertTextInEditor(text.trim())
      } catch (e) {
        console.error("[STT] Failed:", e)
      }
    }

    mediaRecorder.start(250)
    console.log("[STT] Recording started")
  } catch (e) {
    console.error("[STT] Mic access failed:", e)
  }
}

function handleSttStop() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop()
    console.log("[STT] Recording stopped, processing...")
  }
}

// ─── TTS (Pocket TTS / Kokoro) — Chunked streaming ───────────────────

type TtsState = "idle" | "loading" | "playing" | "paused"
let ttsState: TtsState = "idle"
let currentAudio: HTMLAudioElement | null = null
let lastDblClick = 0
let chunkQueue: string[] = []       // sentences waiting to be synthesized
let prefetchedPath: string | null = null  // next chunk already synthesized
let prefetchPromise: Promise<string> | null = null
let ttsAborted = false              // signal to stop chunked playback
let playedPaths: string[] = []      // paths to clean up after playback

function getAudioSettings() {
  try {
    const raw = localStorage.getItem("opencode-audio-settings")
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

/**
 * Split text into TTS chunks.
 * First chunk = first sentence only (short → fast time-to-audio).
 * Subsequent chunks are grouped up to ~300 chars (pre-fetched during playback).
 */
function splitIntoChunks(text: string): string[] {
  // Split at sentence boundaries (.!?\n), keep delimiters with preceding text
  const sentences = text.split(/(?<=[.!?\n])\s+/).filter(s => s.trim().length > 0)
  if (sentences.length === 0) return []

  // First chunk: just the first sentence (minimize time-to-first-audio)
  const chunks: string[] = [sentences[0].trim()]

  // Remaining sentences: group into ~300 char chunks (they'll be pre-fetched)
  let current = ""
  for (let i = 1; i < sentences.length; i++) {
    const s = sentences[i]
    if (current.length + s.length > 300 && current.length > 0) {
      chunks.push(current.trim())
      current = s
    } else {
      current += (current ? " " : "") + s
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}

function synthesizeChunk(text: string, provider: string, voice: string, speed: number): Promise<string> {
  if (provider === "kokoro") {
    return invokeTauri("kokoro_synthesize", { text, voice, speed })
  }
  // Pocket TTS is ~27ms/char on CPU. Keep chunks small (1 sentence) to
  // minimize time-to-first-audio; the full request is buffered server-side.
  return invokeTauri("tts_speak", { text, voice })
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
  // Cleanup temp files in background
  if (playedPaths.length > 0) {
    invokeTauri("tts_cleanup_chunks").catch(() => {})
    playedPaths = []
  }
}

async function playNextChunk(provider: string, voice: string, speed: number) {
  if (ttsAborted) return

  // Get the next WAV path — either pre-fetched or synthesize now
  let wavPath: string | null = null
  if (prefetchedPath) {
    wavPath = prefetchedPath
    prefetchedPath = null
  } else if (prefetchPromise) {
    try { wavPath = await prefetchPromise } catch { /* handled below */ }
    prefetchPromise = null
  }

  if (!wavPath || ttsAborted) {
    stopPlayback()
    return
  }

  playedPaths.push(wavPath)

  // Start pre-fetching the next chunk while this one plays
  if (chunkQueue.length > 0) {
    const nextText = chunkQueue.shift()!
    prefetchPromise = synthesizeChunk(nextText, provider, voice, speed)
    // Resolve to path as soon as ready (don't await — runs in parallel with playback)
    prefetchPromise.then(path => {
      prefetchedPath = path
      prefetchPromise = null
    }).catch(() => {
      prefetchedPath = null
      prefetchPromise = null
    })
  }

  // Play current chunk
  const audioUrl = convertFileSrc(wavPath)
  const audio = new Audio(audioUrl)
  if (provider !== "kokoro") audio.playbackRate = speed
  currentAudio = audio

  audio.onended = () => {
    currentAudio = null
    if (ttsAborted) { stopPlayback(); return }
    // More chunks? Play next. Otherwise done.
    if (chunkQueue.length > 0 || prefetchedPath || prefetchPromise) {
      playNextChunk(provider, voice, speed)
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

  // Double-click: full stop + reset
  if (isDoubleClick) {
    stopPlayback()
    return
  }

  // If playing → pause
  if (ttsState === "playing" && currentAudio) {
    currentAudio.pause()
    ttsState = "paused"
    return
  }

  // If paused → resume
  if (ttsState === "paused" && currentAudio) {
    currentAudio.play()
    ttsState = "playing"
    return
  }

  // If loading, ignore
  if (ttsState === "loading") return

  const text = e.detail?.text
  if (!text) return

  const settings = getAudioSettings()
  const provider = settings.ttsProvider || "pocket"
  const defaultVoice = provider === "kokoro" ? "af_heart" : "alba"
  const voice = settings.ttsVoice || defaultVoice
  const speed = settings.ttsSpeed || 1.0

  ttsAborted = false
  playedPaths = []
  ttsState = "loading"
  const t0 = performance.now()

  // Always chunk by sentence. If the text is a single sentence, chunks.length === 1
  // and the behavior is identical to a single call — no overhead.
  // For longer texts, the first sentence plays while the rest is prefetched.
  const chunks = splitIntoChunks(text)
  if (chunks.length === 0) return

  console.log(`[TTS] ${chunks.length} chunk(s) (${provider}), voice: ${voice}, ${text.length} chars`)
  const firstText = chunks.shift()!
  chunkQueue = chunks

  try {
    const firstPath = await synthesizeChunk(firstText, provider, voice, speed)
    console.log(`[TTS] First chunk in ${Math.round(performance.now() - t0)}ms (${firstText.length} chars)`)
    if (ttsAborted) return
    prefetchedPath = firstPath
    await playNextChunk(provider, voice, speed)
    console.log(`[TTS] Time-to-first-audio: ${Math.round(performance.now() - t0)}ms`)
  } catch (e) {
    console.error("[TTS] Failed:", e)
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
  // Resample to 16kHz if needed (whisper expects 16kHz)
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
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
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
