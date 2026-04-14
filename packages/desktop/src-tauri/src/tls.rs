use std::path::PathBuf;

use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, path::BaseDirectory};

#[derive(Clone, Debug)]
pub struct TlsCerts {
    pub cert_path: PathBuf,
    pub key_path: PathBuf,
    /// SHA-256 fingerprint formatted as colon-separated uppercase hex (e.g. "AB:CD:EF:…")
    pub fingerprint: String,
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

    if !cert_path.exists() || !key_path.exists() || !fp_path.exists() {
        generate_cert(&dir, &cert_path, &key_path, &fp_path)?;
    }

    let fingerprint = std::fs::read_to_string(&fp_path)
        .map_err(|e| format!("Failed to read TLS fingerprint: {e}"))?
        .trim()
        .to_string();

    Ok(TlsCerts {
        cert_path,
        key_path,
        fingerprint,
    })
}

/// Regenerate the TLS certificate (e.g. when the user clicks "Rotate certificate").
pub fn regenerate_cert(app: &AppHandle) -> Result<TlsCerts, String> {
    let dir = tls_dir(app)?;
    let cert_path = dir.join("cert.pem");
    let key_path = dir.join("key.pem");
    let fp_path = dir.join("fingerprint.txt");

    generate_cert(&dir, &cert_path, &key_path, &fp_path)?;

    let fingerprint = std::fs::read_to_string(&fp_path)
        .map_err(|e| format!("Failed to read TLS fingerprint: {e}"))?
        .trim()
        .to_string();

    Ok(TlsCerts {
        cert_path,
        key_path,
        fingerprint,
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
) -> Result<(), String> {
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

    std::fs::write(cert_path, cert.pem())
        .map_err(|e| format!("Failed to write cert.pem: {e}"))?;
    std::fs::write(key_path, key_pair.serialize_pem())
        .map_err(|e| format!("Failed to write key.pem: {e}"))?;
    std::fs::write(fp_path, &fingerprint)
        .map_err(|e| format!("Failed to write fingerprint.txt: {e}"))?;

    tracing::info!(
        fingerprint,
        path = %cert_path.display(),
        "Generated self-signed TLS certificate"
    );
    Ok(())
}
