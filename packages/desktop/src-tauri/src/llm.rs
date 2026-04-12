use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

const LLM_PORT: u16 = 14097;


// Latest llama.cpp with Hadamard rotation for KV cache (PR #21038)
const LLAMA_RELEASE_TAG: &str = "b8731";

fn llama_asset_name() -> String {
    let tag = LLAMA_RELEASE_TAG;
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    { format!("llama-{tag}-bin-win-vulkan-x64.zip") }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    { format!("llama-{tag}-bin-ubuntu-x64.tar.gz") }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    { format!("llama-{tag}-bin-ubuntu-arm64.tar.gz") }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    { format!("llama-{tag}-bin-macos-arm64.tar.gz") }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    { format!("llama-{tag}-bin-macos-x64.tar.gz") }
}

fn llama_server_exe() -> &'static str {
    if cfg!(windows) { "llama-server.exe" } else { "llama-server" }
}

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
    runtime_dir(app).join(llama_server_exe())
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
        LLAMA_RELEASE_TAG, llama_asset_name()
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
        return Err(format!("{} not found after extraction", llama_server_exe()));
    }

    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&server, fs::Permissions::from_mode(0o755));
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

    // Unload any existing model managed by this app
    {
        let state = app.state::<LlmServerState>();
        let mut child_guard = state.child.lock().unwrap();
        if let Some(ref mut child) = *child_guard {
            let _ = child.start_kill();
        }
        *child_guard = None;
        *state.active_model.lock().unwrap() = None;
    }

    // Check for orphaned llama-server on our port (e.g. from a crash or external launch)
    let client = reqwest::Client::new();
    if let Ok(resp) = client
        .get(format!("http://127.0.0.1:{}/props", LLM_PORT))
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
    {
        if resp.status().is_success() {
            // A server is already running — check if it has the right model
            let body = resp.text().await.unwrap_or_default();
            if body.contains(&filename) {
                tracing::info!("[LLM] Reusing existing llama-server with {}", filename);
                let state = app.state::<LlmServerState>();
                *state.active_model.lock().unwrap() = Some(filename.clone());
                return Ok(());
            }
            // Wrong model — kill the orphan via OS
            tracing::warn!("[LLM] Killing orphaned llama-server (wrong model) on port {}", LLM_PORT);
            #[cfg(windows)]
            {
                let _ = std::process::Command::new("cmd")
                    .args(["/C", &format!(
                        "for /f \"tokens=5\" %a in ('netstat -ano ^| findstr \"0.0.0.0:{}\" ^| findstr LISTENING') do taskkill /PID %a /F",
                        LLM_PORT
                    )])
                    .output();
            }
            #[cfg(unix)]
            {
                let _ = std::process::Command::new("sh")
                    .args(["-c", &format!("lsof -ti :{} | xargs -r kill -9", LLM_PORT)])
                    .output();
            }
            tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
        }
    }

    // Ensure llama-server runtime is available
    let server_exe = ensure_llama_runtime(&app).await?;

    tracing::info!(
        "[LLM] Starting llama-server with {} on port {}",
        filename,
        LLM_PORT
    );

    // Read settings from env vars (set by frontend via auto-start hook)
    let kv_cache_type = std::env::var("OPENCODE_KV_CACHE_TYPE").unwrap_or_else(|_| "q4_0".to_string());
    let offload_mode = std::env::var("OPENCODE_OFFLOAD_MODE").unwrap_or_else(|_| "auto".to_string());
    let mmap_mode = std::env::var("OPENCODE_MMAP_MODE").unwrap_or_else(|_| "auto".to_string());
    tracing::info!("[LLM] Config: kv={}, offload={}, mmap={}", kv_cache_type, offload_mode, mmap_mode);

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
        // KV cache quantization — read from user settings or default to q8_0
        // With llama.cpp b8731+, Hadamard rotation is auto-applied for better quality
        .arg("--cache-type-k")
        .arg(&kv_cache_type)
        .arg("--cache-type-v")
        .arg(&kv_cache_type)
        // Single slot to minimize VRAM usage
        .arg("-np")
        .arg("1")
        // CPU threads
        .arg("--threads")
        .arg(n_threads.to_string());

    // Memory mapping control
    match mmap_mode.as_str() {
        "off" => { cmd.arg("--no-mmap"); }
        "on" => { /* mmap is default, nothing to add */ }
        _ => { /* auto: let llama.cpp decide */ }
    }

    // GPU offloading mode
    match offload_mode.as_str() {
        "gpu-max" => {
            // Override fit to push maximum layers to GPU
            cmd.arg("-fitt").arg("256"); // leave only 256 MiB free
        }
        "balanced" => {
            // More conservative: leave plenty of VRAM headroom
            cmd.arg("-fitt").arg("1024");
        }
        _ => { /* auto: already configured with -fitt 512 */ }
    }

    // Speculative decoding: use a small draft model for 2-3x speedup
    let draft_model = std::env::var("OPENCODE_DRAFT_MODEL").ok();
    if let Some(ref draft) = draft_model {
        let draft_path = models_dir(&app).join(draft);
        if draft_path.exists() {
            // VRAM Guard: check if enough free VRAM for the draft model
            if check_vram_free(1500) {
                cmd.arg("--model-draft")
                    .arg(draft_path.to_string_lossy().to_string())
                    .arg("--draft")
                    .arg("16")
                    .arg("--draft-p-min")
                    .arg("0.75")
                    .arg("--gpu-layers-draft")
                    .arg("99");
                tracing::info!("[LLM] Speculative decoding enabled with {}", draft);
            } else {
                tracing::info!("[LLM] Speculative decoding skipped (insufficient VRAM)");
            }
        }
    }

    cmd.kill_on_drop(true);

    #[cfg(windows)]
    {
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

/// Check if enough free VRAM is available (for speculative decoding guard)
fn check_vram_free(min_mib: u64) -> bool {
    if let Ok(output) = std::process::Command::new("nvidia-smi")
        .args(["--query-gpu=memory.free", "--format=csv,noheader,nounits"])
        .output()
    {
        if output.status.success() {
            let free: u64 = String::from_utf8_lossy(&output.stdout)
                .trim()
                .lines()
                .next()
                .unwrap_or("0")
                .parse()
                .unwrap_or(0);
            return free >= min_mib;
        }
    }
    // Fallback: if can't detect, enable anyway (OOM rare with --fit on)
    true
}

/// Get GPU VRAM info (total, used, free) in MiB
#[derive(serde::Serialize, specta::Type)]
pub struct VramInfo {
    pub total_mib: u64,
    pub used_mib: u64,
    pub free_mib: u64,
    pub gpu_name: String,
}

#[tauri::command]
#[specta::specta]
pub async fn get_vram_info() -> Result<VramInfo, String> {
    // Try nvidia-smi
    if let Ok(output) = std::process::Command::new("nvidia-smi")
        .args(["--query-gpu=memory.total,memory.used,memory.free,name", "--format=csv,noheader,nounits"])
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(line) = stdout.lines().next() {
                let parts: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
                if parts.len() >= 4 {
                    return Ok(VramInfo {
                        total_mib: parts[0].parse().unwrap_or(0),
                        used_mib: parts[1].parse().unwrap_or(0),
                        free_mib: parts[2].parse().unwrap_or(0),
                        gpu_name: parts[3].to_string(),
                    });
                }
            }
        }
    }
    Err("GPU not detected (nvidia-smi not available)".to_string())
}

