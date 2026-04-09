use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

const LLM_PORT: u16 = 14097;


/// Latest llama.cpp release tag and asset for Windows Vulkan x64
const LLAMA_RELEASE_TAG: &str = "b8709";
const LLAMA_ASSET_NAME: &str = "llama-b8709-bin-win-vulkan-x64.zip";

fn data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("failed to resolve app data dir")
}

fn models_dir(app: &AppHandle) -> PathBuf {
    data_dir(app).join("models")
}

fn runtime_dir(app: &AppHandle) -> PathBuf {
    data_dir(app).join("llama-runtime")
}

fn llama_server_path(app: &AppHandle) -> PathBuf {
    runtime_dir(app).join("llama-server.exe")
}

// ─── State ─────────────────────────────────────────────────────────────

pub struct LlmServerState {
    pub child: Mutex<Option<tokio::process::Child>>,
    active_model: Mutex<Option<String>>,
}

impl LlmServerState {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            active_model: Mutex::new(None),
        }
    }
}

// ─── Data types ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ModelInfo {
    pub filename: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDownloadProgress {
    pub filename: String,
    pub downloaded: u64,
    pub total: u64,
    pub progress: f64,
}

// ─── Helpers ───────────────────────────────────────────────────────────

async fn download_file(
    app: &AppHandle,
    url: &str,
    target: &PathBuf,
    event_filename: Option<&str>,
) -> Result<(), String> {
    let part = target.with_extension("part");
    let client = reqwest::Client::new();
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut stream = resp.bytes_stream();
    let mut file = tokio::fs::File::create(&part)
        .await
        .map_err(|e| format!("File create: {}", e))?;

    let mut last_emit = std::time::Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Write: {}", e))?;
        downloaded += chunk.len() as u64;

        if let Some(fname) = event_filename {
            if last_emit.elapsed().as_millis() > 200 {
                let _ = app.emit(
                    "model-download-progress",
                    ModelDownloadProgress {
                        filename: fname.to_string(),
                        downloaded,
                        total,
                        progress: if total > 0 {
                            downloaded as f64 / total as f64
                        } else {
                            0.0
                        },
                    },
                );
                last_emit = std::time::Instant::now();
            }
        }
    }

    file.flush().await.map_err(|e| format!("Flush: {}", e))?;
    drop(file);

    tokio::fs::rename(&part, target)
        .await
        .map_err(|e| format!("Rename: {}", e))?;

    if let Some(fname) = event_filename {
        let _ = app.emit(
            "model-download-progress",
            ModelDownloadProgress {
                filename: fname.to_string(),
                downloaded: total,
                total,
                progress: 1.0,
            },
        );
    }

    Ok(())
}

async fn ensure_llama_runtime(app: &AppHandle) -> Result<PathBuf, String> {
    let server = llama_server_path(app);
    if server.exists() {
        return Ok(server);
    }

    tracing::info!("[LLM] Downloading llama.cpp runtime...");

    let rt_dir = runtime_dir(app);
    let _ = fs::create_dir_all(&rt_dir);

    let zip_url = format!(
        "https://github.com/ggml-org/llama.cpp/releases/download/{}/{}",
        LLAMA_RELEASE_TAG, LLAMA_ASSET_NAME
    );
    let zip_path = rt_dir.join("llama-runtime.zip");

    download_file(app, &zip_url, &zip_path, None).await?;

    // Extract zip
    tracing::info!("[LLM] Extracting runtime...");
    let zip_path_clone = zip_path.clone();
    let rt_dir_clone = rt_dir.clone();
    tokio::task::spawn_blocking(move || {
        let file = fs::File::open(&zip_path_clone).map_err(|e| format!("Open zip: {}", e))?;
        let mut archive =
            zip::ZipArchive::new(file).map_err(|e| format!("Read zip: {}", e))?;
        for i in 0..archive.len() {
            let mut entry = archive
                .by_index(i)
                .map_err(|e| format!("Zip entry: {}", e))?;
            let name = entry.name().to_string();
            if entry.is_dir() {
                continue;
            }
            // Extract just the filename (flatten directory structure)
            let fname = std::path::Path::new(&name)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            if fname.is_empty() {
                continue;
            }
            let out_path = rt_dir_clone.join(&fname);
            let mut out = fs::File::create(&out_path)
                .map_err(|e| format!("Create {}: {}", fname, e))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("Extract {}: {}", fname, e))?;
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Extract task: {}", e))?
    .map_err(|e| format!("Extract: {}", e))?;

    // Clean up zip
    let _ = fs::remove_file(&zip_path);

    if !server.exists() {
        return Err("llama-server.exe not found after extraction".to_string());
    }

    tracing::info!("[LLM] Runtime ready at {}", server.display());
    Ok(server)
}

// ─── Tauri commands ────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn list_models(app: AppHandle) -> Vec<ModelInfo> {
    let dir = models_dir(&app);
    let mut models = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "gguf").unwrap_or(false) {
                if let Ok(meta) = fs::metadata(&path) {
                    models.push(ModelInfo {
                        filename: path.file_name().unwrap().to_string_lossy().to_string(),
                        size: meta.len(),
                    });
                }
            }
        }
    }
    models
}

#[tauri::command]
#[specta::specta]
pub async fn download_model(
    app: AppHandle,
    url: String,
    filename: String,
) -> Result<(), String> {
    let dir = models_dir(&app);
    let _ = fs::create_dir_all(&dir);
    let target = dir.join(&filename);

    tracing::info!("[LLM] Downloading model {} -> {}", url, target.display());
    download_file(&app, &url, &target, Some(&filename)).await?;
    tracing::info!("[LLM] Model download complete: {}", filename);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_model(app: AppHandle, filename: String) -> Result<(), String> {
    let path = models_dir(&app).join(&filename);
    fs::remove_file(&path).map_err(|e| format!("Delete: {}", e))?;
    let part = models_dir(&app).join(format!("{}.part", &filename));
    let _ = fs::remove_file(&part);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn load_llm_model(app: AppHandle, filename: String) -> Result<(), String> {
    let model_path = models_dir(&app).join(&filename);
    if !model_path.exists() {
        return Err(format!("Model not found: {}", filename));
    }

    // Unload any existing model first
    {
        let state = app.state::<LlmServerState>();
        let mut child_guard = state.child.lock().unwrap();
        if let Some(ref mut child) = *child_guard {
            let _ = child.start_kill();
        }
        *child_guard = None;
        *state.active_model.lock().unwrap() = None;
    }

    // Ensure llama-server runtime is available
    let server_exe = ensure_llama_runtime(&app).await?;

    tracing::info!(
        "[LLM] Starting llama-server with {} on port {}",
        filename,
        LLM_PORT
    );

    // Detect physical CPU cores for thread count
    let n_threads = std::thread::available_parallelism()
        .map(|n| n.get() / 2) // use physical cores, not hyperthreads
        .unwrap_or(4)
        .max(2);

    let mut cmd = tokio::process::Command::new(&server_exe);
    cmd.arg("--model")
        .arg(model_path.to_string_lossy().to_string())
        .arg("--port")
        .arg(LLM_PORT.to_string())
        .arg("--host")
        .arg("127.0.0.1")
        // GPU: offload all layers, let --fit adjust if VRAM is tight
        .arg("--n-gpu-layers")
        .arg("99")
        // --fit auto-adjusts ctx_size and layer placement to available VRAM
        .arg("--fit")
        .arg("on")
        .arg("-fitt")
        .arg("512") // leave 512 MiB free for OS/display
        .arg("-fitc")
        .arg("16384") // never go below 16K context
        // Flash Attention for memory efficiency
        .arg("--flash-attn")
        .arg("on")
        // KV cache quantization: q8_0 = good quality + 47% VRAM savings
        .arg("--cache-type-k")
        .arg("q8_0")
        .arg("--cache-type-v")
        .arg("q8_0")
        // Single slot to minimize VRAM usage
        .arg("-np")
        .arg("1")
        // CPU threads
        .arg("--threads")
        .arg(n_threads.to_string())
        .kill_on_drop(true);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start llama-server: {}", e))?;

    {
        let state = app.state::<LlmServerState>();
        *state.child.lock().unwrap() = Some(child);
        *state.active_model.lock().unwrap() = Some(filename.clone());
    }

    // Wait for server to become healthy (up to 120s for large models)
    tracing::info!("[LLM] Waiting for server to become healthy...");
    let client = reqwest::Client::new();
    let start = std::time::Instant::now();
    loop {
        if start.elapsed().as_secs() > 120 {
            // Timeout - kill server
            let state = app.state::<LlmServerState>();
            let mut guard = state.child.lock().unwrap();
            if let Some(ref mut c) = *guard {
                let _ = c.start_kill();
            }
            *guard = None;
            *state.active_model.lock().unwrap() = None;
            return Err("Server failed to start within 120s".to_string());
        }

        // Check if process is still alive
        {
            let state = app.state::<LlmServerState>();
            let mut guard = state.child.lock().unwrap();
            if let Some(ref mut c) = *guard {
                match c.try_wait() {
                    Ok(Some(status)) => {
                        *guard = None;
                        return Err(format!("llama-server exited with {}", status));
                    }
                    Err(e) => {
                        *guard = None;
                        return Err(format!("Failed to check process: {}", e));
                    }
                    Ok(None) => {} // still running
                }
            }
        }

        match client
            .get(format!("http://127.0.0.1:{}/health", LLM_PORT))
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                tracing::info!("[LLM] Server healthy after {:?}", start.elapsed());
                return Ok(());
            }
            _ => {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn unload_llm_model(app: AppHandle) -> Result<(), String> {
    let child_opt = {
        let state = app.state::<LlmServerState>();
        let mut guard = state.child.lock().unwrap();
        let child = guard.take();
        *state.active_model.lock().unwrap() = None;
        child
    };
    if let Some(mut child) = child_opt {
        tracing::info!("[LLM] Stopping llama-server");
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn check_llm_health(app: AppHandle, _port: Option<u16>) -> bool {
    let state = app.try_state::<LlmServerState>();
    if state.is_none() {
        return false;
    }
    let client = reqwest::Client::new();
    match client
        .get(format!("http://127.0.0.1:{}/health", LLM_PORT))
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
    {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}

