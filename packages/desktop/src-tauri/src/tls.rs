use std::path::PathBuf;

use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, path::BaseDirectory};

#[derive(Clone, Debug)]
pub struct TlsCerts {
    pub cert_path: PathBuf,
    pub key_path: PathBuf,
    /// SHA-256 fingerprint formatted as colon-separated uppercase hex (e.g. "AB:CD:EF:…")
    pub fingerprint: String,
    /// SHA-256 of the SubjectPublicKeyInfo, base64-encoded with standard
    /// padding. Format expected by Chromium's
    /// `--ignore-certificate-errors-spki-list=<b64>` flag — we pass this to
    /// WebView2 so the app's own WS upgrades (`wss://127.0.0.1:PORT/...`)
    /// can succeed against the self-signed loopback cert without blanket
    /// cert-error ignore. Rotating the cert rotates this hash.
    pub spki_hash_b64: String,
}

fn tls_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("tls", BaseDirectory::AppLocalData)
        .map_err(|e| format!("Failed to resolve TLS directory: {e}"))
}

/// Returns the TLS certs, generating them if they don't exist yet.
///
/// Files created:
///   AppLocalData/tls/cert.pem         — certificate (PEM)
///   AppLocalData/tls/key.pem          — private key (PEM)
///   AppLocalData/tls/fingerprint.txt  — SHA-256 fingerprint (colon-separated hex)
pub fn ensure_cert(app: &AppHandle) -> Result<TlsCerts, String> {
    let dir = tls_dir(app)?;
    let cert_path = dir.join("cert.pem");
    let key_path = dir.join("key.pem");
    let fp_path = dir.join("fingerprint.txt");
    let spki_path = dir.join("spki_hash.txt");

    // Missing spki_hash.txt = old install pre-v6; force a regenerate so
    // WebView2 SPKI pinning can find the hash. Fingerprint rotates too,
    // which means paired mobiles need to re-scan the QR — acceptable
    // trade-off to unblock the desktop terminal WS.
    if !cert_path.exists() || !key_path.exists() || !fp_path.exists() || !spki_path.exists() {
        generate_cert(&dir, &cert_path, &key_path, &fp_path, &spki_path)?;
    }

    let fingerprint = std::fs::read_to_string(&fp_path)
        .map_err(|e| format!("Failed to read TLS fingerprint: {e}"))?
        .trim()
        .to_string();
    let spki_hash_b64 = std::fs::read_to_string(&spki_path)
        .map_err(|e| format!("Failed to read TLS SPKI hash: {e}"))?
        .trim()
        .to_string();

    Ok(TlsCerts {
        cert_path,
        key_path,
        fingerprint,
        spki_hash_b64,
    })
}

/// Regenerate the TLS certificate (e.g. when the user clicks "Rotate certificate").
pub fn regenerate_cert(app: &AppHandle) -> Result<TlsCerts, String> {
    let dir = tls_dir(app)?;
    let cert_path = dir.join("cert.pem");
    let key_path = dir.join("key.pem");
    let fp_path = dir.join("fingerprint.txt");
    let spki_path = dir.join("spki_hash.txt");

    generate_cert(&dir, &cert_path, &key_path, &fp_path, &spki_path)?;

    let fingerprint = std::fs::read_to_string(&fp_path)
        .map_err(|e| format!("Failed to read TLS fingerprint: {e}"))?
        .trim()
        .to_string();
    let spki_hash_b64 = std::fs::read_to_string(&spki_path)
        .map_err(|e| format!("Failed to read TLS SPKI hash: {e}"))?
        .trim()
        .to_string();

    Ok(TlsCerts {
        cert_path,
        key_path,
        fingerprint,
        spki_hash_b64,
    })
}

/// Read the certificate PEM for export / display.
pub fn get_cert_pem(app: &AppHandle) -> Result<String, String> {
    let dir = tls_dir(app)?;
    std::fs::read_to_string(dir.join("cert.pem"))
        .map_err(|e| format!("Failed to read TLS certificate: {e}"))
}

fn generate_cert(
    dir: &PathBuf,
    cert_path: &PathBuf,
    key_path: &PathBuf,
    fp_path: &PathBuf,
    spki_path: &PathBuf,
) -> Result<(), String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
    use rcgen::{CertificateParams, KeyPair};

    std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create TLS directory: {e}"))?;

    // Subject Alt Names: localhost + 127.0.0.1 (IP strings are auto-detected by rcgen)
    let mut params = CertificateParams::new(vec![
        "localhost".to_string(),
        "127.0.0.1".to_string(),
    ])
    .map_err(|e| format!("Failed to create certificate params: {e}"))?;

    // 10-year validity
    params.not_after = rcgen::date_time_ymd(2035, 1, 1);

    let key_pair =
        KeyPair::generate().map_err(|e| format!("Failed to generate TLS key pair: {e}"))?;

    let cert = params
        .self_signed(&key_pair)
        .map_err(|e| format!("Failed to self-sign TLS certificate: {e}"))?;

    // Compute fingerprint from DER bytes before writing
    let fingerprint = {
        let der: &[u8] = cert.der();
        let hash = Sha256::digest(der);
        hash.iter()
            .enumerate()
            .map(|(i, b)| if i == 0 { format!("{b:02X}") } else { format!(":{b:02X}") })
            .collect::<String>()
    };

    // Compute the SubjectPublicKeyInfo SHA-256 base64 for Chromium's
    // `--ignore-certificate-errors-spki-list=<b64>` flag. rcgen's
    // `KeyPair::public_key_der()` returns exactly the DER-encoded SPKI we
    // need.
    let spki_hash_b64 = {
        let spki_der = key_pair.public_key_der();
        let hash = Sha256::digest(&spki_der);
        B64.encode(hash)
    };

    std::fs::write(cert_path, cert.pem())
        .map_err(|e| format!("Failed to write cert.pem: {e}"))?;
    std::fs::write(key_path, key_pair.serialize_pem())
        .map_err(|e| format!("Failed to write key.pem: {e}"))?;
    std::fs::write(fp_path, &fingerprint)
        .map_err(|e| format!("Failed to write fingerprint.txt: {e}"))?;
    std::fs::write(spki_path, &spki_hash_b64)
        .map_err(|e| format!("Failed to write spki_hash.txt: {e}"))?;

    tracing::info!(
        fingerprint,
        spki_hash_b64,
        path = %cert_path.display(),
        "Generated self-signed TLS certificate"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
    use std::sync::atomic::{AtomicU32, Ordering};

    static TEST_COUNTER: AtomicU32 = AtomicU32::new(0);

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let n = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let p = std::env::temp_dir().join(format!("oc_test_{}_{}", prefix, n));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn call_generate_cert(dir: &PathBuf) -> Result<(), String> {
        let cert_path = dir.join("cert.pem");
        let key_path = dir.join("key.pem");
        let fp_path = dir.join("fingerprint.txt");
        let spki_path = dir.join("spki_hash.txt");
        generate_cert(dir, &cert_path, &key_path, &fp_path, &spki_path)
    }

    // ── Test 1 ──────────────────────────────────────────────────────────────
    #[test]
    fn generate_cert_creates_all_four_files() {
        let dir = unique_temp_dir("tls_four_files");
        call_generate_cert(&dir).expect("generate_cert should succeed");

        assert!(dir.join("cert.pem").exists(), "cert.pem must exist");
        assert!(dir.join("key.pem").exists(), "key.pem must exist");
        assert!(dir.join("fingerprint.txt").exists(), "fingerprint.txt must exist");
        assert!(dir.join("spki_hash.txt").exists(), "spki_hash.txt must exist");
    }

    // ── Test 2 ──────────────────────────────────────────────────────────────
    #[test]
    fn fingerprint_format_is_colon_separated_hex() {
        let dir = unique_temp_dir("tls_fp_format");
        call_generate_cert(&dir).expect("generate_cert should succeed");

        let fp = std::fs::read_to_string(dir.join("fingerprint.txt"))
            .expect("fingerprint.txt must be readable");
        let fp = fp.trim();

        // SHA-256 = 32 bytes → 32 pairs of 2 hex chars + 31 colons = 95 chars
        assert_eq!(
            fp.len(),
            95,
            "fingerprint must be 95 chars (32 hex pairs + 31 colons), got {}",
            fp.len()
        );

        let parts: Vec<&str> = fp.split(':').collect();
        assert_eq!(parts.len(), 32, "fingerprint must have 32 colon-separated groups");
        for part in &parts {
            assert_eq!(part.len(), 2, "each group must be exactly 2 chars, got {part:?}");
        }
    }

    // ── Test 3 ──────────────────────────────────────────────────────────────
    #[test]
    fn fingerprint_contains_only_uppercase_hex() {
        let dir = unique_temp_dir("tls_fp_upper");
        call_generate_cert(&dir).expect("generate_cert should succeed");

        let fp = std::fs::read_to_string(dir.join("fingerprint.txt"))
            .expect("fingerprint.txt must be readable");
        let fp = fp.trim();

        for ch in fp.chars() {
            assert!(
                ch.is_ascii_hexdigit() || ch == ':',
                "unexpected character {ch:?} in fingerprint"
            );
            // Lowercase hex letters must not appear
            assert!(
                !ch.is_ascii_lowercase(),
                "fingerprint must be uppercase hex, found lowercase {ch:?}"
            );
        }
    }

    // ── Test 4 ──────────────────────────────────────────────────────────────
    #[test]
    fn spki_hash_is_valid_base64() {
        let dir = unique_temp_dir("tls_spki_b64");
        call_generate_cert(&dir).expect("generate_cert should succeed");

        let spki = std::fs::read_to_string(dir.join("spki_hash.txt"))
            .expect("spki_hash.txt must be readable");
        let spki = spki.trim();

        let decoded = B64.decode(spki);
        assert!(
            decoded.is_ok(),
            "spki_hash.txt must be valid base64, decode error: {:?}",
            decoded.err()
        );
        // SHA-256 digest = 32 bytes
        assert_eq!(
            decoded.unwrap().len(),
            32,
            "decoded SPKI hash must be 32 bytes"
        );
    }

    // ── Test 5 ──────────────────────────────────────────────────────────────
    #[test]
    fn cert_pem_starts_with_certificate_header() {
        let dir = unique_temp_dir("tls_cert_header");
        call_generate_cert(&dir).expect("generate_cert should succeed");

        let pem = std::fs::read_to_string(dir.join("cert.pem"))
            .expect("cert.pem must be readable");

        assert!(
            pem.starts_with("-----BEGIN CERTIFICATE-----"),
            "cert.pem must start with '-----BEGIN CERTIFICATE-----'"
        );
    }

    // ── Test 6 ──────────────────────────────────────────────────────────────
    #[test]
    fn key_pem_starts_with_private_key_header() {
        let dir = unique_temp_dir("tls_key_header");
        call_generate_cert(&dir).expect("generate_cert should succeed");

        let pem = std::fs::read_to_string(dir.join("key.pem"))
            .expect("key.pem must be readable");

        assert!(
            pem.starts_with("-----BEGIN"),
            "key.pem must start with '-----BEGIN', got: {:?}",
            &pem[..pem.len().min(40)]
        );
    }

    // ── Test 7 ──────────────────────────────────────────────────────────────
    #[test]
    fn regenerate_cert_produces_different_fingerprint() {
        let dir1 = unique_temp_dir("tls_regen_fp1");
        let dir2 = unique_temp_dir("tls_regen_fp2");

        call_generate_cert(&dir1).expect("first generate_cert should succeed");
        call_generate_cert(&dir2).expect("second generate_cert should succeed");

        let fp1 = std::fs::read_to_string(dir1.join("fingerprint.txt"))
            .expect("fingerprint.txt 1 must be readable");
        let fp2 = std::fs::read_to_string(dir2.join("fingerprint.txt"))
            .expect("fingerprint.txt 2 must be readable");

        assert_ne!(
            fp1.trim(),
            fp2.trim(),
            "two independently generated certs must have different fingerprints"
        );
    }

    // ── Test 8 ──────────────────────────────────────────────────────────────
    #[test]
    fn generate_cert_idempotent_overwrite() {
        let dir = unique_temp_dir("tls_overwrite");

        // First call
        call_generate_cert(&dir).expect("first generate_cert should succeed");
        let fp_first = std::fs::read_to_string(dir.join("fingerprint.txt"))
            .expect("fingerprint.txt must be readable after first call");

        // Second call in the same dir — must succeed and overwrite
        call_generate_cert(&dir).expect("second generate_cert (overwrite) should succeed");
        let fp_second = std::fs::read_to_string(dir.join("fingerprint.txt"))
            .expect("fingerprint.txt must be readable after second call");

        // All four files still present
        assert!(dir.join("cert.pem").exists());
        assert!(dir.join("key.pem").exists());
        assert!(dir.join("fingerprint.txt").exists());
        assert!(dir.join("spki_hash.txt").exists());

        // New cert has a different fingerprint (fresh key pair each time)
        assert_ne!(
            fp_first.trim(),
            fp_second.trim(),
            "overwrite must produce a new fingerprint"
        );
    }
}
