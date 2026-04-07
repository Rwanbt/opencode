use serde::{Deserialize, Serialize};
use std::ffi::{CStr, CString};
use std::fs;
use std::os::raw::{c_char, c_float, c_int, c_void};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::runtime::{native_lib_dir, runtime_dir};

// ─── FFI bindings to libllama.so ────────────────────────────────────────

// Opaque types
#[repr(C)]
struct LlamaModel { _opaque: [u8; 0] }
#[repr(C)]
struct LlamaContext { _opaque: [u8; 0] }
#[repr(C)]
struct LlamaSampler { _opaque: [u8; 0] }
#[repr(C)]
struct LlamaVocab { _opaque: [u8; 0] }
#[repr(C)]
struct LlamaMemory { _opaque: [u8; 0] }

type LlamaToken = i32;

#[repr(C)]
#[derive(Clone, Copy)]
struct LlamaBatch {
    n_tokens: i32,
    token: *mut LlamaToken,
    embd: *mut c_float,
    pos: *mut i32,
    n_seq_id: *mut i32,
    seq_id: *mut *mut i32,
    logits: *mut i8,
}

#[repr(C)]
#[derive(Clone)]
struct LlamaModelParams {
    // We only need a few fields — use the default_params function
    _data: [u8; 256], // oversized to accommodate any version
}

#[repr(C)]
#[derive(Clone)]
struct LlamaContextParams {
    _data: [u8; 256],
}

#[repr(C)]
struct LlamaSamplerChainParams {
    no_perf: bool,
}

extern "C" {
    // These symbols come from libllama.so + libggml.so loaded by Android System.loadLibrary
    fn ggml_backend_load_all();
    fn llama_model_default_params() -> LlamaModelParams;
    fn llama_context_default_params() -> LlamaContextParams;
    fn llama_sampler_chain_default_params() -> LlamaSamplerChainParams;
    fn llama_model_load_from_file(path: *const c_char, params: LlamaModelParams) -> *mut LlamaModel;
    fn llama_model_free(model: *mut LlamaModel);
    fn llama_init_from_model(model: *mut LlamaModel, params: LlamaContextParams) -> *mut LlamaContext;
    fn llama_free(ctx: *mut LlamaContext);
    fn llama_model_get_vocab(model: *const LlamaModel) -> *const LlamaVocab;
    fn llama_get_memory(ctx: *const LlamaContext) -> *mut LlamaMemory;
    fn llama_memory_clear(mem: *mut LlamaMemory, data: bool);
    fn llama_tokenize(vocab: *const LlamaVocab, text: *const c_char, text_len: i32, tokens: *mut LlamaToken, n_tokens_max: i32, add_special: bool, parse_special: bool) -> i32;
    fn llama_token_to_piece(vocab: *const LlamaVocab, token: LlamaToken, buf: *mut c_char, length: i32, lstrip: i32, special: bool) -> i32;
    fn llama_vocab_is_eog(vocab: *const LlamaVocab, token: LlamaToken) -> bool;
    fn llama_batch_init(n_tokens: i32, embd: i32, n_seq_max: i32) -> LlamaBatch;
    fn llama_batch_free(batch: LlamaBatch);
    fn llama_decode(ctx: *mut LlamaContext, batch: LlamaBatch) -> i32;
    fn llama_sampler_chain_init(params: LlamaSamplerChainParams) -> *mut LlamaSampler;
    fn llama_sampler_chain_add(chain: *mut LlamaSampler, smpl: *mut LlamaSampler);
    fn llama_sampler_init_temp(t: c_float) -> *mut LlamaSampler;
    fn llama_sampler_init_dist(seed: u32) -> *mut LlamaSampler;
    fn llama_sampler_sample(smpl: *mut LlamaSampler, ctx: *mut LlamaContext, idx: i32) -> LlamaToken;
    fn llama_sampler_free(smpl: *mut LlamaSampler);
}

// ─── Global state ───────────────────────────────────────────────────────

struct LlmState {
    model: *mut LlamaModel,
    ctx: *mut LlamaContext,
    model_name: String,
}
unsafe impl Send for LlmState {}
unsafe impl Sync for LlmState {}

static LLM_STATE: Mutex<Option<LlmState>> = Mutex::new(None);
static LLM_ABORT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static BACKEND_INIT: std::sync::Once = std::sync::Once::new();

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

#[tauri::command]
pub async fn load_llm_model(app: AppHandle, filename: String, n_ctx: Option<u32>, n_threads: Option<u32>) -> Result<(), String> {
    let model_path = runtime_dir(&app).join("models").join(&filename);
    if !model_path.exists() {
        return Err(format!("Model not found: {}", filename));
    }

    // Init backend once
    BACKEND_INIT.call_once(|| unsafe { ggml_backend_load_all() });

    let path_cstr = CString::new(model_path.to_string_lossy().as_bytes())
        .map_err(|_| "Invalid path".to_string())?;

    eprintln!("[LLM] Loading model: {}", model_path.display());

    // Unload previous
    unload_llm_model_inner();

    unsafe {
        let model_params = llama_model_default_params();
        let model = llama_model_load_from_file(path_cstr.as_ptr(), model_params);
        if model.is_null() {
            return Err("Failed to load model".to_string());
        }

        let mut ctx_params = llama_context_default_params();
        // Set n_ctx and n_threads via raw pointer manipulation
        // The struct layout has n_ctx at offset 0 (uint32_t)
        let params_ptr = &mut ctx_params._data as *mut u8;
        let n_ctx_val = n_ctx.unwrap_or(4096);
        let n_threads_val = n_threads.unwrap_or(4);
        std::ptr::copy_nonoverlapping(&n_ctx_val as *const u32 as *const u8, params_ptr, 4);
        // n_threads is at a later offset — skip for now, use defaults

        let ctx = llama_init_from_model(model, ctx_params);
        if ctx.is_null() {
            llama_model_free(model);
            return Err("Failed to create context".to_string());
        }

        if let Ok(mut guard) = LLM_STATE.lock() {
            *guard = Some(LlmState {
                model,
                ctx,
                model_name: filename.clone(),
            });
        }
    }

    eprintln!("[LLM] Model loaded: {}", filename);
    Ok(())
}

fn unload_llm_model_inner() {
    if let Ok(mut guard) = LLM_STATE.lock() {
        if let Some(state) = guard.take() {
            unsafe {
                llama_free(state.ctx);
                llama_model_free(state.model);
            }
            eprintln!("[LLM] Model unloaded: {}", state.model_name);
        }
    }
}

#[tauri::command]
pub async fn unload_llm_model() -> Result<(), String> {
    unload_llm_model_inner();
    Ok(())
}

#[tauri::command]
pub async fn is_llm_loaded() -> bool {
    LLM_STATE.lock().map(|g| g.is_some()).unwrap_or(false)
}

#[tauri::command]
pub async fn abort_llm() -> Result<(), String> {
    LLM_ABORT.store(true, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn generate_llm(
    app: AppHandle,
    prompt: String,
    max_tokens: Option<i32>,
    temperature: Option<f32>,
) -> Result<String, String> {
    let guard = LLM_STATE.lock().map_err(|e| format!("Lock: {}", e))?;
    let state = guard.as_ref().ok_or("No model loaded")?;

    LLM_ABORT.store(false, std::sync::atomic::Ordering::Relaxed);
    let max = max_tokens.unwrap_or(512);
    let temp = temperature.unwrap_or(0.7);

    let model = state.model;
    let ctx = state.ctx;

    // Drop the guard before the long computation
    drop(guard);

    unsafe {
        let vocab = llama_model_get_vocab(model);
        let prompt_cstr = CString::new(prompt.as_bytes()).map_err(|_| "Invalid prompt")?;

        // Tokenize
        let n_prompt = llama_tokenize(vocab, prompt_cstr.as_ptr(), prompt.len() as i32, std::ptr::null_mut(), 0, true, true);
        if n_prompt < 0 {
            return Err("Tokenization failed".to_string());
        }
        let mut tokens = vec![0i32; (n_prompt + 1) as usize];
        llama_tokenize(vocab, prompt_cstr.as_ptr(), prompt.len() as i32, tokens.as_mut_ptr(), n_prompt + 1, true, true);

        // Clear memory
        let mem = llama_get_memory(ctx);
        if !mem.is_null() {
            llama_memory_clear(mem, true);
        }

        // Process prompt
        let mut batch = llama_batch_init(n_prompt, 0, 1);
        for i in 0..n_prompt as usize {
            *batch.token.add(i) = tokens[i];
            *batch.pos.add(i) = i as i32;
            *batch.n_seq_id.add(i) = 1;
            *(*batch.seq_id.add(i)) = 0;
            *batch.logits.add(i) = if i == (n_prompt as usize - 1) { 1 } else { 0 };
        }
        batch.n_tokens = n_prompt;

        if llama_decode(ctx, batch) != 0 {
            llama_batch_free(batch);
            return Err("Prompt decode failed".to_string());
        }

        // Setup sampler
        let sampler = llama_sampler_chain_init(llama_sampler_chain_default_params());
        llama_sampler_chain_add(sampler, llama_sampler_init_temp(temp));
        llama_sampler_chain_add(sampler, llama_sampler_init_dist(42));

        let mut result = String::new();
        let mut n_cur = n_prompt;

        for _ in 0..max {
            if LLM_ABORT.load(std::sync::atomic::Ordering::Relaxed) { break; }

            let new_token = llama_sampler_sample(sampler, ctx, -1);
            if llama_vocab_is_eog(vocab, new_token) { break; }

            // Token to text
            let mut buf = [0u8; 256];
            let n = llama_token_to_piece(vocab, new_token, buf.as_mut_ptr() as *mut c_char, 256, 0, true);
            if n > 0 {
                let piece = std::str::from_utf8(&buf[..n as usize]).unwrap_or("");
                result.push_str(piece);

                // Emit token event for streaming
                let _ = app.emit("llm-token", piece);
            }

            // Next batch
            llama_batch_free(batch);
            batch = llama_batch_init(1, 0, 1);
            *batch.token = new_token;
            *batch.pos = n_cur;
            *batch.n_seq_id = 1;
            **batch.seq_id = 0;
            *batch.logits = 1;
            batch.n_tokens = 1;
            n_cur += 1;

            if llama_decode(ctx, batch) != 0 { break; }
        }

        llama_sampler_free(sampler);
        llama_batch_free(batch);

        eprintln!("[LLM] Generated {} tokens", n_cur - n_prompt);
        Ok(result)
    }
}

// Keep download-related commands that don't need server
#[tauri::command]
pub async fn check_llm_health() -> bool {
    is_llm_loaded().await
}
