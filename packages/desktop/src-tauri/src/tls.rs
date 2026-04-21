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
