use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

#[cfg(feature = "onnx")]
use crate::kokoro::KokoroEngine;
#[cfg(feature = "onnx")]
use crate::parakeet::ParakeetEngine;

#[cfg(feature = "onnx")]
const STT_MODEL_URL: &str = "https://github.com/Kieirra/murmure-model/releases/download/1.0.0/parakeet-tdt-0.6b-v3-int8.zip";
#[cfg(feature = "onnx")]
const KOKORO_MODEL_URL: &str = "https://github.com/Kieirra/murmure-model/releases/download/1.0.0/kokoro-v1.0.onnx";
#[cfg(feature = "onnx")]
const KOKORO_VOICES_URL: &str = "https://github.com/Kieirra/murmure-model/releases/download/1.0.0/voices-v1.0.bin";
const TTS_PORT: u16 = 14100;

/// Monotonic counter for chunk WAV filenames. Using only Date.now()-style
/// timestamps causes collisions when parallel tts_speak calls land in the
/// same millisecond — the second write overwrites the first and the
/// frontend ends up replaying the same audio.
static CHUNK_COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

fn next_chunk_filename() -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let n = CHUNK_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("chunk_{}_{}.wav", ts, n)
}

fn data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("failed to resolve app data dir")
}

#[cfg(feature = "onnx")]
fn model_dir(app: &AppHandle) -> PathBuf {
    data_dir(app).join("speech").join("parakeet-tdt-0.6b-v3-int8")
}

fn speech_dir(app: &AppHandle) -> PathBuf {
    data_dir(app).join("speech")
}

#[cfg(feature = "onnx")]
fn kokoro_dir(app: &AppHandle) -> PathBuf {
    data_dir(app).join("speech").join("kokoro")
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
    #[cfg(feature = "onnx")]
    stt_engine: Mutex<ParakeetEngine>,
    #[cfg(feature = "onnx")]
    stt_loaded: Mutex<bool>,
    tts_child: Mutex<Option<tokio::process::Child>>,
    tts_ready: Mutex<bool>,
    tts_client: reqwest::Client,
    #[cfg(feature = "onnx")]
    kokoro_engine: Mutex<KokoroEngine>,
    #[cfg(feature = "onnx")]
    kokoro_loaded: Mutex<bool>,
}

impl SpeechState {
    pub fn new() -> Self {
        Self {
            #[cfg(feature = "onnx")]
            stt_engine: Mutex::new(ParakeetEngine::new()),
            #[cfg(feature = "onnx")]
            stt_loaded: Mutex::new(false),
            tts_child: Mutex::new(None),
            tts_ready: Mutex::new(false),
            tts_client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(60))
                // Allow up to 4 idle connections per host so reqwest can run
                // multiple parallel POSTs to the same TTS server without queuing.
                .pool_max_idle_per_host(4)
                .tcp_nodelay(true)
                .build()
                .expect("Failed to create HTTP client"),
            #[cfg(feature = "onnx")]
            kokoro_engine: Mutex::new(KokoroEngine::new()),
            #[cfg(feature = "onnx")]
            kokoro_loaded: Mutex::new(false),
        }
    }
}

// ─── STT (Parakeet) ───────────────────────────────────────────────────

#[cfg(feature = "onnx")]
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

#[cfg(feature = "onnx")]
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

#[cfg(feature = "onnx")]
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

#[cfg(feature = "onnx")]
#[tauri::command]
#[specta::specta]
pub async fn stt_available(app: AppHandle) -> bool {
    model_dir(&app).join("encoder-model.int8.onnx").exists()
}

#[cfg(feature = "onnx")]
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
    // Fast path: already running and confirmed healthy
    {
        let state = app.state::<SpeechState>();
        if *state.tts_ready.lock().unwrap() && state.tts_child.lock().unwrap().is_some() {
            return Ok(TTS_PORT);
        }
    }

    // Kill any existing child that may be in a bad state
    {
        let state = app.state::<SpeechState>();
        if let Some(mut c) = state.tts_child.lock().unwrap().take() {
            let _ = c.start_kill();
        }
        *state.tts_ready.lock().unwrap() = false;
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

    if let Some(py_dir) = find_python_dir() {
        let path = std::env::var("PATH").unwrap_or_default();
        let sep = if cfg!(windows) { ";" } else { ":" };
        cmd.env("PATH", format!("{}{}{}", py_dir, sep, path));
    }

    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let child = cmd.spawn().map_err(|e| format!("Spawn: {}", e))?;

    {
        let state = app.state::<SpeechState>();
        *state.tts_child.lock().unwrap() = Some(child);
    }

    // Clone client so we don't hold the State across await points
    let client = {
        let state = app.state::<SpeechState>();
        state.tts_client.clone()
    };

    // Wait for server ready
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
                {
                    let state = app.state::<SpeechState>();
                    *state.tts_ready.lock().unwrap() = true;
                }
                tracing::info!("[TTS] Pocket TTS ready after {:?}", start.elapsed());

                // Warmup: force model load with a tiny synthesis
                let warmup = reqwest::multipart::Form::new()
                    .text("text", ".")
                    .text("voice_url", "alba");
                let _ = client
                    .post(format!("http://127.0.0.1:{}/tts", TTS_PORT))
                    .multipart(warmup)
                    .send()
                    .await;
                tracing::info!("[TTS] Warmup done in {:?}", start.elapsed());

                return Ok(TTS_PORT);
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
}

/// Build multipart form for Pocket TTS (text + voice_url or voice_wav clone)
fn build_tts_form(app: &AppHandle, text: &str, voice_name: &str) -> Result<reqwest::multipart::Form, String> {
    let clone_path = speech_dir(app).join("voices").join(format!("{}.wav", voice_name));
    if clone_path.exists() {
        let wav_bytes = fs::read(&clone_path).map_err(|e| format!("Read clone: {}", e))?;
        let part = reqwest::multipart::Part::bytes(wav_bytes)
            .file_name(format!("{}.wav", voice_name))
            .mime_str("audio/wav")
            .map_err(|e| e.to_string())?;
        Ok(reqwest::multipart::Form::new()
            .text("text", text.to_string())
            .part("voice_wav", part))
    } else {
        // Pocket TTS API uses "voice_url" for predefined voice names (alba, marius, etc.)
        Ok(reqwest::multipart::Form::new()
            .text("text", text.to_string())
            .text("voice_url", voice_name.to_string()))
    }
}

/// Synthesize text via Pocket TTS HTTP API.
/// Buffers the full response and writes a single complete WAV file.
/// Sentence-level chunking in the frontend handles latency for long texts.
#[tauri::command]
#[specta::specta]
pub async fn tts_speak(app: AppHandle, text: String, voice: Option<String>) -> Result<String, String> {
    // Ensure server is running
    {
        let state = app.state::<SpeechState>();
        let ready = *state.tts_ready.lock().unwrap();
        if !ready {
            drop(state);
            tts_start(app.clone()).await?;
        }
    }

    let voice_name = voice.unwrap_or_else(|| "alba".to_string());

    tracing::info!("[TTS] Synthesizing {} chars with voice {}", text.len(), voice_name);
    let start = std::time::Instant::now();

    let form = build_tts_form(&app, &text, &voice_name)?;

    // Clone client so we don't hold the State across await
    let client = {
        let state = app.state::<SpeechState>();
        state.tts_client.clone()
    };

    let resp = client
        .post(format!("http://127.0.0.1:{}/tts", TTS_PORT))
        .multipart(form)
        .send()
        .await;

    let resp = match resp {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            let state = app.state::<SpeechState>();
            *state.tts_ready.lock().unwrap() = false;
            return Err(format!("TTS HTTP {}", r.status()));
        }
        Err(e) => {
            tracing::warn!("[TTS] Request failed, retrying: {}", e);
            {
                let state = app.state::<SpeechState>();
                *state.tts_ready.lock().unwrap() = false;
            }
            tts_start(app.clone()).await?;
            let retry_form = build_tts_form(&app, &text, &voice_name)?;
            client
                .post(format!("http://127.0.0.1:{}/tts", TTS_PORT))
                .multipart(retry_form)
                .send()
                .await
                .map_err(|e| format!("TTS retry failed: {}", e))?
        }
    };

    // Buffer full response and write a single complete WAV file.
    // With voice_url fix, Pocket TTS does ~300 chars in ~300ms — no need
    // for intra-request streaming. Sentence-level chunking in the frontend
    // handles latency for long texts.
    let out_dir = speech_dir(&app).join("tts_chunks");
    let _ = fs::create_dir_all(&out_dir);
    let out_path = out_dir.join(next_chunk_filename());

    let wav_bytes = resp.bytes().await.map_err(|e| format!("Read response: {}", e))?;
    fs::write(&out_path, &wav_bytes).map_err(|e| format!("Write WAV: {}", e))?;
    tracing::info!("[TTS] Synthesized {} bytes in {:?}", wav_bytes.len(), start.elapsed());

    Ok(out_path.to_string_lossy().to_string())
}

/// Stop TTS server
#[tauri::command]
#[specta::specta]
pub async fn tts_stop(app: AppHandle) -> Result<(), String> {
    let state = app.state::<SpeechState>();
    tracing::info!("[TTS] Stopping Pocket TTS");
    *state.tts_ready.lock().unwrap() = false;
    if let Some(mut child) = state.tts_child.lock().unwrap().take() {
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

/// Delete all temp WAV chunk files
#[tauri::command]
#[specta::specta]
pub async fn tts_cleanup_chunks(app: AppHandle) -> Result<(), String> {
    let dir = speech_dir(&app).join("tts_chunks");
    if dir.exists() {
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    Ok(())
}

// ─── Kokoro TTS (ONNX, built-in) ─────────────────────────────────────

#[cfg(feature = "onnx")]
#[tauri::command]
#[specta::specta]
pub async fn kokoro_available(app: AppHandle) -> bool {
    let dir = kokoro_dir(&app);
    dir.join("kokoro-v1.0.onnx").exists() && dir.join("voices-v1.0.bin").exists()
}

#[cfg(feature = "onnx")]
#[tauri::command]
#[specta::specta]
pub async fn kokoro_download_model(app: AppHandle) -> Result<(), String> {
    let dir = kokoro_dir(&app);
    let _ = fs::create_dir_all(&dir);

    let model_path = dir.join("kokoro-v1.0.onnx");
    let voices_path = dir.join("voices-v1.0.bin");

    if model_path.exists() && voices_path.exists() {
        return Ok(());
    }

    let client = reqwest::Client::new();

    // Download model
    if !model_path.exists() {
        tracing::info!("[Kokoro] Downloading model...");
        let resp = client.get(KOKORO_MODEL_URL).send().await.map_err(|e| format!("Download model: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }
        let total = resp.content_length().unwrap_or(0);
        let mut downloaded: u64 = 0;
        use futures::StreamExt;
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
        tracing::info!("[Kokoro] Model downloaded");
    }

    // Download voices
    if !voices_path.exists() {
        tracing::info!("[Kokoro] Downloading voices...");
        let resp = client.get(KOKORO_VOICES_URL).send().await.map_err(|e| format!("Download voices: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }
        let bytes = resp.bytes().await.map_err(|e| format!("Read: {}", e))?;
        fs::write(&voices_path, &bytes).map_err(|e| format!("Write: {}", e))?;
        tracing::info!("[Kokoro] Voices downloaded");
    }

    let _ = app.emit("kokoro-download-progress", 1.0_f64);
    Ok(())
}

#[cfg(feature = "onnx")]
#[tauri::command]
#[specta::specta]
pub async fn kokoro_load(app: AppHandle) -> Result<(), String> {
    {
        let state = app.state::<SpeechState>();
        if *state.kokoro_loaded.lock().unwrap() {
            return Ok(());
        }
    }

    let dir = kokoro_dir(&app);
    let model_path = dir.join("kokoro-v1.0.onnx");
    let voices_path = dir.join("voices-v1.0.bin");

    if !model_path.exists() || !voices_path.exists() {
        return Err("Kokoro model not downloaded".to_string());
    }

    tracing::info!("[Kokoro] Loading model...");
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
        *state.kokoro_engine.lock().unwrap() = engine;
        *state.kokoro_loaded.lock().unwrap() = true;
    }
    tracing::info!("[Kokoro] Model loaded in {:?}", start.elapsed());
    Ok(())
}

#[cfg(feature = "onnx")]
#[tauri::command]
#[specta::specta]
pub async fn kokoro_loaded(app: AppHandle) -> bool {
    let state = app.state::<SpeechState>();
    *state.kokoro_loaded.lock().unwrap()
}

#[cfg(feature = "onnx")]
#[tauri::command]
#[specta::specta]
pub async fn kokoro_voices(app: AppHandle) -> Vec<String> {
    let state = app.state::<SpeechState>();
    let engine = state.kokoro_engine.lock().unwrap();
    let mut names = engine.voice_names();
    names.sort();
    names
}

/// Synthesize text with Kokoro ONNX engine, returns file path to WAV
#[cfg(feature = "onnx")]
#[tauri::command]
#[specta::specta]
pub async fn kokoro_synthesize(app: AppHandle, text: String, voice: String, speed: f32) -> Result<String, String> {
    // Ensure loaded
    {
        let state = app.state::<SpeechState>();
        if !*state.kokoro_loaded.lock().unwrap() {
            drop(state);
            kokoro_load(app.clone()).await?;
        }
    }

    tracing::info!("[Kokoro] Synthesizing {} chars with voice {}", text.len(), voice);
    let start = std::time::Instant::now();

    let app_clone = app.clone();
    let voice_clone = voice.clone();
    let samples = tokio::task::spawn_blocking(move || {
        let state = app_clone.state::<SpeechState>();
        let mut engine = state.kokoro_engine.lock().unwrap();
        engine.synthesize(&text, &voice_clone, speed)
    })
    .await
    .map_err(|e| format!("Task: {}", e))?
    .map_err(|e| format!("Synthesis: {}", e))?;

    tracing::info!("[Kokoro] Synthesized {} samples in {:?}", samples.len(), start.elapsed());

    // Encode to WAV and write to unique temp file
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
        let clamped = s.max(-1.0).min(1.0);
        let i16_val = if clamped < 0.0 { (clamped * 32768.0) as i16 } else { (clamped * 32767.0) as i16 };
        writer.write_sample(i16_val).map_err(|e| format!("WAV write: {}", e))?;
    }
    writer.finalize().map_err(|e| format!("WAV finalize: {}", e))?;

    Ok(out_path.to_string_lossy().to_string())
}

// ─── WAV helpers ───────────────────────────────────────────────────────

#[cfg(feature = "onnx")]
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

#[cfg(feature = "onnx")]
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

