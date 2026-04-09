use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

use crate::parakeet::ParakeetEngine;

const STT_MODEL_URL: &str = "https://github.com/Kieirra/murmure-model/releases/download/1.0.0/parakeet-tdt-0.6b-v3-int8.zip";

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
    stt_engine: Mutex<ParakeetEngine>,
    stt_loaded: Mutex<bool>,
}

impl SpeechState {
    pub fn new() -> Self {
        Self {
            stt_engine: Mutex::new(ParakeetEngine::new()),
            stt_loaded: Mutex::new(false),
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
        if *state.stt_loaded.lock().unwrap() { return Ok(()); }
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
        *state.stt_engine.lock().unwrap() = engine;
        *state.stt_loaded.lock().unwrap() = true;
    }
    tracing::info!("[STT] Model loaded in {:?}", start.elapsed());
    Ok(())
}

#[tauri::command]
pub async fn stt_transcribe(app: AppHandle, audio_base64: String) -> Result<String, String> {
    {
        let state = app.state::<SpeechState>();
        if !*state.stt_loaded.lock().unwrap() {
            drop(state);
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
        let mut engine = state.stt_engine.lock().unwrap();
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
    let guard = state.stt_loaded.lock().unwrap();
    let val = *guard;
    drop(guard);
    val
}

// ─── TTS (browser SpeechSynthesis fallback on mobile) ──────────────────

#[tauri::command]
pub async fn tts_start(_app: AppHandle) -> Result<u16, String> {
    // TTS handled by browser SpeechSynthesis on mobile
    Err("Use browser SpeechSynthesis on mobile".to_string())
}

#[tauri::command]
pub async fn tts_speak(_app: AppHandle, _text: String, _voice: Option<String>) -> Result<String, String> {
    Err("Use browser SpeechSynthesis on mobile".to_string())
}

#[tauri::command]
pub async fn tts_stop(_app: AppHandle) -> Result<(), String> { Ok(()) }

#[tauri::command]
pub async fn tts_available() -> bool { false }

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
