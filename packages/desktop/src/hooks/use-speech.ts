/**
 * Speech hooks for desktop.
 * STT: record mic → WAV → whisper-server HTTP API → text in editor
 * TTS: browser SpeechSynthesis API
 */

function invokeTauri(cmd: string, args?: Record<string, unknown>): Promise<any> {
  const tauri = (globalThis as any).__TAURI__
  if (!tauri?.core?.invoke) return Promise.reject("Tauri not available")
  return tauri.core.invoke(cmd, args)
}

let mediaRecorder: MediaRecorder | null = null
let audioChunks: Blob[] = []

export function initSpeechListeners() {
  window.addEventListener("stt-start", handleSttStart)
  window.addEventListener("stt-stop", handleSttStop)
  window.addEventListener("tts-speak", handleTtsSpeak as EventListener)
  // Pre-load Parakeet model so it's warm when user presses mic
  preloadSttModel()
}

async function preloadSttModel() {
  try {
    const available = await invokeTauri("stt_available")
    if (!available) {
      console.log("[STT] Model not downloaded yet, will download on first use")
      return
    }
    console.log("[STT] Pre-loading Parakeet model...")
    await invokeTauri("stt_load_model")
    console.log("[STT] Model loaded, ready for transcription")
  } catch (e) {
    console.warn("[STT] Pre-load failed:", e)
  }
}

export function cleanupSpeechListeners() {
  window.removeEventListener("stt-start", handleSttStart)
  window.removeEventListener("stt-stop", handleSttStop)
  window.removeEventListener("tts-speak", handleTtsSpeak as EventListener)
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

// ─── TTS ───────────────────────────────────────────────────────────────

let speaking = false

function handleTtsSpeak(e: CustomEvent) {
  const text = e.detail?.text
  if (!text) return
  if ("speechSynthesis" in window) {
    if (speaking) { speechSynthesis.cancel(); speaking = false; return }
    speaking = true
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1.0
    utterance.onend = () => { speaking = false }
    utterance.onerror = () => { speaking = false }
    speechSynthesis.speak(utterance)
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
