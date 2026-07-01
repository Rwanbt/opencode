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

    let is_load = cmd.starts_with("load|");
    // Extract filename for progress events (everything after "load|")
    let load_filename = if is_load {
        cmd.get(5..).and_then(|p| std::path::Path::new(p).file_name())
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default()
    } else {
        String::new()
    };

    // Poll for result
    let start = Instant::now();
    let timeout = Duration::from_secs(timeout_secs);
    let mut last_progress = Instant::now();
    // Emit initial progress event immediately for load commands
    if is_load {
        let _ = app.emit("llm-model-loading", serde_json::json!({
            "elapsed_secs": 0,
            "max_secs": timeout_secs,
            "filename": &load_filename,
        }));
    }
    loop {
        if start.elapsed() > timeout {
            if is_load {
                let _ = app.emit("llm-model-loading-done", serde_json::json!({ "error": "timed out" }));
            }
            return Err("Command timed out".to_string());
        }
        // Emit progress every 5s during model load so the frontend can show elapsed time
        if is_load && last_progress.elapsed().as_secs() >= 5 {
            let _ = app.emit("llm-model-loading", serde_json::json!({
                "elapsed_secs": start.elapsed().as_secs(),
                "max_secs": timeout_secs,
                "filename": &load_filename,
            }));
            last_progress = Instant::now();
        }
        if result_file.exists() {
            let result = fs::read_to_string(&result_file).unwrap_or_default();
            let _ = fs::remove_file(&result_file);
            if let Some(msg) = result.strip_prefix("error:") {
                if is_load {
                    let _ = app.emit("llm-model-loading-done", serde_json::json!({ "error": msg }));
                }
                return Err(msg.to_string());
            }
            if is_load {
                let _ = app.emit("llm-model-loading-done", serde_json::json!({ "error": null }));
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
                if let (Some(name), Ok(meta)) = (path.file_name(), fs::metadata(&path)) {
                    models.push(ModelInfo {
                        filename: name.to_string_lossy().to_string(),
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
/// Format: one `key=value` per line. Keys not set as env vars are written
/// as their string-default value so the Kotlin parser stays simple
/// (`when (parts[0])` switch with explicit fallbacks per field).
fn write_llm_config(app: &AppHandle, draft_model: Option<String>) {
    let ipc_dir = runtime_dir(app).join("llm_ipc");
    let _ = fs::create_dir_all(&ipc_dir);
    let config_file = ipc_dir.join("llm_config");

    // Read settings from env vars (set by frontend via Tauri invoke)
    let kv_cache_type = std::env::var("OPENCODE_KV_CACHE_TYPE").unwrap_or_else(|_| "q4_0".to_string());
    let flash_attn = std::env::var("OPENCODE_FLASH_ATTN").unwrap_or_else(|_| "true".to_string());
    let offload_mode = std::env::var("OPENCODE_OFFLOAD_MODE").unwrap_or_else(|_| "auto".to_string());
    let mmap_mode = std::env::var("OPENCODE_MMAP_MODE").unwrap_or_else(|_| "auto".to_string());
    // New 2026-04-28 params (set by frontend Configuration tab via set_llm_config).
    // Empty string = "use llama.cpp default", so the Kotlin side knows when to
    // skip the corresponding flag entirely.
    let threads = std::env::var("OPENCODE_LLAMA_THREADS").unwrap_or_default();
    let n_batch = std::env::var("OPENCODE_LLAMA_N_BATCH").unwrap_or_default();
    let cache_reuse = std::env::var("OPENCODE_LLAMA_CACHE_REUSE").unwrap_or_default();
    let top_k = std::env::var("OPENCODE_LLM_TOP_K").unwrap_or_default();
    let top_p = std::env::var("OPENCODE_LLM_TOP_P").unwrap_or_default();
    let temperature = std::env::var("OPENCODE_LLM_TEMPERATURE").unwrap_or_default();
    let system_prompt = std::env::var("OPENCODE_LLM_SYSTEM_PROMPT").unwrap_or_default();
    // Multimodal projector — explicit env override or auto-detect a sibling
    // mmproj-*.gguf next to the model. Same heuristic as desktop/llm.rs.
    let mmproj_path = std::env::var("OPENCODE_LLAMA_MMPROJ").ok().filter(|s| !s.is_empty()).or_else(|| {
        let model_dir = runtime_dir(app).join("models");
        std::fs::read_dir(&model_dir)
            .ok()?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.starts_with("mmproj") && n.ends_with(".gguf"))
                    .unwrap_or(false)
            })
            .min_by_key(|p| {
                let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
                if name.contains("f16") && !name.contains("bf16") { 0 }
                else if name.contains("bf16") { 1 }
                else if name.contains("f32") { 2 }
                else { 3 }
            })
            .map(|p| p.to_string_lossy().to_string())
    }).unwrap_or_default();

    // Build draft model path if provided
    let draft_path = draft_model.map(|d| {
        runtime_dir(app).join("models").join(&d).to_string_lossy().to_string()
    }).unwrap_or_default();

    // System prompt may contain newlines/backslashes — escape so the
    // line-based config parser stays simple. Decoded on the Kotlin side.
    let system_prompt_escaped = system_prompt
        .replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace('\r', "\\r");

    // n_gpu_layers: overridden by Kotlin LlamaEngine based on empirical backend choice
    // (CPU for small models, Vulkan/OpenCL for large models on capable SoCs).
    let config = format!(
        "kv_cache_type={}\nflash_attn={}\noffload_mode={}\nmmap_mode={}\ndraft_model={}\n\
         threads={}\nn_batch={}\ncache_reuse={}\ntop_k={}\ntop_p={}\ntemperature={}\nsystem_prompt_escaped={}\nmmproj_path={}\n",
        kv_cache_type, flash_attn, offload_mode, mmap_mode, draft_path,
        threads, n_batch, cache_reuse, top_k, top_p, temperature, system_prompt_escaped, mmproj_path
    );

    match fs::write(&config_file, &config) {
        Ok(_) => log::debug!(
            "[LLM] Config written: kv={}, flash={}, offload={}, mmap={}, threads={}, n_batch={}, cache_reuse={}, top_k={}, top_p={}, temp={}, sys_prompt_set={}, mmproj_set={}",
            kv_cache_type, flash_attn, offload_mode, mmap_mode, threads, n_batch, cache_reuse, top_k, top_p, temperature, !system_prompt.is_empty(), !mmproj_path.is_empty()
        ),
        Err(e) => log::warn!("[LLM] Failed to write config: {}", e),
    }
}

/// Load a GGUF model via Kotlin LlamaEngine (file IPC).
///
/// The crash-loop circuit breaker for this lives in LlamaEngine.kt::load(),
/// not here — that function is the single choke point both this command
/// AND MainActivity's native "auto-load last used model" thread call into,
/// and tracking crash state only on this Rust/JS side missed the
/// MainActivity path entirely (confirmed on-device: the breaker never
/// tripped because most crashes happened via that path, not this one).
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

/// Set LLM configuration env vars (called by frontend before load).
/// Backwards-compatible: every field is optional. New fields (accelerator,
/// threads, n_batch, cache_reuse, top_k, top_p, temperature, system_prompt)
/// are read by LlamaEngine.kt on the next load_llm_model() call.
#[tauri::command]
pub async fn set_llm_config(
    kv_cache_type: Option<String>,
    flash_attn: Option<bool>,
    offload_mode: Option<String>,
    mmap_mode: Option<String>,
    accelerator: Option<String>,
    threads: Option<i32>,
    n_batch: Option<i32>,
    cache_reuse: Option<bool>,
    top_k: Option<i32>,
    top_p: Option<f64>,
    temperature: Option<f64>,
    system_prompt: Option<String>,
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
    if let Some(acc) = accelerator {
        // "auto" | "cpu" | "gpu" | "npu" — LlamaEngine.detectBestBackend()
        // honours this override; "auto" clears any prior pin.
        std::env::set_var("OPENCODE_LLAMA_BACKEND", &acc);
    }
    if let Some(t) = threads {
        // 0 means auto-detect big-cores; LlamaEngine.detectBigCoreMask() handles fallback.
        std::env::set_var("OPENCODE_LLAMA_THREADS", t.to_string());
    }
    if let Some(nb) = n_batch {
        std::env::set_var("OPENCODE_LLAMA_N_BATCH", nb.to_string());
    }
    if let Some(cr) = cache_reuse {
        std::env::set_var("OPENCODE_LLAMA_CACHE_REUSE", if cr { "true" } else { "false" });
    }
    if let Some(tk) = top_k {
        std::env::set_var("OPENCODE_LLM_TOP_K", tk.to_string());
    }
    if let Some(tp) = top_p {
        std::env::set_var("OPENCODE_LLM_TOP_P", format!("{}", tp));
    }
    if let Some(temp) = temperature {
        std::env::set_var("OPENCODE_LLM_TEMPERATURE", format!("{}", temp));
    }
    if let Some(sp) = system_prompt {
        // Empty string = clear/unset.
        if sp.is_empty() {
            std::env::remove_var("OPENCODE_LLM_SYSTEM_PROMPT");
        } else {
            std::env::set_var("OPENCODE_LLM_SYSTEM_PROMPT", &sp);
        }
    }
    log::debug!("[LLM] Config updated via set_llm_config");
    Ok(())
}

// ─── Benchmark ─────────────────────────────────────────────────────────
//
// Settings → Benchmark tab calls these to measure llama-server throughput
// on the user's actual device. Returns enough structured data for the UI
// to plot a per-model history and surface a winner.

const BENCH_LLM_PORT: u16 = 14097;

#[tauri::command]
pub async fn detect_active_backend() -> Result<String, String> {
    Ok(std::env::var("OPENCODE_LLAMA_BACKEND").unwrap_or_else(|_| "auto".to_string()))
}

#[derive(Debug, Serialize)]
pub struct BenchmarkResult {
    pub prompt_tokens: u32,
    pub generated_tokens: u32,
    pub prefill_ms: f64,
    pub decode_ms: f64,
    pub prefill_tps: f64,
    pub decode_tps: f64,
    pub peak_ram_mib: Option<u64>,
    pub device_label: Option<String>,
}

#[derive(Deserialize)]
struct LlamaCompletionTimings {
    prompt_n: Option<u32>,
    prompt_ms: Option<f64>,
    prompt_per_second: Option<f64>,
    predicted_n: Option<u32>,
    predicted_ms: Option<f64>,
    predicted_per_second: Option<f64>,
}

#[derive(Deserialize)]
struct LlamaCompletionResponse {
    #[serde(default)]
    tokens_predicted: Option<u32>,
    #[serde(default)]
    tokens_evaluated: Option<u32>,
    #[serde(default)]
    timings: Option<LlamaCompletionTimings>,
}

/// Run a single fixed-shape prompt against the loaded llama-server and
/// parse the timings block from its response. The mobile llama-server
/// listens on port 14097 (Hexagon / OpenCL / CPU build, depending on
/// LlamaEngine.detectBestBackend()).
#[tauri::command]
pub async fn run_inference_benchmark(
    prompt: String,
    n_predict: i32,
) -> Result<BenchmarkResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    let body = serde_json::json!({
        "prompt": prompt,
        "n_predict": n_predict,
        "temperature": 0.0,
        "top_k": 1,
        "top_p": 1.0,
        "stream": false,
        "cache_prompt": false,
    });
    // Build request body manually (mobile reqwest is built without the
    // "json" feature to keep the APK lean) — same wire format.
    let body_string = serde_json::to_string(&body).map_err(|e| format!("serialize body: {e}"))?;

    let url = format!("http://127.0.0.1:{}/completion", BENCH_LLM_PORT);
    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .body(body_string)
        .send()
        .await
        .map_err(|e| format!("llama-server unreachable: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("llama-server HTTP {}", resp.status()));
    }
    let body_text = resp.text().await.map_err(|e| format!("response body: {e}"))?;
    let parsed: LlamaCompletionResponse = serde_json::from_str(&body_text)
        .map_err(|e| format!("response parse: {e}"))?;
    let t = parsed
        .timings
        .ok_or_else(|| "llama-server response missing timings block".to_string())?;

    let prompt_tokens = t.prompt_n.or(parsed.tokens_evaluated).unwrap_or(0);
    let generated_tokens = t.predicted_n.or(parsed.tokens_predicted).unwrap_or(0);
    let prefill_ms = t.prompt_ms.unwrap_or(0.0);
    let decode_ms = t.predicted_ms.unwrap_or(0.0);
    let prefill_tps = t.prompt_per_second.unwrap_or_else(|| {
        if prefill_ms > 0.0 { prompt_tokens as f64 * 1000.0 / prefill_ms } else { 0.0 }
    });
    let decode_tps = t.predicted_per_second.unwrap_or_else(|| {
        if decode_ms > 0.0 { generated_tokens as f64 * 1000.0 / decode_ms } else { 0.0 }
    });

    // Peak RAM: read /proc/meminfo once (best-effort).
    let peak_ram_mib = match get_memory_info().await {
        Ok(m) => Some(m.used_mb),
        Err(_) => None,
    };

    Ok(BenchmarkResult {
        prompt_tokens,
        generated_tokens,
        prefill_ms,
        decode_ms,
        prefill_tps,
        decode_tps,
        peak_ram_mib,
        device_label: Some("Device RAM".to_string()),
    })
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
