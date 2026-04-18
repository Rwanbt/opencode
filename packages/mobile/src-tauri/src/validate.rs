//! Input validation for Tauri commands exposed to the WebView.
//! Untrusted data (from a possible XSS) must not reach the filesystem or network unchecked.

use std::path::Path;

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
const ALLOWED_HOSTS: &[&str] = &[
    "huggingface.co",
    "hf.co",
    "cdn-lfs.huggingface.co",
    "cdn-lfs.hf.co",
];

pub fn validate_filename(name: &str) -> Result<&str, String> {
    if name.is_empty() || name.len() > 256 {
        return Err("filename length out of range".into());
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") || name.contains('\0') {
        return Err("filename contains forbidden characters".into());
    }
    let p = Path::new(name);
    match p.extension().and_then(|e| e.to_str()) {
        Some("gguf") | Some("onnx") => Ok(name),
        _ => Err("unsupported file extension".into()),
    }
}

/// Defence-in-depth guard for arbitrary text passed to Tauri commands.
/// Bounds the size and refuses null bytes — anything more specific
/// (charset, extension, …) should use a dedicated validator.
pub fn validate_bounded_text(text: &str, max_bytes: usize, label: &str) -> Result<(), String> {
    if text.len() > max_bytes {
        return Err(format!("{label} exceeds {max_bytes} byte limit"));
    }
    if text.contains('\0') {
        return Err(format!("{label} contains a null byte"));
    }
    Ok(())
}

/// Guard for user-supplied asset names that will be concatenated into a
/// filesystem path (voice clones, etc). Refuses path separators, traversal
/// components, control chars, and caps the length.
pub fn validate_voice_clone_name(name: &str) -> Result<&str, String> {
    if name.is_empty() || name.len() > 128 {
        return Err("voice clone name length out of range".into());
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") || name.contains('\0') {
        return Err("voice clone name contains forbidden characters".into());
    }
    let first = name.chars().next().ok_or("empty")?;
    if !(first.is_ascii_alphanumeric() || first == '_') {
        return Err("voice clone name must start with a letter, digit, or underscore".into());
    }
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ')) {
        return Err("voice clone name has invalid characters".into());
    }
    Ok(name)
}

// `validate_url` pulls in the `url` crate which is declared only under
// `[target.'cfg(target_os = "android")'.dependencies]` in Cargo.toml. The
// only caller (`download_model` in llm.rs) is itself android-only, so the
// function is cfg-gated to match.
#[cfg(target_os = "android")]
pub fn validate_url(url: &str) -> Result<&str, String> {
    let parsed = url::Url::parse(url).map_err(|e| format!("invalid url: {e}"))?;
    if parsed.scheme() != "https" {
        return Err("only https URLs allowed".into());
    }
    let host = parsed.host_str().ok_or("missing host")?;
    if !ALLOWED_HOSTS.iter().any(|h| host == *h || host.ends_with(&format!(".{h}"))) {
        return Err(format!("host not in allowlist: {host}"));
    }
    Ok(url)
}
