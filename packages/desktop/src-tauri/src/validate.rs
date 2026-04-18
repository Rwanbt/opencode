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

/// Extensions that are always refused from `open_path`: they execute code on
/// double-click across Windows / macOS / Linux shells, so an XSS issuing
/// invoke("open_path") would otherwise be RCE.
const FORBIDDEN_OPEN_EXT: &[&str] = &[
    "exe", "bat", "cmd", "com", "ps1", "psm1", "vbs", "vbe", "js", "jse",
    "msi", "msp", "reg", "scr", "lnk", "inf", "hta", "wsf", "cpl", "jar",
    "sh", "bash", "zsh", "command", "app", "dylib", "so", "dll",
];

/// Validate a target for the `open_path` Tauri command.
///
/// We accept two shapes:
/// * an `http://` or `https://` URL (opened in the default browser);
/// * a filesystem path that (a) canonicalizes successfully, (b) does not have
///   a forbidden executable extension, (c) does not contain a NUL byte.
///
/// Everything else (javascript:, file:, data:, opencode:, bare aliases) is
/// refused — an XSS must not be able to launch arbitrary binaries.
pub fn validate_open_target(target: &str) -> Result<String, String> {
    if target.is_empty() || target.len() > 4096 || target.contains('\0') {
        return Err("path length invalid".into());
    }

    if let Ok(parsed) = url::Url::parse(target) {
        match parsed.scheme() {
            "http" | "https" => return Ok(target.to_string()),
            "file" | "data" | "javascript" | "opencode" => {
                return Err(format!("scheme not allowed: {}", parsed.scheme()));
            }
            // Single-letter schemes on Windows (`C:\…`) parse as Url with a
            // drive-letter scheme — fall through to the filesystem branch.
            _ => {}
        }
    }

    let p = Path::new(target);
    let canonical = p
        .canonicalize()
        .map_err(|e| format!("cannot resolve path: {e}"))?;

    if let Some(ext) = canonical.extension().and_then(|e| e.to_str()) {
        let lower = ext.to_ascii_lowercase();
        if FORBIDDEN_OPEN_EXT.iter().any(|e| *e == lower) {
            return Err(format!("extension not allowed: {lower}"));
        }
    }

    Ok(canonical.to_string_lossy().to_string())
}

/// Validate the optional `app_name` parameter of `open_path`. The upstream
/// resolver later maps this to an executable; if we let an attacker pass a
/// fully-qualified binary path here they could launch anything. We only allow
/// short bare aliases made of letters, digits, dash, dot, underscore, plus
/// spaces — covering `code`, `cursor`, `iTerm`, `Google Chrome`, etc.
/// Validate a filesystem name used to build a voice-clone / user asset file.
/// Unlike `validate_filename`, this version does not require a specific
/// extension — the caller appends its own (`.wav` for voice clones). We
/// refuse anything that contains a path separator, null byte, or traversal
/// component so a hostile deep link / XSS cannot write outside the intended
/// directory.
pub fn validate_voice_clone_name(name: &str) -> Result<&str, String> {
    if name.is_empty() || name.len() > 128 {
        return Err("voice clone name length out of range".into());
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") || name.contains('\0') {
        return Err("voice clone name contains forbidden characters".into());
    }
    // Only allow a conservative charset: letters, digits, dash, dot,
    // underscore, space. Rejects leading `.` (hidden files on unix) by
    // bounding the first char separately.
    let mut chars = name.chars();
    let first = chars.next().ok_or("empty")?;
    if !(first.is_ascii_alphanumeric() || first == '_') {
        return Err("voice clone name must start with a letter, digit, or underscore".into());
    }
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ')) {
        return Err("voice clone name has invalid characters".into());
    }
    Ok(name)
}

/// Cap the size of arbitrary text fed to TTS / markdown / synthesis
/// commands. The limit is generous (1 MiB of UTF-8) but prevents an XSS
/// from pinning the process by feeding megabytes through the parser.
pub fn validate_bounded_text(text: &str, max_bytes: usize, label: &str) -> Result<(), String> {
    if text.len() > max_bytes {
        return Err(format!("{label} exceeds {max_bytes} byte limit"));
    }
    if text.contains('\0') {
        return Err(format!("{label} contains a null byte"));
    }
    Ok(())
}

pub fn validate_open_app_name(name: &str) -> Result<&str, String> {
    if name.is_empty() || name.len() > 64 {
        return Err("app_name length out of range".into());
    }
    if name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name.contains('\0')
    {
        return Err("app_name contains forbidden characters".into());
    }
    if !name.chars().all(|c| {
        c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ')
    }) {
        return Err("app_name has invalid characters".into());
    }
    Ok(name)
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

    #[test]
    fn open_target_rejects_dangerous_schemes() {
        assert!(validate_open_target("javascript:alert(1)").is_err());
        assert!(validate_open_target("data:text/html,<script>").is_err());
        assert!(validate_open_target("file:///etc/passwd").is_err());
        assert!(validate_open_target("opencode://connect").is_err());
        assert!(validate_open_target("").is_err());
        assert!(validate_open_target("x\0y").is_err());
    }

    #[test]
    fn open_target_accepts_http_urls() {
        assert!(validate_open_target("https://example.com/").is_ok());
        assert!(validate_open_target("http://localhost:3000/").is_ok());
    }

    #[test]
    fn open_app_name_rejects_path_like() {
        assert!(validate_open_app_name("C:\\Windows\\System32\\cmd.exe").is_err());
        assert!(validate_open_app_name("../../evil").is_err());
        assert!(validate_open_app_name("/usr/bin/sh").is_err());
        assert!(validate_open_app_name("").is_err());
        assert!(validate_open_app_name("x\0y").is_err());
    }

    #[test]
    fn open_app_name_accepts_aliases() {
        assert!(validate_open_app_name("code").is_ok());
        assert!(validate_open_app_name("cursor").is_ok());
        assert!(validate_open_app_name("Google Chrome").is_ok());
        assert!(validate_open_app_name("iTerm").is_ok());
        assert!(validate_open_app_name("vscode-insiders").is_ok());
    }
}
