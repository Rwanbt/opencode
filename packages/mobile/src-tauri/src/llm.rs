use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::runtime::runtime_dir;

// ─── Data types ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
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

// ─── IPC with Kotlin LlamaEngine ────────────────────────────────────────

/// Send a command to Kotlin LlamaEngine via file IPC and wait for result.
fn llm_command(app: &AppHandle, cmd: &str, timeout_secs: u64) -> Result<String, String> {
    let ipc_dir = runtime_dir(app).join("llm_ipc");
    let _ = fs::create_dir_all(&ipc_dir);
    let request_file = ipc_dir.join("request");
    let result_file = ipc_dir.join("result");

    // Clean previous result
    let _ = fs::remove_file(&result_file);

    // Write command
    fs::write(&request_file, cmd).map_err(|e| format!("Write request: {}", e))?;
    eprintln!("[LLM] Sent command: {}", &cmd[..cmd.len().min(100)]);

    // Poll for result
    let start = Instant::now();
    let timeout = Duration::from_secs(timeout_secs);
    loop {
        if start.elapsed() > timeout {
            return Err("Command timed out".to_string());
        }
        if result_file.exists() {
            let result = fs::read_to_string(&result_file).unwrap_or_default();
            let _ = fs::remove_file(&result_file);
            if result.starts_with("error:") {
                return Err(result[6..].to_string());
            }
            return Ok(result);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

// ─── Tauri commands ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_models(app: AppHandle) -> Vec<ModelInfo> {
    let dir = runtime_dir(&app).join("models");
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
pub async fn download_model(app: AppHandle, url: String, filename: String) -> Result<(), String> {
    let dir = runtime_dir(&app).join("models");
    let _ = fs::create_dir_all(&dir);
    let target = dir.join(&filename);
    let part = dir.join(format!("{}.part", &filename));

    eprintln!("[LLM] Downloading {} -> {}", url, target.display());

    let client = reqwest::Client::new();
    let resp = client.get(&url).send().await.map_err(|e| format!("Download error: {}", e))?;
    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut file = tokio::fs::File::create(&part).await.map_err(|e| format!("File create: {}", e))?;

    let mut last_emit = std::time::Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk).await.map_err(|e| format!("Write: {}", e))?;
        downloaded += chunk.len() as u64;

        if last_emit.elapsed().as_millis() > 200 {
            let _ = app.emit("model-download-progress", ModelDownloadProgress {
                filename: filename.clone(),
                downloaded,
                total,
                progress: if total > 0 { downloaded as f64 / total as f64 } else { 0.0 },
            });
            last_emit = std::time::Instant::now();
        }
    }

    tokio::fs::rename(&part, &target).await.map_err(|e| format!("Rename: {}", e))?;
    let _ = app.emit("model-download-progress", ModelDownloadProgress {
        filename: filename.clone(), downloaded: total, total, progress: 1.0,
    });

    eprintln!("[LLM] Download complete: {}", filename);
    Ok(())
}

#[tauri::command]
pub async fn delete_model(app: AppHandle, filename: String) -> Result<(), String> {
    let path = runtime_dir(&app).join("models").join(&filename);
    fs::remove_file(&path).map_err(|e| format!("Delete: {}", e))?;
    let part = runtime_dir(&app).join("models").join(format!("{}.part", &filename));
    let _ = fs::remove_file(&part);
    Ok(())
}

/// Load a GGUF model via Kotlin LlamaEngine (file IPC).
#[tauri::command]
pub async fn load_llm_model(app: AppHandle, filename: String) -> Result<(), String> {
    let model_path = runtime_dir(&app).join("models").join(&filename);
    if !model_path.exists() {
        return Err(format!("Model not found: {}", filename));
    }
    let path_str = model_path.to_string_lossy().to_string();
    eprintln!("[LLM] Loading model: {}", path_str);

    // Send load command to Kotlin — timeout 120s for large models
    llm_command(&app, &format!("load|{}", path_str), 120)?;
    Ok(())
}

#[tauri::command]
pub async fn unload_llm_model(app: AppHandle) -> Result<(), String> {
    llm_command(&app, "unload|", 10)?;
    Ok(())
}

#[tauri::command]
pub async fn is_llm_loaded(app: AppHandle) -> bool {
    llm_command(&app, "loaded|", 5).map(|r| r.trim() == "true").unwrap_or(false)
}

#[tauri::command]
pub async fn abort_llm(app: AppHandle) -> Result<(), String> {
    llm_command(&app, "stop|", 5)?;
    Ok(())
}

/// Generate text via Kotlin LlamaEngine (file IPC).
#[tauri::command]
pub async fn generate_llm(
    app: AppHandle,
    prompt: String,
    max_tokens: Option<i32>,
    temperature: Option<f32>,
) -> Result<String, String> {
    let max = max_tokens.unwrap_or(512);
    let temp = temperature.unwrap_or(0.7);

    // Send generate command — timeout 300s for generation
    let cmd = format!("generate|{}|{}|{}", prompt, max, temp);
    let result = llm_command(&app, &cmd, 300)?;

    // Emit full result as token event
    let _ = app.emit("llm-token", &result);

    Ok(result)
}

#[tauri::command]
pub async fn check_llm_health(app: AppHandle) -> bool {
    is_llm_loaded(app).await
}
