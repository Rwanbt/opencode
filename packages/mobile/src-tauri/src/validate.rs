//! Input validation for Tauri commands exposed to the WebView.
//! Untrusted data (from a possible XSS) must not reach the filesystem or network unchecked.

use std::path::Path;

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
