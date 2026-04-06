use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::runtime::{native_lib_dir, runtime_dir};

const LLM_DEFAULT_PORT: u32 = 14097;

/// Static storage for the LLM server child process.
static LLM_PROCESS: Mutex<Option<Child>> = Mutex::new(None);

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ModelInfo {
    pub filename: String,
    pub size: u64,
}

#[derive(Clone, Serialize, Debug)]
struct ModelDownloadProgress {
    filename: String,
    downloaded: u64,
    total: u64,
    progress: f64,
}

fn models_dir(app: &AppHandle) -> PathBuf {
    runtime_dir(app).join("models")
}

// ─── Tauri Commands ─────────────────────────────────────────────────

/// List available models in the models directory.
#[tauri::command]
pub async fn list_models(app: AppHandle) -> Vec<ModelInfo> {
    let dir = models_dir(&app);
    let mut models = Vec::new();

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("gguf") {
                if let Ok(meta) = fs::metadata(&path) {
                    models.push(ModelInfo {
                        filename: entry.file_name().to_string_lossy().to_string(),
                        size: meta.len(),
                    });
                }
            }
        }
    }

    models
}

/// Download a GGUF model from a URL (HuggingFace).
/// Streams the download and emits "model-download-progress" events.
#[tauri::command]
pub async fn download_model(
    app: AppHandle,
    url: String,
    filename: String,
) -> Result<(), String> {
    use futures_util::StreamExt;

    let dir = models_dir(&app);
    fs::create_dir_all(&dir).map_err(|e| format!("Create models dir: {}", e))?;

    let dest = dir.join(&filename);
    let tmp_dest = dir.join(format!("{}.part", &filename));

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3600)) // 1 hour for large models
        .build()
        .map_err(|e| format!("HTTP client: {}", e))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed with status: {}", resp.status()));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    let mut file = fs::File::create(&tmp_dest)
        .map_err(|e| format!("Create file: {}", e))?;

    let mut stream = resp.bytes_stream();
    let mut last_emit = std::time::Instant::now();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {}", e))?;
        std::io::Write::write_all(&mut file, &chunk)
            .map_err(|e| format!("Write error: {}", e))?;

        downloaded += chunk.len() as u64;

        // Emit progress at most every 200ms to avoid flooding
        if last_emit.elapsed() >= Duration::from_millis(200) || downloaded == total {
            let progress = if total > 0 {
                downloaded as f64 / total as f64
            } else {
                0.0
            };
            let _ = app.emit(
                "model-download-progress",
                ModelDownloadProgress {
                    filename: filename.clone(),
                    downloaded,
                    total,
                    progress,
                },
            );
            last_emit = std::time::Instant::now();
        }
    }

    // Rename .part to final filename
    fs::rename(&tmp_dest, &dest)
        .map_err(|e| format!("Rename downloaded file: {}", e))?;

    eprintln!("[OpenCode LLM] Downloaded model {} ({} bytes)", filename, downloaded);
    Ok(())
}

/// Delete a downloaded model.
#[tauri::command]
pub async fn delete_model(app: AppHandle, filename: String) -> Result<(), String> {
    let path = models_dir(&app).join(&filename);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Delete model: {}", e))?;
        eprintln!("[OpenCode LLM] Deleted model {}", filename);
    }
    // Also remove any partial download
    let part_path = models_dir(&app).join(format!("{}.part", &filename));
    let _ = fs::remove_file(&part_path);
    Ok(())
}

/// Start the local LLM server (llama-server).
#[tauri::command]
pub async fn start_llm_server(
    app: AppHandle,
    model: String,
    port: Option<u32>,
) -> Result<(), String> {
    let port = port.unwrap_or(LLM_DEFAULT_PORT);
    let dir = runtime_dir(&app);
    let model_path = dir.join("models").join(&model);

    if !model_path.exists() {
        return Err(format!("Model not found: {}", model));
    }

    let nlib_dir = native_lib_dir(&dir)
        .ok_or_else(|| "nativeLibraryDir not found. Restart the app.".to_string())?;

    let ld_musl = nlib_dir.join("libmusl_linker.so");
    let llama_server = nlib_dir.join("libllama_server.so");

    if !llama_server.exists() {
        return Err(format!(
            "llama-server not found at {}. The LLM binary needs to be added to the APK.",
            llama_server.display()
        ));
    }

    // Kill any existing LLM server
    if let Ok(mut guard) = LLM_PROCESS.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
        }
    }

    // Library search path
    let lib_link_dir = dir.join("lib_links");
    let lib_path = format!("{}:{}", lib_link_dir.display(), nlib_dir.display());

    let (cmd_path, cmd_args) = if ld_musl.exists() {
        (
            ld_musl,
            vec![
                "--library-path".to_string(),
                lib_path.clone(),
                llama_server.to_string_lossy().to_string(),
                "-m".to_string(),
                model_path.to_string_lossy().to_string(),
                "--host".to_string(),
                "127.0.0.1".to_string(),
                "--port".to_string(),
                port.to_string(),
                "-ngl".to_string(),
                "0".to_string(),
                "--ctx-size".to_string(),
                "4096".to_string(),
            ],
        )
    } else {
        (
            llama_server.clone(),
            vec![
                "-m".to_string(),
                model_path.to_string_lossy().to_string(),
                "--host".to_string(),
                "127.0.0.1".to_string(),
                "--port".to_string(),
                port.to_string(),
                "-ngl".to_string(),
                "0".to_string(),
                "--ctx-size".to_string(),
                "4096".to_string(),
            ],
        )
    };

    eprintln!("[OpenCode LLM] Spawning: {} {:?}", cmd_path.display(), cmd_args);

    // Log files
    let log_dir = dir.join("logs");
    let _ = fs::create_dir_all(&log_dir);
    let stdout_file = fs::File::create(log_dir.join("llm_stdout.log"))
        .map_err(|e| format!("Create stdout log: {}", e))?;
    let stderr_file = fs::File::create(log_dir.join("llm_stderr.log"))
        .map_err(|e| format!("Create stderr log: {}", e))?;

    let sys_path = std::env::var("PATH").unwrap_or_default();
    let path_env = format!("{}:{}", nlib_dir.display(), sys_path);

    let mut child = Command::new(&cmd_path)
        .args(&cmd_args)
        .env("PATH", &path_env)
        .env("LD_LIBRARY_PATH", &lib_path)
        .stdout(stdout_file)
        .stderr(stderr_file)
        .spawn()
        .map_err(|e| format!("Failed to spawn llama-server: {}", e))?;

    eprintln!("[OpenCode LLM] llama-server spawned with pid {:?}", child.id());

    // Check if process exited immediately (crash)
    std::thread::sleep(Duration::from_millis(500));
    match child.try_wait() {
        Ok(Some(status)) => {
            let stderr =
                fs::read_to_string(log_dir.join("llm_stderr.log")).unwrap_or_default();
            let stdout =
                fs::read_to_string(log_dir.join("llm_stdout.log")).unwrap_or_default();
            eprintln!("[OpenCode LLM] llama-server exited immediately with status: {}", status);
            eprintln!("[OpenCode LLM] stderr: {}", &stderr[..stderr.len().min(2000)]);
            eprintln!("[OpenCode LLM] stdout: {}", &stdout[..stdout.len().min(500)]);
            return Err(format!(
                "llama-server crashed ({}): {}",
                status,
                &stderr[..stderr.len().min(500)]
            ));
        }
        Ok(None) => {
            eprintln!("[OpenCode LLM] llama-server still running after 500ms — good");
        }
        Err(e) => {
            eprintln!("[OpenCode LLM] Error checking llama-server status: {}", e);
        }
    }

    if let Ok(mut guard) = LLM_PROCESS.lock() {
        *guard = Some(child);
    }

    Ok(())
}

/// Stop the local LLM server.
#[tauri::command]
pub async fn stop_llm_server() -> Result<(), String> {
    if let Ok(mut guard) = LLM_PROCESS.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            eprintln!("[OpenCode LLM] llama-server stopped");
        }
    }
    Ok(())
}

/// Check if LLM server is healthy.
#[tauri::command]
pub async fn check_llm_health(port: Option<u32>) -> bool {
    let port = port.unwrap_or(LLM_DEFAULT_PORT);
    let url = format!("http://127.0.0.1:{}/health", port);

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .no_proxy()
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    match client.get(&url).send().await {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}
