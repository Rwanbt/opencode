use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::kokoro::KokoroEngine;
use crate::parakeet::ParakeetEngine;

const STT_MODEL_URL: &str = "https://github.com/Kieirra/murmure-model/releases/download/1.0.0/parakeet-tdt-0.6b-v3-int8.zip";
const KOKORO_MODEL_URL: &str = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx";
const KOKORO_VOICES_URL: &str = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin";

/// Monotonic counter for chunk WAV filenames — avoids collisions when parallel
/// TTS calls land within the same millisecond timestamp.
static CHUNK_COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

fn next_chunk_filename() -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let n = CHUNK_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("chunk_{}_{}.wav", ts, n)
}

/// Acquire a Mutex guard tolerantly: if poisoned (a previous holder panicked),
/// recover the guard rather than propagating. This trades the crash for a
/// warning and continued operation — the STT engine state is idempotent across
/// load/transcribe calls so a partial previous failure doesn't compromise it.
fn lock_safe<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| {
        log::warn!("[speech] recovering from poisoned mutex");
        p.into_inner()
    })
}

fn data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("failed to resolve app data dir")
}

fn model_dir(app: &AppHandle) -> PathBuf {
    data_dir(app).join("speech").join("parakeet-tdt-0.6b-v3-int8")
}

fn speech_dir(app: &AppHandle) -> PathBuf {
    data_dir(app).join("speech")
}

fn kokoro_dir(app: &AppHandle) -> PathBuf {
    data_dir(app).join("speech").join("kokoro")
}

// ─── State ─────────────────────────────────────────────────────────────

pub struct SpeechState {
    stt_engine: Mutex<ParakeetEngine>,
    stt_loaded: Mutex<bool>,
    kokoro_engine: Mutex<KokoroEngine>,
    kokoro_loaded: Mutex<bool>,
}

impl SpeechState {
    pub fn new() -> Self {
        Self {
            stt_engine: Mutex::new(ParakeetEngine::new()),
            stt_loaded: Mutex::new(false),
            kokoro_engine: Mutex::new(KokoroEngine::new()),
            kokoro_loaded: Mutex::new(false),
        }
    }
}

// ─── STT (Parakeet via ONNX Runtime) ──────────────────────────────────

#[tauri::command]
pub async fn stt_download_model(app: AppHandle) -> Result<(), String> {
    let dir = model_dir(&app);
    if dir.join("encoder-model.int8.onnx").exists() {
        return Ok(());
    }

    tracing::info!("[STT] Downloading Parakeet model...");
    let _ = fs::create_dir_all(speech_dir(&app));
    let zip_path = speech_dir(&app).join("parakeet-model.zip");

    let client = reqwest::Client::new();
    let resp = client.get(STT_MODEL_URL).send().await.map_err(|e| format!("Download: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let mut file = tokio::fs::File::create(&zip_path).await.map_err(|e| format!("Create: {}", e))?;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream: {}", e))?;
        file.write_all(&chunk).await.map_err(|e| format!("Write: {}", e))?;
    }
    file.flush().await.map_err(|e| format!("Flush: {}", e))?;
    drop(file);

    // Extract
    let zip_clone = zip_path.clone();
    let dir_clone = speech_dir(&app);
    tokio::task::spawn_blocking(move || {
        let file = fs::File::open(&zip_clone).map_err(|e| format!("Open: {}", e))?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Zip: {}", e))?;
        archive.extract(&dir_clone).map_err(|e| format!("Extract: {}", e))?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Task: {}", e))?
    .map_err(|e: String| e)?;

    let _ = fs::remove_file(&zip_path);
    Ok(())
}

#[tauri::command]
pub async fn stt_load_model(app: AppHandle) -> Result<(), String> {
    {
        let state = app.state::<SpeechState>();
        if *lock_safe(&state.stt_loaded) { return Ok(()); }
    }

    let dir = model_dir(&app);
    if !dir.join("encoder-model.int8.onnx").exists() {
        return Err("Model not downloaded".to_string());
    }

    tracing::info!("[STT] Loading Parakeet model...");
    let start = std::time::Instant::now();
    let dir_clone = dir.clone();
    let result = tokio::task::spawn_blocking(move || {
        let mut engine = ParakeetEngine::new();
        engine.load(&dir_clone)?;
        Ok::<ParakeetEngine, String>(engine)
    })
    .await
    .map_err(|e| format!("Task: {}", e))?;

    let engine = result?;
    {
        let state = app.state::<SpeechState>();
        *lock_safe(&state.stt_engine) = engine;
        *lock_safe(&state.stt_loaded) = true;
    }
    tracing::info!("[STT] Model loaded in {:?}", start.elapsed());
    Ok(())
}

#[tauri::command]
pub async fn stt_transcribe(app: AppHandle, audio_base64: String) -> Result<String, String> {
    {
        let state = app.state::<SpeechState>();
        let loaded = *lock_safe(&state.stt_loaded);
        // Guard + state go out of scope here; safe to await stt_load_model below.
        if !loaded {
            stt_load_model(app.clone()).await?;
        }
    }

    let audio_bytes = base64_decode(&audio_base64)?;
    let samples = tokio::task::spawn_blocking(move || wav_to_samples(&audio_bytes))
        .await
        .map_err(|e| format!("Task: {}", e))?
        .map_err(|e| format!("WAV: {}", e))?;

    let app_clone = app.clone();
    let text = tokio::task::spawn_blocking(move || {
        let state = app_clone.state::<SpeechState>();
        let mut engine = lock_safe(&state.stt_engine);
        engine.transcribe(&samples)
    })
    .await
    .map_err(|e| format!("Task: {}", e))?
    .map_err(|e| format!("STT: {}", e))?;

    Ok(text)
}

#[tauri::command]
pub async fn stt_available(app: AppHandle) -> bool {
    model_dir(&app).join("encoder-model.int8.onnx").exists()
}

#[tauri::command]
pub async fn stt_loaded(app: AppHandle) -> bool {
    let state = app.state::<SpeechState>();
    let guard = lock_safe(&state.stt_loaded);
    let val = *guard;
    drop(guard);
    val
}

// ─── TTS (Kokoro ONNX, built-in) ───────────────────────────────────────
//
// Mobile has no Pocket TTS (no Python). The only local TTS engine is Kokoro.
// `tts_start`/`tts_speak`/`tts_stop`/`tts_available` delegate to the Kokoro
// commands so the frontend keeps a uniform API (same as desktop Pocket path).

#[tauri::command]
pub async fn tts_start(app: AppHandle) -> Result<u16, String> {
    // Returns a port for API parity with desktop. Kokoro is in-process so the
    // port is only a sentinel (0 = "in-process, no HTTP server"). The frontend
    // checks the return value but routes audio via kokoro_synthesize file path.
    kokoro_load(app).await?;
    Ok(0)
}

#[tauri::command]
pub async fn tts_speak(app: AppHandle, text: String, voice: Option<String>) -> Result<String, String> {
    let voice_name = voice.unwrap_or_else(|| "af_heart".to_string());
    kokoro_synthesize(app, text, voice_name, 1.0).await
}

#[tauri::command]
pub async fn tts_stop(_app: AppHandle) -> Result<(), String> {
    // Kokoro runs synchronously per-request; nothing persistent to stop.
    Ok(())
}

#[tauri::command]
pub async fn tts_available(app: AppHandle) -> bool {
    kokoro_available(app).await
}

// ─── Kokoro TTS (ONNX) ─────────────────────────────────────────────────

#[tauri::command]
pub async fn kokoro_available(app: AppHandle) -> bool {
    let dir = kokoro_dir(&app);
    dir.join("kokoro-v1.0.onnx").exists() && dir.join("voices-v1.0.bin").exists()
}

#[tauri::command]
pub async fn kokoro_download_model(app: AppHandle) -> Result<(), String> {
    let dir = kokoro_dir(&app);
    let _ = fs::create_dir_all(&dir);

    let model_path = dir.join("kokoro-v1.0.onnx");
    let voices_path = dir.join("voices-v1.0.bin");

    if model_path.exists() && voices_path.exists() {
        return Ok(());
    }

    let client = reqwest::Client::new();

    if !model_path.exists() {
        log::info!("[Kokoro] Downloading model...");
        let resp = client.get(KOKORO_MODEL_URL).send().await.map_err(|e| format!("Download model: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }
        let total = resp.content_length().unwrap_or(0);
        let mut downloaded: u64 = 0;
        use futures_util::StreamExt;
        use tokio::io::AsyncWriteExt;
        let mut file = tokio::fs::File::create(&model_path).await.map_err(|e| format!("Create: {}", e))?;
        let mut last_emit = std::time::Instant::now();
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Stream: {}", e))?;
            file.write_all(&chunk).await.map_err(|e| format!("Write: {}", e))?;
            downloaded += chunk.len() as u64;
            if last_emit.elapsed().as_millis() > 300 {
                let progress = if total > 0 { downloaded as f64 / total as f64 * 0.9 } else { 0.0 };
                let _ = app.emit("kokoro-download-progress", progress);
                last_emit = std::time::Instant::now();
            }
        }
        file.flush().await.map_err(|e| format!("Flush: {}", e))?;
        log::info!("[Kokoro] Model downloaded");
    }

    if !voices_path.exists() {
        log::info!("[Kokoro] Downloading voices...");
        let resp = client.get(KOKORO_VOICES_URL).send().await.map_err(|e| format!("Download voices: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }
        let bytes = resp.bytes().await.map_err(|e| format!("Read: {}", e))?;
        fs::write(&voices_path, &bytes).map_err(|e| format!("Write: {}", e))?;
        log::info!("[Kokoro] Voices downloaded");
    }

    let _ = app.emit("kokoro-download-progress", 1.0_f64);
    Ok(())
}

#[tauri::command]
pub async fn kokoro_load(app: AppHandle) -> Result<(), String> {
    {
        let state = app.state::<SpeechState>();
        if *lock_safe(&state.kokoro_loaded) { return Ok(()); }
    }

    let dir = kokoro_dir(&app);
    let model_path = dir.join("kokoro-v1.0.onnx");
    let voices_path = dir.join("voices-v1.0.bin");

    if !model_path.exists() || !voices_path.exists() {
        return Err("Kokoro model not downloaded".to_string());
    }

    log::info!("[Kokoro] Loading model...");
    let start = std::time::Instant::now();
    let result = tokio::task::spawn_blocking(move || {
        let mut engine = KokoroEngine::new();
        engine.load(&model_path, &voices_path)?;
        Ok::<KokoroEngine, String>(engine)
    })
    .await
    .map_err(|e| format!("Task: {}", e))?;

    let engine = result?;
    {
        let state = app.state::<SpeechState>();
        *lock_safe(&state.kokoro_engine) = engine;
        *lock_safe(&state.kokoro_loaded) = true;
    }
    log::info!("[Kokoro] Model loaded in {:?}", start.elapsed());
    Ok(())
}

#[tauri::command]
pub async fn kokoro_loaded(app: AppHandle) -> bool {
    let state = app.state::<SpeechState>();
    let guard = lock_safe(&state.kokoro_loaded);
    let val = *guard;
    drop(guard);
    val
}

#[tauri::command]
pub async fn kokoro_voices(app: AppHandle) -> Vec<String> {
    let state = app.state::<SpeechState>();
    let engine = lock_safe(&state.kokoro_engine);
    let mut names = engine.voice_names();
    names.sort();
    names
}

#[tauri::command]
pub async fn kokoro_synthesize(app: AppHandle, text: String, voice: String, speed: f32) -> Result<String, String> {
    {
        let state = app.state::<SpeechState>();
        let loaded = *lock_safe(&state.kokoro_loaded);
        if !loaded {
            kokoro_load(app.clone()).await?;
        }
    }

    log::info!("[Kokoro] Synthesizing {} chars with voice {}", text.len(), voice);
    let start = std::time::Instant::now();

    let app_clone = app.clone();
    let voice_clone = voice.clone();
    let samples = tokio::task::spawn_blocking(move || {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let state = app_clone.state::<SpeechState>();
            let mut engine = lock_safe(&state.kokoro_engine);
            engine.synthesize(&text, &voice_clone, speed)
        }))
        .unwrap_or_else(|panic_val| {
            let msg = panic_val
                .downcast_ref::<String>()
                .map(|s| s.as_str())
                .or_else(|| panic_val.downcast_ref::<&str>().copied())
                .unwrap_or("unknown panic payload");
            log::error!("[Kokoro] PANIC in synthesis: {}", msg);
            Err(format!("Panic: {}", msg))
        })
    })
    .await
    .map_err(|e| format!("Task: {}", e))?
    .map_err(|e| format!("Synthesis: {}", e))?;

    log::info!("[Kokoro] Synthesized {} samples in {:?}", samples.len(), start.elapsed());

    let out_dir = speech_dir(&app).join("tts_chunks");
    let _ = fs::create_dir_all(&out_dir);
    let out_path = out_dir.join(next_chunk_filename());

    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 24000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(&out_path, spec)
        .map_err(|e| format!("WAV writer: {}", e))?;
    for &s in &samples {
        let clamped = s.clamp(-1.0, 1.0);
        let i16_val = if clamped < 0.0 { (clamped * 32768.0) as i16 } else { (clamped * 32767.0) as i16 };
        writer.write_sample(i16_val).map_err(|e| format!("WAV write: {}", e))?;
    }
    writer.finalize().map_err(|e| format!("WAV finalize: {}", e))?;

    Ok(out_path.to_string_lossy().to_string())
}

// ─── Voice Cloning (WAV storage) ───────────────────────────────────────

#[tauri::command]
pub async fn tts_save_voice_clone(app: AppHandle, audio_base64: String, name: String) -> Result<String, String> {
    let dir = speech_dir(&app).join("voices");
    let _ = fs::create_dir_all(&dir);
    let wav_bytes = base64_decode(&audio_base64)?;
    let wav_path = dir.join(format!("{}.wav", name));
    fs::write(&wav_path, &wav_bytes).map_err(|e| format!("Write: {}", e))?;
    Ok(wav_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn tts_list_voice_clones(app: AppHandle) -> Vec<String> {
    let dir = speech_dir(&app).join("voices");
    let mut clones = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "wav").unwrap_or(false) {
                if let Some(stem) = path.file_stem() {
                    clones.push(stem.to_string_lossy().to_string());
                }
            }
        }
    }
    clones
}

#[tauri::command]
pub async fn tts_delete_voice_clone(app: AppHandle, name: String) -> Result<(), String> {
    let path = speech_dir(&app).join("voices").join(format!("{}.wav", name));
    fs::remove_file(&path).map_err(|e| format!("Delete: {}", e))?;
    Ok(())
}

// ─── Helpers ───────────────────────────────────────────────────────────

fn wav_to_samples(wav_bytes: &[u8]) -> Result<Vec<f32>, String> {
    let cursor = std::io::Cursor::new(wav_bytes);
    let reader = hound::WavReader::new(cursor).map_err(|e| format!("WAV: {}", e))?;
    let spec = reader.spec();
    let mut samples: Vec<f32> = reader
        .into_samples::<i16>()
        .filter_map(|s| s.ok())
        .map(|s| s as f32 / 32768.0)
        .collect();
    if spec.channels > 1 {
        samples = samples.chunks(spec.channels as usize)
            .map(|c| c.iter().sum::<f32>() / c.len() as f32).collect();
    }
    if spec.sample_rate != 16000 {
        let ratio = spec.sample_rate as f64 / 16000.0;
        let len = (samples.len() as f64 / ratio) as usize;
        samples = (0..len).map(|i| {
            let idx = i as f64 * ratio;
            let lo = idx as usize;
            let hi = (lo + 1).min(samples.len() - 1);
            let f = (idx - lo as f64) as f32;
            samples[lo] * (1.0 - f) + samples[hi] * f
        }).collect();
    }
    Ok(samples)
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    let data = input.find(',').map(|i| &input[i + 1..]).unwrap_or(input);
    let clean: Vec<u8> = data.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    let mut out = Vec::new();
    let len = clean.len();
    let mut i = 0;
    while i + 3 < len {
        let a = b64val(clean[i])?;
        let b = b64val(clean[i + 1])?;
        let c = if clean[i + 2] != b'=' { b64val(clean[i + 2])? } else { 0 };
        let d = if clean[i + 3] != b'=' { b64val(clean[i + 3])? } else { 0 };
        out.push((a << 2) | (b >> 4));
        if clean[i + 2] != b'=' { out.push((b << 4) | (c >> 2)); }
        if clean[i + 3] != b'=' { out.push((c << 6) | d); }
        i += 4;
    }
    Ok(out)
}

fn b64val(c: u8) -> Result<u8, String> {
    match c {
        b'A'..=b'Z' => Ok(c - b'A'),
        b'a'..=b'z' => Ok(c - b'a' + 26),
        b'0'..=b'9' => Ok(c - b'0' + 52),
        b'+' => Ok(62),
        b'/' => Ok(63),
        _ => Err(format!("Invalid b64: {}", c as char)),
    }
}
