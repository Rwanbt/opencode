use crate::util::MutexSafe;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

const LLM_PORT: u16 = 14097;


// Latest llama.cpp with Hadamard rotation for KV cache (PR #21038)
const LLAMA_RELEASE_TAG: &str = "b8731";

// ─── Inter-process lifecycle coordination ─────────────────────────────
//
// The TypeScript sidecar (LocalLLMServer) manages llama-server lifetime via
// ref files in {tmpdir}/opencode-llm-14097/. Tauri participates in the same
// protocol so the sidecar respects the "owner alive → don't kill" invariant.
//
// owner.pid  : "{owner_pid}:{child_pid}" — written atomically via tmp+rename
// refs/{pid} : presence of an active consumer (written by each process)

fn llm_base_dir() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("opencode-llm-{}", LLM_PORT))
}
fn llm_ref_dir() -> std::path::PathBuf {
    llm_base_dir().join("refs")
}
fn llm_owner_file() -> std::path::PathBuf {
    llm_base_dir().join("owner.pid")
}

fn write_llm_ref(pid: u32) {
    let dir = llm_ref_dir();
    let _ = std::fs::create_dir_all(&dir);
    let since = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let _ = std::fs::write(
        dir.join(format!("{}.ref", pid)),
        format!(r#"{{"pid":{},"since":{}}}"#, pid, since),
    );
}

fn remove_llm_ref(pid: u32) {
    let _ = std::fs::remove_file(llm_ref_dir().join(format!("{}.ref", pid)));
}

fn write_llm_owner(owner_pid: u32, child_pid: u32) {
    let path = llm_owner_file();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let tmp = path.with_extension("pid.tmp");
    if std::fs::write(&tmp, format!("{}:{}", owner_pid, child_pid)).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

fn remove_llm_owner_and_ref() {
    let pid = std::process::id();
    remove_llm_ref(pid);
    let _ = std::fs::remove_file(llm_owner_file());
}

fn llama_asset_name() -> String {
    let tag = LLAMA_RELEASE_TAG;
    // CUDA 12.4 instead of Vulkan: fixes Gemma 4 <unused> token infinite loop
    // on Vulkan backend (llama.cpp issue #21516, still open). CUDA build has
    // partial fix for the same issue (PR #21506, issue #21321 closed).
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    { format!("llama-{tag}-bin-win-cuda-12.4-x64.zip") }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    { format!("llama-{tag}-bin-ubuntu-x64.tar.gz") }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    { format!("llama-{tag}-bin-ubuntu-arm64.tar.gz") }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    { format!("llama-{tag}-bin-macos-arm64.tar.gz") }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    { format!("llama-{tag}-bin-macos-x64.tar.gz") }
}

/// Backend identifier stored in runtime_dir/backend.txt.
/// If it changes (e.g. vulkan → cuda), the runtime is purged and re-downloaded
/// to avoid mixing DLLs from different backends.
fn backend_marker() -> &'static str {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    { "cuda-12.4" }
    #[cfg(not(all(target_os = "windows", target_arch = "x86_64")))]
    { "default" }
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
    // f64 instead of u64: JSON/JS has no native BigInt, and specta rejects u64
    // with BigIntForbidden. File sizes fit comfortably in f64 (2^53 bytes).
    pub size: f64,
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

        if let Some(fname) = event_filename
            && last_emit.elapsed().as_millis() > 200 {
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

/// Extract a zip archive, flattening all entries into `target_dir`.
async fn extract_zip_to_dir(zip_path: &Path, target_dir: &Path) -> Result<(), String> {
    let zip_path = zip_path.to_path_buf();
    let target_dir = target_dir.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let file = fs::File::open(&zip_path).map_err(|e| format!("Open zip: {}", e))?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Read zip: {}", e))?;
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| format!("Zip entry: {}", e))?;
            if entry.is_dir() {
                continue;
            }
            let fname = std::path::Path::new(entry.name())
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            if fname.is_empty() {
                continue;
            }
            let out_path = target_dir.join(&fname);
            let mut out = fs::File::create(&out_path)
                .map_err(|e| format!("Create {}: {}", fname, e))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("Extract {}: {}", fname, e))?;
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Extract task: {}", e))?
    .map_err(|e| format!("Extract: {}", e))
}

async fn ensure_llama_runtime(app: &AppHandle) -> Result<PathBuf, String> {
    let server = llama_server_path(app);
    let rt_dir = runtime_dir(app);
    let marker_path = rt_dir.join("backend.txt");
    let expected_backend = backend_marker();

    // Return early only if binary exists AND backend marker matches.
    // If the backend changed (e.g. vulkan → cuda), purge the old runtime to
    // avoid mixing DLLs from different backends.
    if server.exists() {
        let current = fs::read_to_string(&marker_path).unwrap_or_default();
        if current.trim() == expected_backend {
            return Ok(server);
        }
        tracing::info!(
            "[LLM] Backend changed ({} → {}), clearing runtime dir...",
            current.trim(), expected_backend
        );
        let _ = fs::remove_dir_all(&rt_dir);
    }

    tracing::info!("[LLM] Downloading llama.cpp runtime ({})...", expected_backend);
    let _ = fs::create_dir_all(&rt_dir);

    let zip_url = format!(
        "https://github.com/ggml-org/llama.cpp/releases/download/{}/{}",
        LLAMA_RELEASE_TAG, llama_asset_name()
    );
    let zip_path = rt_dir.join("llama-runtime.zip");

    download_file(app, &zip_url, &zip_path, None).await?;
    tracing::info!("[LLM] Extracting runtime...");
    extract_zip_to_dir(&zip_path, &rt_dir).await?;
    let _ = fs::remove_file(&zip_path);

    // On Windows CUDA builds: also download the CUDA runtime DLLs (cudart) so
    // llama-server.exe starts without requiring the full CUDA Toolkit installed.
    // Failure is non-fatal: modern NVIDIA drivers already bundle cudart 12.x.
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    if expected_backend.starts_with("cuda") {
        let cudart_url = format!(
            "https://github.com/ggml-org/llama.cpp/releases/download/{}/cudart-llama-bin-win-cuda-12.4-x64.zip",
            LLAMA_RELEASE_TAG
        );
        let cudart_path = rt_dir.join("cudart.zip");
        tracing::info!("[LLM] Downloading CUDA runtime DLLs...");
        match download_file(app, &cudart_url, &cudart_path, None).await {
            Ok(_) => {
                if let Err(e) = extract_zip_to_dir(&cudart_path, &rt_dir).await {
                    tracing::warn!("[LLM] cudart extraction failed (driver-bundled cudart may be used): {}", e);
                }
                let _ = fs::remove_file(&cudart_path);
            }
            Err(e) => {
                tracing::warn!("[LLM] cudart download failed (driver-bundled cudart may be used): {}", e);
            }
        }
    }

    if !server.exists() {
        return Err(format!("{} not found after extraction", llama_server_exe()));
    }

    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&server, fs::Permissions::from_mode(0o755));
    }

    // Stamp the backend marker so future runs skip re-download
    let _ = fs::write(&marker_path, expected_backend);

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
            if path.extension().map(|e| e == "gguf").unwrap_or(false)
                && let Ok(meta) = fs::metadata(&path) {
                    models.push(ModelInfo {
                        filename: path.file_name().unwrap().to_string_lossy().to_string(),
                        size: meta.len() as f64,
                    });
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
    let safe_name = crate::validate::validate_filename(&filename)?.to_string();
    let safe_url = crate::validate::validate_url(&url)?.to_string();
    let dir = models_dir(&app);
    let _ = fs::create_dir_all(&dir);
    let target = dir.join(&safe_name);

    tracing::info!("[LLM] Downloading model {} -> {}", safe_url, target.display());
    download_file(&app, &safe_url, &target, Some(&safe_name)).await?;
    tracing::info!("[LLM] Model download complete: {}", safe_name);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_model(app: AppHandle, filename: String) -> Result<(), String> {
    let safe_name = crate::validate::validate_filename(&filename)?.to_string();
    let path = models_dir(&app).join(&safe_name);
    fs::remove_file(&path).map_err(|e| format!("Delete: {}", e))?;
    let part = models_dir(&app).join(format!("{}.part", &safe_name));
    let _ = fs::remove_file(&part);
    Ok(())
}

/// Set LLM configuration env vars (called by frontend before load).
/// Mirror of mobile's set_llm_config: every field is optional, env vars
/// are read by load_llm_model() on the next start, and (for top_k/top_p/
/// temperature/system_prompt) by the agent-side request builder.
/// Maps to existing desktop env names where they exist (OPENCODE_N_THREADS,
/// OPENCODE_BATCH_SIZE) so the Rust spawn path keeps using its current vars.
///
/// Args are bundled in a struct because specta_fn caps at fewer positional
/// parameters; this also gives a stable JS contract for `invoke("set_llm_config", { ... })`.
#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SetLlmConfigArgs {
    pub kv_cache_type: Option<String>,
    pub flash_attn: Option<bool>,
    pub offload_mode: Option<String>,
    pub mmap_mode: Option<String>,
    pub accelerator: Option<String>,
    pub threads: Option<i32>,
    pub n_batch: Option<i32>,
    pub cache_reuse: Option<bool>,
    pub top_k: Option<i32>,
    pub top_p: Option<f64>,
    pub temperature: Option<f64>,
    pub system_prompt: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn set_llm_config(args: SetLlmConfigArgs) -> Result<(), String> {
    // edition 2024 marks env::set_var/remove_var as unsafe (process-wide
    // mutation can race with other threads reading the env). The Tauri
    // command handler runs single-threaded enough for this use case
    // (frontend pushes config before each load), so the wrap is acceptable.
    unsafe {
        if let Some(kv) = args.kv_cache_type {
            std::env::set_var("OPENCODE_KV_CACHE_TYPE", &kv);
        }
        if let Some(fa) = args.flash_attn {
            std::env::set_var("OPENCODE_FLASH_ATTN", if fa { "true" } else { "false" });
        }
        if let Some(off) = args.offload_mode {
            std::env::set_var("OPENCODE_OFFLOAD_MODE", &off);
        }
        if let Some(mm) = args.mmap_mode {
            std::env::set_var("OPENCODE_MMAP_MODE", &mm);
        }
        if let Some(acc) = args.accelerator {
            // Stored for the mobile-style backend pin (LlamaEngine.kt uses this);
            // on desktop the offload_mode + n_gpu_layers already drive backend choice.
            std::env::set_var("OPENCODE_LLAMA_BACKEND", &acc);
        }
        if let Some(t) = args.threads {
            // 0 = auto: leave the env unset so load_llm_model falls back to its
            // physical-cores heuristic; otherwise pin the value.
            if t > 0 {
                std::env::set_var("OPENCODE_N_THREADS", t.to_string());
            } else {
                std::env::remove_var("OPENCODE_N_THREADS");
            }
        }
        if let Some(nb) = args.n_batch {
            std::env::set_var("OPENCODE_BATCH_SIZE", nb.to_string());
            // Use the same value as ubatch by default (single slot, simple tuning).
            std::env::set_var("OPENCODE_UBATCH_SIZE", nb.to_string());
        }
        if let Some(cr) = args.cache_reuse {
            std::env::set_var("OPENCODE_LLAMA_CACHE_REUSE", if cr { "true" } else { "false" });
        }
        if let Some(tk) = args.top_k {
            std::env::set_var("OPENCODE_LLM_TOP_K", tk.to_string());
        }
        if let Some(tp) = args.top_p {
            std::env::set_var("OPENCODE_LLM_TOP_P", format!("{}", tp));
        }
        if let Some(temp) = args.temperature {
            std::env::set_var("OPENCODE_LLM_TEMPERATURE", format!("{}", temp));
        }
        if let Some(sp) = args.system_prompt {
            if sp.is_empty() {
                std::env::remove_var("OPENCODE_LLM_SYSTEM_PROMPT");
            } else {
                std::env::set_var("OPENCODE_LLM_SYSTEM_PROMPT", &sp);
            }
        }
    }
    tracing::debug!("[LLM] Config updated via set_llm_config");
    Ok(())
}

/// Base-model architectures that use a separate vision projector (mmproj).
/// Extend when adding a new VLM — VERIFY the exact string first (runbook
/// verification step) because llama.cpp's name may differ from the HF name.
const MULTIMODAL_ARCHITECTURES: &[&str] =
    &["gemma3", "mllama", "qwen2vl", "qwen2.5vl", "llava", "idefics3", "smolvlm"];

/// Minimal GGUF metadata reader — returns `general.architecture`, or None on
/// any parse failure (caller decides the safe default). GGUF spec v2/v3.
fn read_gguf_architecture(path: &std::path::Path) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path).ok()?;
    let mut b4 = [0u8; 4];
    let mut b8 = [0u8; 8];

    f.read_exact(&mut b4).ok()?;
    if &b4 != b"GGUF" {
        return None;
    }
    f.read_exact(&mut b4).ok()?;
    let version = u32::from_le_bytes(b4);
    if version < 2 || version > 3 {
        return None;
    }
    f.read_exact(&mut b8).ok()?; // tensor_count (unused)
    f.read_exact(&mut b8).ok()?;
    let kv_count = u64::from_le_bytes(b8);

    fn read_str(f: &mut std::fs::File) -> Option<String> {
        use std::io::Read;
        let mut l = [0u8; 8];
        f.read_exact(&mut l).ok()?;
        let len = u64::from_le_bytes(l) as usize;
        if len > 1_000_000 {
            return None; // sanity guard against a corrupt length
        }
        let mut buf = vec![0u8; len];
        f.read_exact(&mut buf).ok()?;
        String::from_utf8(buf).ok()
    }
    fn scalar_size(t: u32) -> Option<i64> {
        Some(match t {
            0 | 1 | 7 => 1,    // u8 / i8 / bool
            2 | 3 => 2,        // u16 / i16
            4 | 5 | 6 => 4,    // u32 / i32 / f32
            10 | 11 | 12 => 8, // u64 / i64 / f64
            _ => return None,
        })
    }

    for _ in 0..kv_count {
        let key = read_str(&mut f)?;
        f.read_exact(&mut b4).ok()?;
        let vtype = u32::from_le_bytes(b4);
        if vtype == 8 {
            let val = read_str(&mut f)?;
            if key == "general.architecture" {
                return Some(val);
            }
        } else if vtype == 9 {
            // array: elem_type(u32), count(u64), elements
            f.read_exact(&mut b4).ok()?;
            let elem_t = u32::from_le_bytes(b4);
            f.read_exact(&mut b8).ok()?;
            let count = u64::from_le_bytes(b8);
            if elem_t == 8 {
                for _ in 0..count {
                    read_str(&mut f)?;
                }
            } else {
                let sz = scalar_size(elem_t)?;
                f.seek(SeekFrom::Current(sz * count as i64)).ok()?;
            }
        } else {
            let sz = scalar_size(vtype)?;
            f.seek(SeekFrom::Current(sz)).ok()?;
        }
    }
    None
}

#[tauri::command]
#[specta::specta]
pub async fn load_llm_model(app: AppHandle, filename: String, draft_model: Option<String>) -> Result<(), String> {
    let safe_name = crate::validate::validate_filename(&filename)?.to_string();
    let safe_draft = match draft_model.as_deref() {
        Some(d) => Some(crate::validate::validate_filename(d)?.to_string()),
        None => None,
    };
    let model_path = models_dir(&app).join(&safe_name);
    if !model_path.exists() {
        return Err(format!("Model not found: {}", safe_name));
    }

    // Multimodal projector auto-detection.
    //
    // Pattern: when a vision-capable model has a sibling `mmproj-*.gguf` in
    // the same directory, llama-server is started with `--mmproj <path>` so
    // /v1/chat/completions accepts `image_url` content blocks. Tested 2026-04-28
    // with Gemma 4 E4B Q4_K_M + mmproj-F16.gguf on b8731 — works on RTX 4070.
    //
    // We prefer the F16 projector (~944 MB, ~95% quality of F32 at half the
    // size) over BF16 / F32 when multiple are present. The agent caller
    // doesn't need to know about this — image content blocks just start
    // working as soon as the user drops a mmproj next to the model.
    let mmproj_path: Option<PathBuf> = {
        let dir = model_path.parent().unwrap_or_else(|| std::path::Path::new(""));
        let mut candidates: Vec<PathBuf> = std::fs::read_dir(dir)
            .ok()
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.starts_with("mmproj") && n.ends_with(".gguf"))
                    .unwrap_or(false)
            })
            .collect();
        // Stable sort to give F16 priority, then BF16, then F32.
        candidates.sort_by_key(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
            if name.contains("f16") && !name.contains("bf16") { 0 }
            else if name.contains("bf16") { 1 }
            else if name.contains("f32") { 2 }
            else { 3 }
        });
        candidates.into_iter().next()
    };
    if let Some(ref mmp) = mmproj_path {
        tracing::info!("[LLM] Multimodal projector detected: {}", mmp.display());
    }

    // Unload any existing model managed by this app
    {
        let state = app.state::<LlmServerState>();
        let mut child_guard = state.child.lock_safe();
        if let Some(ref mut child) = *child_guard {
            let _ = child.start_kill();
        }
        *child_guard = None;
        *state.active_model.lock_safe() = None;
    }

    // Check for orphaned llama-server on our port (e.g. from a crash or force-kill).
    // Reuse it only if: same model AND slot is idle (not stuck in an infinite generation).
    // Any other state (wrong model, slot processing) → kill the orphan and restart.
    let client = reqwest::Client::new();
    let mut need_kill = false;
    if let Ok(resp) = client
        .get(format!("http://127.0.0.1:{}/props", LLM_PORT))
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
        && resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            if body.contains(&safe_name) {
                // Same model — check whether the slot is idle or stuck processing
                let slot_idle = match client
                    .get(format!("http://127.0.0.1:{}/slots", LLM_PORT))
                    .timeout(std::time::Duration::from_secs(2))
                    .send()
                    .await
                {
                    Ok(r) => match r.text().await {
                        Ok(t) => !t.contains("\"is_processing\":true"),
                        Err(_) => false,
                    },
                    Err(_) => false,
                };

                if slot_idle {
                    tracing::info!("[LLM] Reusing existing llama-server (idle slot) with {}", safe_name);
                    let state = app.state::<LlmServerState>();
                    *state.active_model.lock_safe() = Some(safe_name.clone());
                    return Ok(());
                }
                tracing::warn!("[LLM] Orphaned llama-server is stuck (slot processing) — killing it");
            } else {
                tracing::warn!("[LLM] Killing orphaned llama-server (wrong model) on port {}", LLM_PORT);
            }
            need_kill = true;
        }
    if need_kill {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/IM", "llama-server.exe"])
                .creation_flags(0x08000000)
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

    // Ensure llama-server runtime is available
    let server_exe = ensure_llama_runtime(&app).await?;

    tracing::info!(
        "[LLM] Starting llama-server with {} on port {}",
        safe_name,
        LLM_PORT
    );

    // Read settings. Precedence: explicit env var > shared adaptive config file
    // (written by the TS sidecar's auto-config) > fallback default. This keeps
    // Tauri's standalone spawn path in sync with the sidecar's deriveConfig()
    // instead of hard-coding `--n-gpu-layers 99` and a half-best thread count.
    let adaptive = read_shared_llm_config();

    let kv_cache_type = std::env::var("OPENCODE_KV_CACHE_TYPE")
        .ok()
        .or_else(|| adaptive.as_ref().and_then(|c| c.kv_cache_type.clone()))
        .unwrap_or_else(|| "q4_0".to_string());
    let offload_mode = std::env::var("OPENCODE_OFFLOAD_MODE").unwrap_or_else(|_| "auto".to_string());
    let mmap_mode = std::env::var("OPENCODE_MMAP_MODE").unwrap_or_else(|_| "auto".to_string());
    // Flash attention toggle (default on — best perf/memory).
    let flash_attn = std::env::var("OPENCODE_FLASH_ATTN")
        .map(|v| v.eq_ignore_ascii_case("true") || v == "1" || v.eq_ignore_ascii_case("on"))
        .unwrap_or(true);
    // KV cache reuse between turns (default true; auto-disabled by llama.cpp on
    // SWA models like Gemma 4 with a "cache reuse not supported" warning).
    let cache_reuse = std::env::var("OPENCODE_LLAMA_CACHE_REUSE")
        .map(|v| v.eq_ignore_ascii_case("true") || v == "1" || v.eq_ignore_ascii_case("on"))
        .unwrap_or(true);

    // n_gpu_layers: env > shared file > 99 (the historic "offload everything"
    // sentinel; llama.cpp silently caps it to the real layer count).
    let n_gpu_layers = std::env::var("OPENCODE_N_GPU_LAYERS")
        .ok()
        .and_then(|s| s.parse::<u32>().ok())
        .or(adaptive.as_ref().and_then(|c| c.n_gpu_layers))
        .unwrap_or(99);

    // Threads: env > shared file > physical cores heuristic.
    let n_threads = std::env::var("OPENCODE_N_THREADS")
        .ok()
        .and_then(|s| s.parse::<usize>().ok())
        .or(adaptive.as_ref().and_then(|c| c.n_threads))
        .unwrap_or_else(|| {
            std::thread::available_parallelism()
                .map(|n| n.get() / 2)
                .unwrap_or(4)
                .max(2)
        });

    // Batch / ubatch: env > shared file > llama.cpp default (skipped).
    let batch_size = std::env::var("OPENCODE_BATCH_SIZE")
        .ok()
        .and_then(|s| s.parse::<u32>().ok())
        .or(adaptive.as_ref().and_then(|c| c.batch_size));
    let ubatch_size = std::env::var("OPENCODE_UBATCH_SIZE")
        .ok()
        .and_then(|s| s.parse::<u32>().ok())
        .or(adaptive.as_ref().and_then(|c| c.ubatch_size));

    tracing::info!(
        "[LLM] Config: kv={}, offload={}, mmap={}, ngl={}, threads={}, batch={:?}, ubatch={:?}",
        kv_cache_type, offload_mode, mmap_mode, n_gpu_layers, n_threads, batch_size, ubatch_size
    );

    let mut cmd = tokio::process::Command::new(&server_exe);
    cmd.arg("--model")
        .arg(model_path.to_string_lossy().to_string())
        .arg("--port")
        .arg(LLM_PORT.to_string())
        .arg("--host")
        .arg("127.0.0.1");

    // Pass the multimodal projector if one was detected next to the model.
    // --mmproj-offload pushes the vision encoder onto the GPU when n_gpu_layers
    // is non-zero — without it, CLIP/SigLIP forward runs on CPU and adds
    // 1-3 seconds per image (measured with Gemma 4 vision encoder).
    if let Some(ref mmp) = mmproj_path {
        cmd.arg("--mmproj")
            .arg(mmp.to_string_lossy().to_string())
            .arg("--mmproj-offload");
    }
    cmd
        // GPU layers: adaptive (env / shared config / 99 fallback); --fit
        // will still clamp to available VRAM via the embedded fork.
        .arg("--n-gpu-layers")
        .arg(n_gpu_layers.to_string())
        // --fit auto-adjusts ctx_size and layer placement to available VRAM
        .arg("--fit")
        .arg("on")
        .arg("-fitt")
        .arg("512") // leave 512 MiB free for OS/display
        .arg("-fitc")
        .arg("16384") // never go below 16K context
        // Flash Attention for memory efficiency (env-overridable)
        .arg("--flash-attn")
        .arg(if flash_attn { "on" } else { "off" })
        // KV cache quantization — read from user settings or default to q4_0
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

    // KV cache reuse between turns — opt-in via env (auto-disabled on SWA models).
    if !cache_reuse {
        cmd.arg("--cache-reuse").arg("0");
    }

    if let Some(bs) = batch_size {
        cmd.arg("--batch-size").arg(bs.to_string());
    }
    if let Some(ubs) = ubatch_size {
        cmd.arg("--ubatch-size").arg(ubs.to_string());
    }

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
    // Prefer the argument from frontend UI, fallback to env var for CLI usage.
    // Env var path is validated here (same allowlist as IPC) to avoid injection via env.
    let draft_model = match safe_draft.filter(|s| !s.is_empty()) {
        Some(d) => Some(d),
        None => match std::env::var("OPENCODE_DRAFT_MODEL").ok() {
            Some(env_draft) => match crate::validate::validate_filename(&env_draft) {
                Ok(v) => Some(v.to_string()),
                Err(e) => {
                    tracing::warn!("[LLM] Ignoring invalid OPENCODE_DRAFT_MODEL env: {}", e);
                    None
                }
            },
            None => None,
        },
    };
    if let Some(ref draft) = draft_model {
        let draft_path = models_dir(&app).join(draft);
        if draft_path.exists() {
            // VRAM Guard: need draft file size + 500 MB margin for KV cache
            let required_mib = std::fs::metadata(&draft_path)
                .ok()
                .map(|m| m.len() / (1024 * 1024) + 500)
                .unwrap_or(1500);
            if check_vram_free(required_mib) {
                cmd.arg("--model-draft")
                    .arg(draft_path.to_string_lossy().to_string())
                    .arg("--draft")
                    .arg("16")
                    .arg("--draft-p-min")
                    .arg("0.75")
                    .arg("--gpu-layers-draft")
                    .arg("99");
                tracing::info!("[LLM] Speculative decoding enabled with {} (need {} MiB VRAM)", draft, required_mib);
            } else {
                tracing::info!("[LLM] Speculative decoding skipped (need {} MiB free VRAM)", required_mib);
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

    // Participate in the inter-process ref protocol so the TypeScript sidecar
    // (LocalLLMServer) knows Tauri is the owner and won't kill the server on
    // its own exit. Must happen BEFORE child is moved into the Mutex.
    let own_pid = std::process::id();
    let child_pid = child.id().unwrap_or(0);
    write_llm_owner(own_pid, child_pid);
    write_llm_ref(own_pid);

    {
        let state = app.state::<LlmServerState>();
        *state.child.lock_safe() = Some(child);
        *state.active_model.lock_safe() = Some(safe_name.clone());
    }

    // Wait for server to become healthy (up to 120s for large models)
    tracing::info!("[LLM] Waiting for server to become healthy...");
    let client = reqwest::Client::new();
    let start = std::time::Instant::now();
    loop {
        if start.elapsed().as_secs() > 120 {
            // Timeout - kill server
            let state = app.state::<LlmServerState>();
            let mut guard = state.child.lock_safe();
            if let Some(ref mut c) = *guard {
                let _ = c.start_kill();
            }
            *guard = None;
            *state.active_model.lock_safe() = None;
            return Err("Server failed to start within 120s".to_string());
        }

        // Check if process is still alive
        {
            let state = app.state::<LlmServerState>();
            let mut guard = state.child.lock_safe();
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
        let mut guard = state.child.lock_safe();
        let child = guard.take();
        *state.active_model.lock_safe() = None;
        child
    };
    if let Some(mut child) = child_opt {
        tracing::info!("[LLM] Stopping llama-server");
        let _ = child.kill().await;
        let _ = child.wait().await;
        // Remove Tauri's owner.pid and ref file so the TypeScript sidecar
        // won't see a live owner and incorrectly skip orphan recovery.
        remove_llm_owner_and_ref();
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

/// Adaptive llama-server config written by the TypeScript sidecar
/// (packages/opencode/src/local-llm-server/auto-config.ts) into
/// `{tmpdir}/opencode-llm-14097/llm_config.json`. All fields optional —
/// we only override defaults when the sidecar has something to say.
#[derive(Debug, Default, serde::Deserialize)]
struct SharedLlmConfig {
    #[serde(default)]
    n_gpu_layers: Option<u32>,
    #[serde(default)]
    n_threads: Option<usize>,
    #[serde(default)]
    batch_size: Option<u32>,
    #[serde(default)]
    ubatch_size: Option<u32>,
    #[serde(default)]
    kv_cache_type: Option<String>,
}

fn read_shared_llm_config() -> Option<SharedLlmConfig> {
    let path = llm_base_dir().join("llm_config.json");
    let bytes = std::fs::read(&path).ok()?;
    match serde_json::from_slice::<SharedLlmConfig>(&bytes) {
        Ok(c) => {
            tracing::info!("[LLM] Loaded adaptive config from {}", path.display());
            Some(c)
        }
        Err(e) => {
            tracing::warn!(
                "[LLM] Failed to parse {} ({}), falling back to defaults",
                path.display(),
                e
            );
            None
        }
    }
}

/// Check if enough free VRAM is available (for speculative decoding guard).
/// Probes NVIDIA → AMD (rocm-smi) → AMD (sysfs drm) → Intel Arc (xpu-smi) in order.
/// Returns true if free VRAM ≥ min_mib, or if no GPU tool is available (rare OOM risk
/// is acceptable because llama.cpp's --fit flag caps layers to available memory).
fn check_vram_free(min_mib: u64) -> bool {
    // NVIDIA
    if let Ok(out) = std::process::Command::new("nvidia-smi")
        .args(["--query-gpu=memory.free", "--format=csv,noheader,nounits"])
        .output()
    {
        if out.status.success() {
            let free: u64 = String::from_utf8_lossy(&out.stdout)
                .trim()
                .lines()
                .next()
                .unwrap_or("0")
                .parse()
                .unwrap_or(0);
            return free >= min_mib;
        }
    }

    // AMD — ROCm toolchain
    if let Ok(out) = std::process::Command::new("rocm-smi")
        .args(["--showmeminfo", "vram", "--csv"])
        .output()
    {
        if out.status.success() {
            // Output: GPU_ID,VRAM_Total_Memory(B),VRAM_Used_Memory(B)
            // Take the first data line; parse Used and Total from bytes → MiB.
            for line in String::from_utf8_lossy(&out.stdout).lines().skip(1) {
                let cols: Vec<&str> = line.split(',').collect();
                if cols.len() >= 3 {
                    let total: u64 = cols[1].trim().parse().unwrap_or(0) / (1024 * 1024);
                    let used: u64  = cols[2].trim().parse().unwrap_or(0) / (1024 * 1024);
                    if total > 0 {
                        return total.saturating_sub(used) >= min_mib;
                    }
                }
            }
        }
    }

    // AMD — sysfs drm (Linux only, works without ROCm)
    #[cfg(target_os = "linux")]
    {
        use std::fs;
        if let Ok(entries) = fs::read_dir("/sys/class/drm") {
            for entry in entries.flatten() {
                let dev = entry.path().join("device");
                let total_path = dev.join("mem_info_vram_total");
                let used_path  = dev.join("mem_info_vram_used");
                if let (Ok(t), Ok(u)) = (fs::read_to_string(&total_path), fs::read_to_string(&used_path)) {
                    let total: u64 = t.trim().parse().unwrap_or(0) / (1024 * 1024);
                    let used: u64  = u.trim().parse().unwrap_or(0) / (1024 * 1024);
                    if total > 0 {
                        return total.saturating_sub(used) >= min_mib;
                    }
                }
            }
        }
    }

    // Intel Arc — oneAPI Level Zero / xpu-smi
    if let Ok(out) = std::process::Command::new("xpu-smi")
        .args(["discovery", "--dump", "1"])
        .output()
    {
        if out.status.success() {
            // xpu-smi dump 1 = "Tile ID, GPU Utilization (%), GPU Power (W), GPU Frequency (MHz),
            //                   GPU Core Temperature (Celsius Degree), GPU Memory Temperature (…),
            //                   GPU Memory Utilization (%), GPU Memory Used (MiB), GPU Memory Size (MiB)"
            for line in String::from_utf8_lossy(&out.stdout).lines().skip(1) {
                let cols: Vec<&str> = line.split(',').collect();
                if cols.len() >= 9 {
                    let used: u64  = cols[7].trim().parse().unwrap_or(0);
                    let total: u64 = cols[8].trim().parse().unwrap_or(0);
                    if total > 0 {
                        return total.saturating_sub(used) >= min_mib;
                    }
                }
            }
        }
    }

    // No GPU tool found — enable anyway; llama.cpp --fit keeps us safe
    true
}

/// Get GPU VRAM info (total, used, free) in MiB
#[derive(serde::Serialize, specta::Type)]
pub struct VramInfo {
    // f64: specta rejects u64 (BigIntForbidden); VRAM ≤ 200 GB = 200 000 MiB,
    // well within f64 precision.
    pub total_mib: f64,
    pub used_mib: f64,
    pub free_mib: f64,
    pub gpu_name: String,
}

// ─── Benchmark ─────────────────────────────────────────────────────────
//
// Settings → Benchmark tab calls these to measure llama-server throughput
// on the user's actual device. Returns enough structured data for the UI
// to plot a per-model history and surface a winner.

/// Backend label exposed to the UI. Reads OPENCODE_LLAMA_BACKEND (set by
/// set_llm_config when the user pins an Accelerator); falls back to
/// "auto" so the UI shows a sensible value when nothing was pinned.
#[tauri::command]
#[specta::specta]
pub async fn detect_active_backend() -> Result<String, String> {
    Ok(std::env::var("OPENCODE_LLAMA_BACKEND").unwrap_or_else(|_| "auto".to_string()))
}

#[derive(serde::Serialize, specta::Type)]
pub struct BenchmarkResult {
    pub prompt_tokens: u32,
    pub generated_tokens: u32,
    pub prefill_ms: f64,
    pub decode_ms: f64,
    pub prefill_tps: f64,
    pub decode_tps: f64,
    // f64: specta rejects u64 (BigIntForbidden); RAM in MiB fits in f64.
    pub peak_ram_mib: Option<f64>,
    pub device_label: Option<String>,
}

#[derive(serde::Deserialize)]
struct LlamaCompletionTimings {
    prompt_n: Option<u32>,
    prompt_ms: Option<f64>,
    prompt_per_second: Option<f64>,
    predicted_n: Option<u32>,
    predicted_ms: Option<f64>,
    predicted_per_second: Option<f64>,
}

#[derive(serde::Deserialize)]
struct LlamaCompletionResponse {
    #[serde(default)]
    tokens_predicted: Option<u32>,
    #[serde(default)]
    tokens_evaluated: Option<u32>,
    #[serde(default)]
    timings: Option<LlamaCompletionTimings>,
}

/// Run a single prompt against the loaded llama-server and parse the
/// timings block from its response. Pre-condition: the server is up
/// (frontend should call load_llm_model first if needed; this function
/// does not start the server itself).
#[tauri::command]
#[specta::specta]
pub async fn run_inference_benchmark(
    prompt: String,
    n_predict: i32,
) -> Result<BenchmarkResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    // /completion is the canonical llama-server endpoint that surfaces
    // timings in its JSON response (the OpenAI-compatible /v1/chat/...
    // hides them). We send a single non-streaming completion to keep the
    // measurement clean.
    let body = serde_json::json!({
        "prompt": prompt,
        "n_predict": n_predict,
        "temperature": 0.0,
        "top_k": 1,
        "top_p": 1.0,
        "stream": false,
        "cache_prompt": false,
    });

    let url = format!("http://127.0.0.1:{}/completion", LLM_PORT);
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("llama-server unreachable: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("llama-server HTTP {}", resp.status()));
    }
    let parsed: LlamaCompletionResponse = resp
        .json()
        .await
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

    // Peak RAM and device label are best-effort (nvidia-smi for desktop
    // GPU; /proc/meminfo for headless boxes). Failures are non-fatal —
    // the UI shows "—" when the field is absent.
    let (peak_ram_mib, device_label) = match get_vram_info().await {
        Ok(v) => (Some(v.used_mib), Some(v.gpu_name)),
        Err(_) => (None, None),
    };

    Ok(BenchmarkResult {
        prompt_tokens,
        generated_tokens,
        prefill_ms,
        decode_ms,
        prefill_tps,
        decode_tps,
        peak_ram_mib,
        device_label,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn get_vram_info() -> Result<VramInfo, String> {
    // Try nvidia-smi
    if let Ok(output) = std::process::Command::new("nvidia-smi")
        .args(["--query-gpu=memory.total,memory.used,memory.free,name", "--format=csv,noheader,nounits"])
        .output()
        && output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(line) = stdout.lines().next() {
                let parts: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
                if parts.len() >= 4 {
                    return Ok(VramInfo {
                        total_mib: parts[0].parse().unwrap_or(0.0),
                        used_mib: parts[1].parse().unwrap_or(0.0),
                        free_mib: parts[2].parse().unwrap_or(0.0),
                        gpu_name: parts[3].to_string(),
                    });
                }
            }
        }
    Err("GPU not detected (nvidia-smi not available)".to_string())
}

