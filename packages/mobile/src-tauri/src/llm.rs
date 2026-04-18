use serde::{Deserialize, Serialize};
use std::fs;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

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
    log::debug!("[LLM] Sent command: {}", &cmd[..cmd.len().min(100)]);

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
            if let Some(msg) = result.strip_prefix("error:") {
                return Err(msg.to_string());
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
    crate::validate::validate_filename(&filename).map_err(|e| e.to_string())?;
    crate::validate::validate_url(&url).map_err(|e| e.to_string())?;
    let dir = runtime_dir(&app).join("models");
    let _ = fs::create_dir_all(&dir);
    let target = dir.join(&filename);
    let part = dir.join(format!("{}.part", &filename));

    // Resume support: if a .part file already exists, ask the server for bytes
    // from the existing offset. This covers the common case where a mobile
    // user lost signal mid-download — otherwise a 4 GB GGUF restarts at zero.
    let existing_bytes = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    let mut downloaded: u64 = existing_bytes;

    log::info!(
        "[LLM] Downloading {} -> {} (resume from {})",
        url,
        target.display(),
        existing_bytes,
    );

    let client = reqwest::Client::new();
    let mut req = client.get(&url);
    if existing_bytes > 0 {
        req = req.header("Range", format!("bytes={}-", existing_bytes));
    }
    let resp = req.send().await.map_err(|e| format!("Download error: {}", e))?;

    let status = resp.status();
    // If we asked for a range but the server returned a full body, it doesn't
    // support Range — fall back to a clean restart rather than concatenating
    // the old partial with a fresh stream (which would corrupt the file).
    let is_resume = existing_bytes > 0 && status.as_u16() == 206;
    if existing_bytes > 0 && !is_resume {
        log::warn!("[LLM] Server does not support Range; restarting full download");
        let _ = fs::remove_file(&part);
        downloaded = 0;
    }

    let content_length = resp.content_length().unwrap_or(0);
    // Content-Length on a 206 response is the remaining bytes — add the existing
    // offset so progress UI can show percentage of the whole file.
    let total = if is_resume { content_length + existing_bytes } else { content_length };

    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut file = if is_resume {
        tokio::fs::OpenOptions::new()
            .append(true)
            .open(&part)
            .await
            .map_err(|e| format!("File open (resume): {}", e))?
    } else {
        tokio::fs::File::create(&part)
            .await
            .map_err(|e| format!("File create: {}", e))?
    };

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

    log::info!("[LLM] Download complete: {}", filename);
    Ok(())
}

#[tauri::command]
pub async fn delete_model(app: AppHandle, filename: String) -> Result<(), String> {
    crate::validate::validate_filename(&filename).map_err(|e| e.to_string())?;
    let path = runtime_dir(&app).join("models").join(&filename);
    fs::remove_file(&path).map_err(|e| format!("Delete: {}", e))?;
    let part = runtime_dir(&app).join("models").join(format!("{}.part", &filename));
    let _ = fs::remove_file(&part);
    Ok(())
}

/// Write LLM configuration to IPC file for Kotlin LlamaEngine to read.
fn write_llm_config(app: &AppHandle, draft_model: Option<String>) {
    let ipc_dir = runtime_dir(app).join("llm_ipc");
    let _ = fs::create_dir_all(&ipc_dir);
    let config_file = ipc_dir.join("llm_config");

    // Read settings from env vars (set by frontend via Tauri invoke)
    let kv_cache_type = std::env::var("OPENCODE_KV_CACHE_TYPE").unwrap_or_else(|_| "q4_0".to_string());
    let flash_attn = std::env::var("OPENCODE_FLASH_ATTN").unwrap_or_else(|_| "true".to_string());
    let offload_mode = std::env::var("OPENCODE_OFFLOAD_MODE").unwrap_or_else(|_| "auto".to_string());
    let mmap_mode = std::env::var("OPENCODE_MMAP_MODE").unwrap_or_else(|_| "auto".to_string());

    // Build draft model path if provided
    let draft_path = draft_model.map(|d| {
        runtime_dir(app).join("models").join(&d).to_string_lossy().to_string()
    }).unwrap_or_default();

    // n_gpu_layers: overridden by Kotlin LlamaEngine based on empirical backend choice
    // (CPU for small models, Vulkan/OpenCL for large models on capable SoCs).
    let config = format!(
        "kv_cache_type={}\nflash_attn={}\noffload_mode={}\nmmap_mode={}\ndraft_model={}\n",
        kv_cache_type, flash_attn, offload_mode, mmap_mode, draft_path
    );

    match fs::write(&config_file, &config) {
        Ok(_) => log::debug!("[LLM] Config written: kv={}, flash={}, offload={}, mmap={}", kv_cache_type, flash_attn, offload_mode, mmap_mode),
        Err(e) => log::warn!("[LLM] Failed to write config: {}", e),
    }
}

/// Load a GGUF model via Kotlin LlamaEngine (file IPC).
#[tauri::command]
pub async fn load_llm_model(app: AppHandle, filename: String, _draft_model: Option<String>) -> Result<(), String> {
    crate::validate::validate_filename(&filename).map_err(|e| e.to_string())?;
    let model_path = runtime_dir(&app).join("models").join(&filename);
    if !model_path.exists() {
        return Err(format!("Model not found: {}", filename));
    }
    let path_str = model_path.to_string_lossy().to_string();
    log::info!("[LLM] Loading model: {}", path_str);

    // Auto-detect draft model for speculative decoding
    let draft_model = find_draft_model(&app, &filename);

    // Write config for Kotlin to read before loading
    write_llm_config(&app, draft_model);

    // Send load command to Kotlin — timeout 240s.
    // Kotlin startServer() now includes a 180s readiness loop polling /v1/models,
    // so the load command only returns once the model is actually ready to infer.
    // The extra 60s is safety margin over the Kotlin readiness timeout.
    llm_command(&app, &format!("load|{}", path_str), 240)?;
    Ok(())
}

/// Find a small draft model (0.5B-0.8B) for speculative decoding
fn find_draft_model(app: &AppHandle, main_model: &str) -> Option<String> {
    let dir = runtime_dir(app).join("models");
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name == main_model { continue; }
            if !name.ends_with(".gguf") { continue; }
            let lower = name.to_lowercase();
            // Look for small draft models (0.5B or 0.8B)
            if lower.contains("0.5b") || lower.contains("0.8b") || lower.contains("0_5b") || lower.contains("0_8b") {
                // Verify file size is small enough (<1GB)
                if let Ok(meta) = entry.metadata() {
                    if meta.len() < 1_000_000_000 {
                        log::debug!("[LLM] Found draft model: {}", name);
                        return Some(name);
                    }
                }
            }
        }
    }
    None
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
///
/// Protocol: `generate|{max}|{temp}|{prompt}`.
/// `prompt` is placed LAST on purpose so a prompt containing `|` is kept
/// intact — the Kotlin side calls `split("|", limit = 3)` on the argument
/// tail, which stops after the third token. An older layout put prompt
/// first and any `|` in user text would corrupt max / temp parsing.
#[tauri::command]
pub async fn generate_llm(
    app: AppHandle,
    prompt: String,
    max_tokens: Option<i32>,
    temperature: Option<f32>,
) -> Result<String, String> {
    let max = max_tokens.unwrap_or(512);
    let temp = temperature.unwrap_or(0.7);

    // Defensive: drop \0 / CR / LF that could break the request-file parser.
    let clean_prompt: String = prompt
        .chars()
        .filter(|c| *c != '\0' && *c != '\r' && *c != '\n')
        .collect();

    // Send generate command — timeout 300s for generation.
    let cmd = format!("generate|{}|{}|{}", max, temp, clean_prompt);
    let result = llm_command(&app, &cmd, 300)?;

    // Emit full result as token event
    let _ = app.emit("llm-token", &result);

    Ok(result)
}

#[tauri::command]
pub async fn check_llm_health(app: AppHandle) -> bool {
    is_llm_loaded(app).await
}

#[tauri::command]
pub async fn llm_idle_tick() -> Result<(), String> {
    log::debug!("[LLM] llm_idle_tick: app went background");
    Ok(())
}

/// Set LLM configuration env vars (called by frontend before load)
#[tauri::command]
pub async fn set_llm_config(
    kv_cache_type: Option<String>,
    flash_attn: Option<bool>,
    offload_mode: Option<String>,
    mmap_mode: Option<String>,
) -> Result<(), String> {
    if let Some(kv) = kv_cache_type {
        std::env::set_var("OPENCODE_KV_CACHE_TYPE", &kv);
    }
    if let Some(fa) = flash_attn {
        std::env::set_var("OPENCODE_FLASH_ATTN", if fa { "true" } else { "false" });
    }
    if let Some(off) = offload_mode {
        std::env::set_var("OPENCODE_OFFLOAD_MODE", &off);
    }
    if let Some(mm) = mmap_mode {
        std::env::set_var("OPENCODE_MMAP_MODE", &mm);
    }
    log::debug!("[LLM] Config updated via set_llm_config");
    Ok(())
}

// ─── Memory monitoring ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryInfo {
    pub total_mb: u64,
    pub available_mb: u64,
    pub used_mb: u64,
}

/// Get device memory info from /proc/meminfo (works on Android without root)
#[tauri::command]
pub async fn get_memory_info() -> Result<MemoryInfo, String> {
    let meminfo = fs::read_to_string("/proc/meminfo")
        .map_err(|e| format!("Failed to read /proc/meminfo: {}", e))?;

    let mut total_kb: u64 = 0;
    let mut available_kb: u64 = 0;

    for line in meminfo.lines() {
        if line.starts_with("MemTotal:") {
            total_kb = parse_meminfo_value(line);
        } else if line.starts_with("MemAvailable:") {
            available_kb = parse_meminfo_value(line);
        }
    }

    let total_mb = total_kb / 1024;
    let available_mb = available_kb / 1024;
    let used_mb = total_mb.saturating_sub(available_mb);

    Ok(MemoryInfo {
        total_mb,
        available_mb,
        used_mb,
    })
}

fn parse_meminfo_value(line: &str) -> u64 {
    line.split_whitespace()
        .nth(1)
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}
