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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_path_traversal() {
        assert!(validate_filename("../../../etc/passwd").is_err());
        assert!(validate_filename("..\\..\\windows\\system32\\cmd.exe").is_err());
        assert!(validate_filename("foo/bar.gguf").is_err());
        assert!(validate_filename("foo\\bar.gguf").is_err());
        assert!(validate_filename("bar\0.gguf").is_err());
    }

    #[test]
    fn rejects_bad_extension() {
        assert!(validate_filename("foo.exe").is_err());
        assert!(validate_filename("").is_err());
        assert!(validate_filename("no-ext").is_err());
    }

    #[test]
    fn accepts_gguf_and_onnx() {
        assert!(validate_filename("model-Q4.gguf").is_ok());
        assert!(validate_filename("kokoro.onnx").is_ok());
    }

    #[test]
    fn rejects_bad_url() {
        assert!(validate_url("http://huggingface.co/x").is_err());
        assert!(validate_url("https://evil.com/x").is_err());
        assert!(validate_url("https://huggingface.co.evil.com/x").is_err());
        assert!(validate_url("not a url").is_err());
    }

    #[test]
    fn accepts_allowlist_url() {
        assert!(validate_url("https://huggingface.co/unsloth/model/resolve/main/x.gguf").is_ok());
        assert!(validate_url("https://cdn-lfs.huggingface.co/repos/foo/bar").is_ok());
    }
}
