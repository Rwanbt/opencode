/**
 * Speech hooks for desktop.
 * STT: record mic → WAV → Parakeet ONNX → text in editor
 * TTS: Pocket TTS HTTP server → WAV file → audio playback
 */

import { invokeTauri, convertFileSrc } from "../../../app/src/hooks/speech-tauri-adapter"

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
 * Extract a tiny first chunk (~10-15 chars) for minimal time-to-first-audio.
 * Rules:
 *  - If text < 15 chars → whole text as single chunk
 *  - Prefer a punctuation break (, : ;) in positions [8..15]
 *  - Else cut at first space at position >= 8
 *  - No valid break point (single long word) → whole text as single chunk
 * Returns [firstTiny, rest].
 */
function splitFirstTinyChunk(text: string): [string, string] {
  const t = text.trim()
  if (t.length < 15) return [t, ""]

  const MIN = 8
  const MAX = 15

  // Prefer punctuation break in [MIN..MAX]
  for (let i = MIN; i <= MAX && i < t.length; i++) {
    const c = t[i]
    if (c === "," || c === ":" || c === ";") {
      return [t.slice(0, i + 1).trim(), t.slice(i + 1).trim()]
    }
  }

  // Else first space at position >= MIN
  for (let i = MIN; i < t.length; i++) {
    if (t[i] === " ") {
      return [t.slice(0, i).trim(), t.slice(i + 1).trim()]
    }
  }

  // No break point (single long word) → whole text
  return [t, ""]
}

/** Hard upper bound per chunk (Pocket TTS ≈ 27ms/char → 100c ≈ 2.7s synth) */
const CHUNK_HARD_MAX = 100
/** Minimum position for a secondary cut inside a long sentence */
const CHUNK_MIN_CUT = 50

/**
 * Split a sentence longer than CHUNK_HARD_MAX at secondary punctuation
 * (, : ;) or a word boundary. Balances parts when the sentence is just
 * slightly over the limit (avoids leaving a tiny 5-10c tail).
 */
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

    // If the remaining text is only slightly over HARD_MAX (< 2x), aim for
    // the MIDDLE so both parts are balanced. Otherwise use greedy max-cut.
    const targetCut = remaining < CHUNK_HARD_MAX * 2
      ? start + Math.floor(remaining / 2)
      : start + CHUNK_HARD_MAX

    // 1. Prefer secondary punctuation in [minCut..maxCut]
    let cut = -1
    for (let i = minCut; i <= maxCut; i++) {
      const c = s[i]
      if (c === "," || c === ":" || c === ";") {
        cut = i + 1
        break
      }
    }

    // 2. Else find the space CLOSEST to targetCut within [minCut..maxCut]
    if (cut === -1) {
      let bestDist = Infinity
      let bestPos = -1
      for (let i = minCut; i <= maxCut; i++) {
        if (s[i] === " ") {
          const dist = Math.abs(i - targetCut)
          if (dist < bestDist) {
            bestDist = dist
            bestPos = i
          }
        }
      }
      if (bestPos !== -1) cut = bestPos
    }

    // 3. Last resort: hard cut at maxCut (single very long word, rare)
    if (cut === -1) cut = maxCut

    const part = s.slice(start, cut).trim()
    if (part.length > 0) parts.push(part)
    start = cut
    while (start < s.length && s[start] === " ") start++
  }

  return parts
}

/** Target size after merging short chunks (leaves headroom below CHUNK_HARD_MAX) */
const CHUNK_MERGE_TARGET = 80

/**
 * Merge consecutive short chunks as long as the combined length stays
 * within maxLen. Avoids wasting the ~500ms fixed synthesis overhead on
 * micro-fragments like "system." (7c).
 */
function mergeShortChunks(chunks: string[], maxLen: number): string[] {
  if (chunks.length <= 1) return chunks

  const merged: string[] = []
  let current = chunks[0]

  for (let i = 1; i < chunks.length; i++) {
    const next = chunks[i]
    const combined = current + " " + next
    if (combined.length <= maxLen) {
      current = combined
    } else {
      merged.push(current)
      current = next
    }
  }
  merged.push(current)
  return merged
}

/**
 * Split text into TTS chunks optimized for chunked streaming.
 * Rules:
 *  1. First chunk is ultra-short (~10-15 chars) via splitFirstTinyChunk
 *     for minimum time-to-first-audio.
 *  2. Subsequent chunks follow sentence boundaries.
 *  3. Any sentence longer than CHUNK_HARD_MAX (100c) is split at
 *     secondary punctuation or word boundaries.
 *  4. Consecutive short chunks are merged up to CHUNK_MERGE_TARGET (80c)
 *     to avoid wasting the fixed synthesis overhead on micro-fragments.
 *  5. No chunk ever exceeds CHUNK_HARD_MAX.
 */
function splitIntoChunks(text: string): string[] {
  const [firstTiny, rest] = splitFirstTinyChunk(text)
  if (!firstTiny) return []
  if (!rest) return [firstTiny]

  // Split rest by sentence boundaries (. ! ? \n + whitespace)
  const sentences = rest.split(/(?<=[.!?\n])\s+/).filter(s => s.trim().length > 0)

  // Build the body chunks (everything after firstTiny)
  const bodyChunks: string[] = []
  for (const sentence of sentences) {
    const trimmed = sentence.trim()
    if (trimmed.length === 0) continue
    if (trimmed.length <= CHUNK_HARD_MAX) {
      bodyChunks.push(trimmed)
    } else {
      for (const part of splitLongSentence(trimmed)) {
        bodyChunks.push(part)
      }
    }
  }

  // Merge short consecutive chunks to avoid micro-fragments
  const mergedBody = mergeShortChunks(bodyChunks, CHUNK_MERGE_TARGET)

  return [firstTiny, ...mergedBody]
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

  // Start pre-fetching the next chunk while this one plays.
  // Guard: skip if a prefetch is already in flight or ready (e.g. C1 was
  // pre-launched in parallel with C0 from handleTtsToggle).
  if (chunkQueue.length > 0 && !prefetchPromise && !prefetchedPath) {
    const nextText = chunkQueue.shift()!
    prefetchPromise = synthesizeChunk(nextText, provider, voice, speed)
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

  // Split into sentence chunks. First chunk is ultra-short for fast TTFA.
  // For multi-chunk texts, C0 and C1 are launched in parallel so C1 is
  // ready when C0 audio finishes playing (zero gap between chunks).
  const chunks = splitIntoChunks(text)
  if (chunks.length === 0) return

  console.log(`[TTS] ${chunks.length} chunk(s) (${provider}), voice: ${voice}, ${text.length} chars`)

  // Shift C0 AND C1 out, launch their synth in parallel. C2+ stays in chunkQueue.
  const firstText = chunks.shift()!
  const secondText = chunks.shift()
  chunkQueue = chunks

  try {
    const synth1Promise = synthesizeChunk(firstText, provider, voice, speed)

    // Launch C1 synth in PARALLEL with C0 (the server handles concurrent requests).
    // This eliminates the gap between C0 playback end and C1 ready.
    let synth2Promise: Promise<string> | null = null
    if (secondText) {
      synth2Promise = synthesizeChunk(secondText, provider, voice, speed)
      // Attach a no-op catch immediately so a failure doesn't become an unhandled
      // rejection if synth1 throws before we wire up the real handlers below.
      synth2Promise.catch(() => {})
    }

    const firstPath = await synth1Promise
    console.log(`[TTS] First chunk in ${Math.round(performance.now() - t0)}ms (${firstText.length} chars)`)
    if (ttsAborted) return
    prefetchedPath = firstPath

    // Wire C1 synth as the next prefetch so playNextChunk consumes it after C0.
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
