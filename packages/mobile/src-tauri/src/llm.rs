use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
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

static ACTIVE_MODEL: Mutex<Option<String>> = Mutex::new(None);

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

/// Load a GGUF model via Kotlin LlamaEngine (JNI).
#[tauri::command]
pub async fn load_llm_model(app: AppHandle, filename: String) -> Result<(), String> {
    let model_path = runtime_dir(&app).join("models").join(&filename);
    if !model_path.exists() {
        return Err(format!("Model not found: {}", filename));
    }

    let path_str = model_path.to_string_lossy().to_string();
    eprintln!("[LLM] Loading model via Kotlin JNI: {}", path_str);

    // Call Kotlin LlamaEngine.load(path, contextSize, threads) via Tauri's Android JNI
    app.run_on_main_thread(move || {
        let vm = unsafe { jni::JavaVM::from_raw(ndk_context::android_context().vm().cast()).unwrap() };
        let mut env = vm.attach_current_thread().unwrap();

        // Find LlamaEngine class
        let class = env.find_class("ai/opencode/mobile/LlamaEngine").unwrap();
        let path_jstr = env.new_string(&path_str).unwrap();

        // Call LlamaEngine.INSTANCE.load(path, 4096, 4)
        let result = env.call_static_method(
            class,
            "load",
            "(Ljava/lang/String;II)Z",
            &[
                jni::objects::JValue::Object(&path_jstr),
                jni::objects::JValue::Int(4096),
                jni::objects::JValue::Int(4),
            ],
        );

        match result {
            Ok(jni::objects::JValueGen::Bool(success)) => {
                if success == 0 {
                    eprintln!("[LLM] Kotlin LlamaEngine.load returned false");
                } else {
                    eprintln!("[LLM] Model loaded successfully via JNI");
                }
            }
            Err(e) => {
                eprintln!("[LLM] JNI call failed: {:?}", e);
            }
            _ => {}
        }
    }).map_err(|e| format!("Main thread error: {:?}", e))?;

    if let Ok(mut guard) = ACTIVE_MODEL.lock() {
        *guard = Some(filename);
    }

    Ok(())
}

#[tauri::command]
pub async fn unload_llm_model(app: AppHandle) -> Result<(), String> {
    app.run_on_main_thread(|| {
        let vm = unsafe { jni::JavaVM::from_raw(ndk_context::android_context().vm().cast()).unwrap() };
        let mut env = vm.attach_current_thread().unwrap();
        let class = env.find_class("ai/opencode/mobile/LlamaEngine").unwrap();
        let _ = env.call_static_method(class, "unload", "()V", &[]);
    }).map_err(|e| format!("Main thread error: {:?}", e))?;

    if let Ok(mut guard) = ACTIVE_MODEL.lock() {
        *guard = None;
    }
    Ok(())
}

#[tauri::command]
pub async fn is_llm_loaded(app: AppHandle) -> bool {
    let (tx, rx) = std::sync::mpsc::channel();
    let _ = app.run_on_main_thread(move || {
        let vm = unsafe { jni::JavaVM::from_raw(ndk_context::android_context().vm().cast()).unwrap() };
        let mut env = vm.attach_current_thread().unwrap();
        let class = env.find_class("ai/opencode/mobile/LlamaEngine").unwrap();
        let result = env.call_static_method(class, "loaded", "()Z", &[]);
        let loaded = matches!(result, Ok(jni::objects::JValueGen::Bool(1)));
        let _ = tx.send(loaded);
    });
    rx.recv().unwrap_or(false)
}

#[tauri::command]
pub async fn abort_llm(app: AppHandle) -> Result<(), String> {
    app.run_on_main_thread(|| {
        let vm = unsafe { jni::JavaVM::from_raw(ndk_context::android_context().vm().cast()).unwrap() };
        let mut env = vm.attach_current_thread().unwrap();
        let class = env.find_class("ai/opencode/mobile/LlamaEngine").unwrap();
        let _ = env.call_static_method(class, "stop", "()V", &[]);
    }).map_err(|e| format!("Main thread error: {:?}", e))?;
    Ok(())
}

/// Generate text via Kotlin LlamaEngine.chat() with streaming.
#[tauri::command]
pub async fn generate_llm(
    app: AppHandle,
    prompt: String,
    max_tokens: Option<i32>,
    temperature: Option<f32>,
) -> Result<String, String> {
    let max = max_tokens.unwrap_or(512);
    let temp = temperature.unwrap_or(0.7);

    let (tx, rx) = std::sync::mpsc::channel();
    let app_clone = app.clone();

    app.run_on_main_thread(move || {
        let vm = unsafe { jni::JavaVM::from_raw(ndk_context::android_context().vm().cast()).unwrap() };
        let mut env = vm.attach_current_thread().unwrap();
        let class = env.find_class("ai/opencode/mobile/LlamaEngine").unwrap();
        let prompt_jstr = env.new_string(&prompt).unwrap();

        // Call chat(prompt, maxTokens, temperature, null) — no callback for now
        let result = env.call_static_method(
            class,
            "chat",
            "(Ljava/lang/String;IFLkotlin/jvm/functions/Function1;)Ljava/lang/String;",
            &[
                jni::objects::JValue::Object(&prompt_jstr),
                jni::objects::JValue::Int(max),
                jni::objects::JValue::Float(temp),
                jni::objects::JValue::Object(&jni::objects::JObject::null()),
            ],
        );

        let text = match result {
            Ok(jni::objects::JValueGen::Object(obj)) => {
                let jstr = jni::objects::JString::from(obj);
                env.get_string(&jstr).map(|s| s.into()).unwrap_or_else(|_| String::from("[ERROR] String conversion failed"))
            }
            Err(e) => format!("[ERROR] JNI call failed: {:?}", e),
            _ => String::from("[ERROR] Unexpected return type"),
        };

        let _ = app_clone.emit("llm-token", &text);
        let _ = tx.send(text);
    }).map_err(|e| format!("Main thread error: {:?}", e))?;

    rx.recv().map_err(|e| format!("Channel error: {}", e))
}

#[tauri::command]
pub async fn check_llm_health(app: AppHandle) -> bool {
    is_llm_loaded(app).await
}
