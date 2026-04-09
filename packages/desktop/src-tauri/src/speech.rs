use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::parakeet::ParakeetEngine;

const MODEL_URL: &str = "https://github.com/Kieirra/murmure-model/releases/download/1.0.0/parakeet-tdt-0.6b-v3-int8.zip";

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

// ─── State ─────────────────────────────────────────────────────────────

pub struct SpeechState {
    engine: Mutex<ParakeetEngine>,
    loaded: Mutex<bool>,
}

impl SpeechState {
    pub fn new() -> Self {
        Self {
            engine: Mutex::new(ParakeetEngine::new()),
            loaded: Mutex::new(false),
        }
    }
}

// ─── Tauri commands ────────────────────────────────────────────────────

/// Download the Parakeet STT model if not present
#[tauri::command]
#[specta::specta]
pub async fn stt_download_model(app: AppHandle) -> Result<(), String> {
    let dir = model_dir(&app);
    if dir.join("encoder-model.int8.onnx").exists() {
        tracing::info!("[STT] Model already downloaded");
        return Ok(());
    }

    tracing::info!("[STT] Downloading Parakeet model (~460MB)...");
    let _ = fs::create_dir_all(speech_dir(&app));

    let zip_path = speech_dir(&app).join("parakeet-model.zip");

    // Download
    let client = reqwest::Client::new();
    let resp = client
        .get(MODEL_URL)
        .send()
        .await
        .map_err(|e| format!("Download: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    use futures::StreamExt;
    use tokio::io::AsyncWriteExt;

    let mut file = tokio::fs::File::create(&zip_path)
        .await
        .map_err(|e| format!("Create zip: {}", e))?;
    let mut last_emit = std::time::Instant::now();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Write: {}", e))?;
        downloaded += chunk.len() as u64;

        if last_emit.elapsed().as_millis() > 300 {
            let progress = if total > 0 {
                downloaded as f64 / total as f64
            } else {
                0.0
            };
            let _ = app.emit("stt-download-progress", progress);
            last_emit = std::time::Instant::now();
        }
    }

    file.flush().await.map_err(|e| format!("Flush: {}", e))?;
    drop(file);

    let _ = app.emit("stt-download-progress", 0.95);

    // Extract zip
    tracing::info!("[STT] Extracting model...");
    let zip_clone = zip_path.clone();
    let dir_clone = speech_dir(&app);
    tokio::task::spawn_blocking(move || {
        let file = fs::File::open(&zip_clone).map_err(|e| format!("Open zip: {}", e))?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Read zip: {}", e))?;
        archive
            .extract(&dir_clone)
            .map_err(|e| format!("Extract: {}", e))?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Extract task: {}", e))?
    .map_err(|e: String| e)?;

    // Clean up zip
    let _ = fs::remove_file(&zip_path);
    let _ = app.emit("stt-download-progress", 1.0);

    tracing::info!("[STT] Model downloaded and extracted");
    Ok(())
}

/// Load the Parakeet model into memory (call once, stays loaded)
#[tauri::command]
#[specta::specta]
pub async fn stt_load_model(app: AppHandle) -> Result<(), String> {
    {
        let state = app.state::<SpeechState>();
        if *state.loaded.lock().unwrap() {
            return Ok(());
        }
    }

    let dir = model_dir(&app);
    if !dir.join("encoder-model.int8.onnx").exists() {
        return Err("Model not downloaded. Use stt_download_model first.".to_string());
    }

    tracing::info!("[STT] Loading Parakeet model...");
    let start = std::time::Instant::now();

    // Load in blocking thread (model loading is CPU-intensive)
    let dir_clone = dir.clone();
    let result = tokio::task::spawn_blocking(move || {
        let mut engine = ParakeetEngine::new();
        engine.load(&dir_clone)?;
        Ok::<ParakeetEngine, String>(engine)
    })
    .await
    .map_err(|e| format!("Load task: {}", e))?;

    let engine = result?;

    {
        let state = app.state::<SpeechState>();
        *state.engine.lock().unwrap() = engine;
        *state.loaded.lock().unwrap() = true;
    }

    tracing::info!("[STT] Model loaded in {:?}", start.elapsed());
    Ok(())
}

/// Transcribe audio (base64-encoded WAV) to text
#[tauri::command]
#[specta::specta]
pub async fn stt_transcribe(app: AppHandle, audio_base64: String) -> Result<String, String> {
    // Ensure model is loaded
    {
        let state = app.state::<SpeechState>();
        if !*state.loaded.lock().unwrap() {
            drop(state);
            // Try to load
            stt_load_model(app.clone()).await?;
        }
    }

    let audio_bytes = base64_decode(&audio_base64)?;
    tracing::info!("[STT] Transcribing {} bytes", audio_bytes.len());

    // Decode WAV to f32 PCM samples
    let samples = tokio::task::spawn_blocking(move || wav_to_samples(&audio_bytes))
        .await
        .map_err(|e| format!("WAV decode task: {}", e))?
        .map_err(|e| format!("WAV decode: {}", e))?;

    tracing::info!("[STT] {} samples at 16kHz ({:.1}s)", samples.len(), samples.len() as f64 / 16000.0);

    // Run inference
    let app_clone = app.clone();
    let text = tokio::task::spawn_blocking(move || {
        let state = app_clone.state::<SpeechState>();
        let mut engine = state.engine.lock().unwrap();
        engine.transcribe(&samples)
    })
    .await
    .map_err(|e| format!("Transcribe task: {}", e))?
    .map_err(|e| format!("Transcribe: {}", e))?;

    Ok(text)
}

/// Check if STT model is downloaded
#[tauri::command]
#[specta::specta]
pub async fn stt_available(app: AppHandle) -> bool {
    model_dir(&app).join("encoder-model.int8.onnx").exists()
}

/// Check if model is loaded in memory
#[tauri::command]
#[specta::specta]
pub async fn stt_loaded(app: AppHandle) -> bool {
    let state = app.state::<SpeechState>();
    *state.loaded.lock().unwrap()
}

/// TTS available via browser SpeechSynthesis
#[tauri::command]
#[specta::specta]
pub async fn tts_available() -> bool {
    true
}

// ─── WAV helpers ───────────────────────────────────────────────────────

fn wav_to_samples(wav_bytes: &[u8]) -> Result<Vec<f32>, String> {
    let cursor = std::io::Cursor::new(wav_bytes);
    let reader = hound::WavReader::new(cursor).map_err(|e| format!("WAV read: {}", e))?;
    let spec = reader.spec();
    let sample_rate = spec.sample_rate;
    let channels = spec.channels as usize;

    let samples_i16: Vec<i16> = reader
        .into_samples::<i16>()
        .filter_map(|s| s.ok())
        .collect();

    // Convert to f32
    let mut samples_f32: Vec<f32> = samples_i16
        .iter()
        .map(|&s| s as f32 / i16::MAX as f32)
        .collect();

    // Downmix to mono if stereo
    if channels > 1 {
        let mono: Vec<f32> = samples_f32
            .chunks(channels)
            .map(|ch| ch.iter().sum::<f32>() / channels as f32)
            .collect();
        samples_f32 = mono;
    }

    // Resample to 16kHz if needed
    if sample_rate != 16000 {
        samples_f32 = resample(&samples_f32, sample_rate as usize, 16000);
    }

    Ok(samples_f32)
}

fn resample(samples: &[f32], from_rate: usize, to_rate: usize) -> Vec<f32> {
    let ratio = from_rate as f64 / to_rate as f64;
    let new_len = (samples.len() as f64 / ratio) as usize;
    let mut out = Vec::with_capacity(new_len);
    for i in 0..new_len {
        let idx = i as f64 * ratio;
        let lo = idx as usize;
        let hi = (lo + 1).min(samples.len() - 1);
        let frac = idx - lo as f64;
        out.push(samples[lo] * (1.0 - frac as f32) + samples[hi] * frac as f32);
    }
    out
}

// ─── Base64 decode ─────────────────────────────────────────────────────

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    let data = if let Some(pos) = input.find(',') {
        &input[pos + 1..]
    } else {
        input
    };

    let clean: Vec<u8> = data.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    let mut output = Vec::new();
    let len = clean.len();
    let mut i = 0;

    while i + 3 < len {
        let a = b64_val(clean[i])?;
        let b = b64_val(clean[i + 1])?;
        let c = if clean[i + 2] != b'=' { b64_val(clean[i + 2])? } else { 0 };
        let d = if clean[i + 3] != b'=' { b64_val(clean[i + 3])? } else { 0 };

        output.push((a << 2) | (b >> 4));
        if clean[i + 2] != b'=' { output.push((b << 4) | (c >> 2)); }
        if clean[i + 3] != b'=' { output.push((c << 6) | d); }
        i += 4;
    }

    Ok(output)
}

fn b64_val(c: u8) -> Result<u8, String> {
    match c {
        b'A'..=b'Z' => Ok(c - b'A'),
        b'a'..=b'z' => Ok(c - b'a' + 26),
        b'0'..=b'9' => Ok(c - b'0' + 52),
        b'+' => Ok(62),
        b'/' => Ok(63),
        _ => Err(format!("Invalid base64 char: {}", c as char)),
    }
}
