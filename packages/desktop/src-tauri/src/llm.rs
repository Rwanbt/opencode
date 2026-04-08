use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

fn models_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("failed to resolve app data dir")
        .join("models")
}

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
    let part = dir.join(format!("{}.part", &filename));

    tracing::info!("[LLM] Downloading {} -> {}", url, target.display());

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
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

        if last_emit.elapsed().as_millis() > 200 {
            let _ = app.emit(
                "model-download-progress",
                ModelDownloadProgress {
                    filename: filename.clone(),
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

    tokio::fs::rename(&part, &target)
        .await
        .map_err(|e| format!("Rename: {}", e))?;

    let _ = app.emit(
        "model-download-progress",
        ModelDownloadProgress {
            filename: filename.clone(),
            downloaded: total,
            total,
            progress: 1.0,
        },
    );

    tracing::info!("[LLM] Download complete: {}", filename);
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
pub async fn check_llm_health(_port: Option<u16>) -> bool {
    false
}

#[tauri::command]
#[specta::specta]
pub async fn load_llm_model(_app: AppHandle, _filename: String) -> Result<(), String> {
    Err("Local model loading not yet supported on desktop".to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn unload_llm_model() -> Result<(), String> {
    Err("Local model loading not yet supported on desktop".to_string())
}
