use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("failed to resolve app data dir")
}

fn speech_dir(app: &AppHandle) -> PathBuf {
    data_dir(app).join("speech")
}

// ─── STT ───────────────────────────────────────────────────────────────
// On mobile, STT uses the browser SpeechRecognition API (no Parakeet).
// These commands exist so the shared UI code doesn't crash.

#[tauri::command]
pub async fn stt_download_model(_app: AppHandle) -> Result<(), String> {
    // No model needed on mobile — uses browser SpeechRecognition
    Ok(())
}

#[tauri::command]
pub async fn stt_load_model(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn stt_transcribe(_app: AppHandle, _audio_base64: String) -> Result<String, String> {
    Err("Use browser SpeechRecognition on mobile".to_string())
}

#[tauri::command]
pub async fn stt_available(_app: AppHandle) -> bool {
    false // STT handled by browser API on mobile
}

#[tauri::command]
pub async fn stt_loaded(_app: AppHandle) -> bool {
    false
}

// ─── TTS ───────────────────────────────────────────────────────────────
// On mobile, TTS uses the browser SpeechSynthesis API (no Pocket TTS).

#[tauri::command]
pub async fn tts_start(_app: AppHandle) -> Result<u16, String> {
    Err("TTS uses browser SpeechSynthesis on mobile".to_string())
}

#[tauri::command]
pub async fn tts_speak(_app: AppHandle, _text: String, _voice: Option<String>) -> Result<String, String> {
    Err("Use browser SpeechSynthesis on mobile".to_string())
}

#[tauri::command]
pub async fn tts_stop(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn tts_available() -> bool {
    false // TTS handled by browser API on mobile
}

// ─── Voice Cloning ─────────────────────────────────────────────────────
// Voice cloning stores WAV files but actual cloning requires Pocket TTS (desktop only).

#[tauri::command]
pub async fn tts_save_voice_clone(app: AppHandle, audio_base64: String, name: String) -> Result<String, String> {
    let dir = speech_dir(&app).join("voices");
    let _ = fs::create_dir_all(&dir);

    // Decode base64
    let data = audio_base64.find(',').map(|i| &audio_base64[i + 1..]).unwrap_or(&audio_base64);
    let wav_bytes = base64_decode(data)?;
    let wav_path = dir.join(format!("{}.wav", name));
    fs::write(&wav_path, &wav_bytes).map_err(|e| format!("Write: {}", e))?;
    Ok(wav_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn tts_list_voice_clones(app: AppHandle) -> Vec<String> {
    let dir = speech_dir(&app).join("voices");
    let mut clones = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "wav").unwrap_or(false) {
                if let Some(stem) = path.file_stem() {
                    clones.push(stem.to_string_lossy().to_string());
                }
            }
        }
    }
    clones
}

#[tauri::command]
pub async fn tts_delete_voice_clone(app: AppHandle, name: String) -> Result<(), String> {
    let path = speech_dir(&app).join("voices").join(format!("{}.wav", name));
    fs::remove_file(&path).map_err(|e| format!("Delete: {}", e))?;
    Ok(())
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    let clean: Vec<u8> = input.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    let mut out = Vec::new();
    let len = clean.len();
    let mut i = 0;
    while i + 3 < len {
        let a = b64val(clean[i])?;
        let b = b64val(clean[i + 1])?;
        let c = if clean[i + 2] != b'=' { b64val(clean[i + 2])? } else { 0 };
        let d = if clean[i + 3] != b'=' { b64val(clean[i + 3])? } else { 0 };
        out.push((a << 2) | (b >> 4));
        if clean[i + 2] != b'=' { out.push((b << 4) | (c >> 2)); }
        if clean[i + 3] != b'=' { out.push((c << 6) | d); }
        i += 4;
    }
    Ok(out)
}

fn b64val(c: u8) -> Result<u8, String> {
    match c {
        b'A'..=b'Z' => Ok(c - b'A'),
        b'a'..=b'z' => Ok(c - b'a' + 26),
        b'0'..=b'9' => Ok(c - b'0' + 52),
        b'+' => Ok(62),
        b'/' => Ok(63),
        _ => Err(format!("Invalid b64: {}", c as char)),
    }
}
