use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::parakeet::ParakeetEngine;

const STT_MODEL_URL: &str = "https://github.com/Kieirra/murmure-model/releases/download/1.0.0/parakeet-tdt-0.6b-v3-int8.zip";
const TTS_PORT: u16 = 14100;

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

fn find_pocket_tts() -> Option<PathBuf> {
    let exe_name = if cfg!(windows) { "pocket-tts.exe" } else { "pocket-tts" };

    // Windows: check Python Scripts dirs
    #[cfg(windows)]
    if let Some(home) = dirs::home_dir() {
        let base = home.join("AppData").join("Local").join("Programs").join("Python");
        if let Ok(entries) = fs::read_dir(&base) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    let exe = p.join("Scripts").join(exe_name);
                    if exe.exists() { return Some(exe); }
                }
            }
        }
    }

    // Unix: check common locations
    #[cfg(not(windows))]
    if let Some(home) = dirs::home_dir() {
        for dir in &[
            home.join(".local").join("bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/bin"),
        ] {
            let p = dir.join(exe_name);
            if p.exists() { return Some(p); }
        }
    }

    // Fallback: which/where
    let which = if cfg!(windows) { "where" } else { "which" };
    if let Ok(output) = std::process::Command::new(which).arg("pocket-tts").output() {
        if output.status.success() {
            if let Some(line) = String::from_utf8_lossy(&output.stdout).lines().next() {
                let p = PathBuf::from(line.trim());
                if p.exists() { return Some(p); }
            }
        }
    }
    None
}

fn find_python_dir() -> Option<String> {
    let python = if cfg!(windows) { "python.exe" } else { "python3" };
    let which = if cfg!(windows) { "where" } else { "which" };

    #[cfg(windows)]
    if let Some(home) = dirs::home_dir() {
        let base = home.join("AppData").join("Local").join("Programs").join("Python");
        if let Ok(entries) = fs::read_dir(&base) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() && p.join(python).exists() {
                    return Some(p.to_string_lossy().to_string());
                }
            }
        }
    }

    if let Ok(output) = std::process::Command::new(which).arg(python).output() {
        if output.status.success() {
            if let Some(line) = String::from_utf8_lossy(&output.stdout).lines().next() {
                if let Some(parent) = std::path::Path::new(line.trim()).parent() {
                    return Some(parent.to_string_lossy().to_string());
                }
            }
        }
    }
    None
}

// ─── State ─────────────────────────────────────────────────────────────

pub struct SpeechState {
    stt_engine: Mutex<ParakeetEngine>,
    stt_loaded: Mutex<bool>,
    tts_child: Mutex<Option<tokio::process::Child>>,
}

impl SpeechState {
    pub fn new() -> Self {
        Self {
            stt_engine: Mutex::new(ParakeetEngine::new()),
            stt_loaded: Mutex::new(false),
            tts_child: Mutex::new(None),
        }
    }
}

// ─── STT (Parakeet) ───────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
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

    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    use futures::StreamExt;
    use tokio::io::AsyncWriteExt;

    let mut file = tokio::fs::File::create(&zip_path).await.map_err(|e| format!("Create: {}", e))?;
    let mut last_emit = std::time::Instant::now();
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream: {}", e))?;
        file.write_all(&chunk).await.map_err(|e| format!("Write: {}", e))?;
        downloaded += chunk.len() as u64;
        if last_emit.elapsed().as_millis() > 300 {
            let progress = if total > 0 { downloaded as f64 / total as f64 } else { 0.0 };
            let _ = app.emit("stt-download-progress", progress);
            last_emit = std::time::Instant::now();
        }
    }
    file.flush().await.map_err(|e| format!("Flush: {}", e))?;
    drop(file);

    tracing::info!("[STT] Extracting model...");
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
#[specta::specta]
pub async fn stt_load_model(app: AppHandle) -> Result<(), String> {
    {
        let state = app.state::<SpeechState>();
        if *state.stt_loaded.lock().unwrap() {
            return Ok(());
        }
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
#[specta::specta]
pub async fn stt_transcribe(app: AppHandle, audio_base64: String) -> Result<String, String> {
    {
        let state = app.state::<SpeechState>();
        if !*state.stt_loaded.lock().unwrap() {
            drop(state);
            stt_load_model(app.clone()).await?;
        }
    }

    let audio_bytes = base64_decode(&audio_base64)?;
    tracing::info!("[STT] Transcribing {} bytes", audio_bytes.len());

    let samples = tokio::task::spawn_blocking(move || wav_to_samples(&audio_bytes))
        .await
        .map_err(|e| format!("Task: {}", e))?
        .map_err(|e| format!("WAV: {}", e))?;

    tracing::info!("[STT] {} samples ({:.1}s)", samples.len(), samples.len() as f64 / 16000.0);

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
#[specta::specta]
pub async fn stt_available(app: AppHandle) -> bool {
    model_dir(&app).join("encoder-model.int8.onnx").exists()
}

#[tauri::command]
#[specta::specta]
pub async fn stt_loaded(app: AppHandle) -> bool {
    let state = app.state::<SpeechState>();
    *state.stt_loaded.lock().unwrap()
}

// ─── TTS (Pocket TTS) ─────────────────────────────────────────────────

/// Start Pocket TTS server (keeps model in memory for fast synthesis)
#[tauri::command]
#[specta::specta]
pub async fn tts_start(app: AppHandle) -> Result<u16, String> {
    // Check if already running
    let has_child = {
        let state = app.state::<SpeechState>();
        state.tts_child.lock().unwrap().is_some()
    };

    if has_child {
        let client = reqwest::Client::new();
        if let Ok(resp) = client
            .get(format!("http://127.0.0.1:{}/health", TTS_PORT))
            .timeout(std::time::Duration::from_secs(1))
            .send()
            .await
        {
            if resp.status().is_success() {
                return Ok(TTS_PORT);
            }
        }
    }

    // Kill existing
    {
        let state = app.state::<SpeechState>();
        if let Some(mut c) = state.tts_child.lock().unwrap().take() {
            let _ = c.start_kill();
        }
    }

    let pocket_tts = find_pocket_tts().ok_or("pocket-tts not found. Run: pip install pocket-tts")?;

    tracing::info!("[TTS] Starting Pocket TTS server on port {}", TTS_PORT);

    let mut cmd = tokio::process::Command::new(&pocket_tts);
    cmd.arg("serve")
        .arg("--port")
        .arg(TTS_PORT.to_string())
        .arg("--host")
        .arg("127.0.0.1")
        .kill_on_drop(true);

    // Add Python to PATH
    if let Some(py_dir) = find_python_dir() {
        let path = std::env::var("PATH").unwrap_or_default();
        let sep = if cfg!(windows) { ";" } else { ":" };
        cmd.env("PATH", format!("{}{}{}", py_dir, sep, path));
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let child = cmd.spawn().map_err(|e| format!("Spawn: {}", e))?;

    {
        let state = app.state::<SpeechState>();
        *state.tts_child.lock().unwrap() = Some(child);
    }

    // Wait for server to be ready
    let client = reqwest::Client::new();
    let start = std::time::Instant::now();
    loop {
        if start.elapsed().as_secs() > 60 {
            let state = app.state::<SpeechState>();
            if let Some(mut c) = state.tts_child.lock().unwrap().take() {
                let _ = c.start_kill();
            }
            return Err("TTS server failed to start".to_string());
        }
        if let Ok(resp) = client
            .get(format!("http://127.0.0.1:{}/health", TTS_PORT))
            .timeout(std::time::Duration::from_secs(1))
            .send()
            .await
        {
            if resp.status().is_success() {
                tracing::info!("[TTS] Pocket TTS ready after {:?}", start.elapsed());
                return Ok(TTS_PORT);
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
}

/// Synthesize text to speech via Pocket TTS HTTP API, returns base64 WAV
#[tauri::command]
#[specta::specta]
pub async fn tts_speak(app: AppHandle, text: String, voice: Option<String>) -> Result<String, String> {
    // Ensure server running
    tts_start(app.clone()).await?;

    let voice_name = voice.unwrap_or_else(|| "alba".to_string());

    // Truncate to ~300 chars at sentence boundary
    let text = if text.len() > 300 {
        let truncated = &text[..text.char_indices()
            .take_while(|(i, _)| *i < 300)
            .last()
            .map(|(i, c)| i + c.len_utf8())
            .unwrap_or(300)];
        let end = truncated
            .rfind(|c: char| c == '.' || c == '!' || c == '?' || c == '\n')
            .map(|i| i + 1)
            .unwrap_or(truncated.len());
        text[..end].to_string()
    } else {
        text
    };

    tracing::info!("[TTS] Synthesizing {} chars with voice {}", text.len(), voice_name);
    let start = std::time::Instant::now();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    // Check if voice is a custom clone (file exists in voices dir)
    let clone_path = speech_dir(&app).join("voices").join(format!("{}.wav", &voice_name));
    let form = if clone_path.exists() {
        // Voice cloning: send the WAV file
        let wav_bytes = fs::read(&clone_path).map_err(|e| format!("Read clone: {}", e))?;
        let part = reqwest::multipart::Part::bytes(wav_bytes)
            .file_name(format!("{}.wav", voice_name))
            .mime_str("audio/wav")
            .map_err(|e| e.to_string())?;
        reqwest::multipart::Form::new()
            .text("text", text)
            .part("voice_wav", part)
    } else {
        // Built-in voice
        reqwest::multipart::Form::new()
            .text("text", text)
            .text("voice", voice_name)
    };

    let resp = client
        .post(format!("http://127.0.0.1:{}/tts", TTS_PORT))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("TTS request: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("TTS HTTP {}", resp.status()));
    }

    let wav_bytes = resp.bytes().await.map_err(|e| format!("TTS read: {}", e))?;
    tracing::info!("[TTS] Generated {} bytes WAV in {:?}", wav_bytes.len(), start.elapsed());

    Ok(base64_encode(&wav_bytes))
}

/// Stop TTS server
#[tauri::command]
#[specta::specta]
pub async fn tts_stop(app: AppHandle) -> Result<(), String> {
    let child_opt = {
        let state = app.state::<SpeechState>();
        state.tts_child.lock().unwrap().take()
    };
    if let Some(mut child) = child_opt {
        tracing::info!("[TTS] Stopping Pocket TTS");
        let _ = child.start_kill();
    }
    Ok(())
}

/// Save a voice clone WAV file for Pocket TTS
#[tauri::command]
#[specta::specta]
pub async fn tts_save_voice_clone(app: AppHandle, audio_base64: String, name: String) -> Result<String, String> {
    let dir = speech_dir(&app).join("voices");
    let _ = fs::create_dir_all(&dir);

    let audio_bytes = base64_decode(&audio_base64)?;
    let wav_path = dir.join(format!("{}.wav", name));
    fs::write(&wav_path, &audio_bytes).map_err(|e| format!("Write: {}", e))?;

    tracing::info!("[TTS] Saved voice clone '{}' ({} bytes)", name, audio_bytes.len());
    Ok(wav_path.to_string_lossy().to_string())
}

/// List saved voice clones
#[tauri::command]
#[specta::specta]
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

/// Delete a voice clone
#[tauri::command]
#[specta::specta]
pub async fn tts_delete_voice_clone(app: AppHandle, name: String) -> Result<(), String> {
    let path = speech_dir(&app).join("voices").join(format!("{}.wav", name));
    fs::remove_file(&path).map_err(|e| format!("Delete: {}", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn tts_available() -> bool {
    find_pocket_tts().is_some()
}

// ─── WAV helpers ───────────────────────────────────────────────────────

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
        samples = samples.chunks(spec.channels as usize).map(|c| c.iter().sum::<f32>() / c.len() as f32).collect();
    }
    if spec.sample_rate != 16000 {
        samples = resample(&samples, spec.sample_rate as usize, 16000);
    }
    Ok(samples)
}

fn resample(samples: &[f32], from: usize, to: usize) -> Vec<f32> {
    let ratio = from as f64 / to as f64;
    let len = (samples.len() as f64 / ratio) as usize;
    (0..len)
        .map(|i| {
            let idx = i as f64 * ratio;
            let lo = idx as usize;
            let hi = (lo + 1).min(samples.len() - 1);
            let f = (idx - lo as f64) as f32;
            samples[lo] * (1.0 - f) + samples[hi] * f
        })
        .collect()
}

// ─── Base64 ────────────────────────────────────────────────────────────

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

fn base64_encode(data: &[u8]) -> String {
    const C: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(C[((n >> 18) & 63) as usize] as char);
        out.push(C[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { C[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { C[(n & 63) as usize] as char } else { '=' });
    }
    out
}
