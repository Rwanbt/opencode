//! Runtime extraction + readiness/schema gating (extracted from `runtime.rs` — D-01 step 3).
//!
//! The `extract_runtime` Tauri command plus the file-presence and
//! schema-version predicates that decide whether the embedded Alpine runtime
//! is ready. Shared path helpers (`runtime_dir`, `native_lib_dir`), the
//! `RUNTIME_*` consts, and the `ExtractionProgress` event payload stay in
//! `runtime.rs` and are reached through `use super::*`.
//!
//! `extract_runtime` stays `pub` (re-exported as `runtime::extract_runtime`
//! for the Tauri handler); `is_runtime_ready` / `is_ready_without_schema_check`
//! are `pub(super)` so `check_runtime` and `mod tests` can still reach them.
use super::*;

/// Extract runtime binaries from APK assets to the app's private directory.
/// On Android, the extraction is initiated by the Kotlin RuntimeExtractor (called from
/// MainActivity.onCreate). This command polls until extraction is complete or times out.
/// Emits "extraction-progress" events so the frontend can show a progress bar.
#[tauri::command]
pub async fn extract_runtime(app: AppHandle) -> Result<(), String> {
    let dir = runtime_dir(&app);

    // If already extracted, return immediately
    if is_runtime_ready(&dir) {
        let _ = app.emit(
            "extraction-progress",
            ExtractionProgress {
                phase: "Ready!".to_string(),
                progress: 1.0,
            },
        );
        return Ok(());
    }

    let _ = app.emit(
        "extraction-progress",
        ExtractionProgress {
            phase: "Extracting runtime binaries...".to_string(),
            progress: 0.1,
        },
    );

    // On Android, MainActivity.onCreate starts the extraction in a background thread
    // via RuntimeExtractor.extractAll(). We poll until it's done.
    let max_wait = Duration::from_secs(120); // 2 minutes max
    let poll_interval = Duration::from_millis(500);
    let start = std::time::Instant::now();

    loop {
        if is_ready_without_schema_check(&dir) {
            // Write the schema version sentinel so future launches skip re-extraction
            write_schema_version(&dir);
            let _ = app.emit(
                "extraction-progress",
                ExtractionProgress {
                    phase: "Ready!".to_string(),
                    progress: 1.0,
                },
            );
            return Ok(());
        }

        if start.elapsed() > max_wait {
            return Err("Extraction timed out after 120s. Restart the app to retry.".to_string());
        }

        // Emit progress based on which files exist
        let progress = check_extraction_progress(&dir);
        let _ = app.emit(
            "extraction-progress",
            ExtractionProgress {
                phase: format!("Extracting... ({:.0}%)", progress * 100.0),
                progress,
            },
        );

        tokio::time::sleep(poll_interval).await;
    }
}

fn check_extraction_progress(dir: &Path) -> f32 {
    // Only non-executable assets need extraction now
    let checks = [
        dir.join("opencode-cli.js"),
        dir.join(".native_lib_dir"),
    ];
    let done = checks.iter().filter(|p| p.exists()).count();
    done as f32 / checks.len() as f32
}

/// Check if the runtime binaries are present, ignoring schema version.
/// Used during the extraction polling loop before write_schema_version is called.
pub(super) fn is_ready_without_schema_check(dir: &Path) -> bool {
    dir.join("opencode-cli.js").exists()
        && dir.join(".native_lib_dir").exists()
        && native_lib_dir(dir).map(|d| d.join("libbun_exec.so").exists()).unwrap_or(false)
}

pub(super) fn is_runtime_ready(dir: &Path) -> bool {
    // Executables are in nativeLibraryDir (JNI libs), we just need the JS bundle
    if !dir.join("opencode-cli.js").exists()
        || !dir.join(".native_lib_dir").exists()
        || !native_lib_dir(dir).map(|d| d.join("libbun_exec.so").exists()).unwrap_or(false)
    {
        return false;
    }
    // Schema version guard: if version file is missing or stale, wipe rootfs
    // (not models) and force re-extraction. This prevents silent corruption
    // after an APK update that ships a new Alpine rootfs layout.
    let version_file = dir.join(".schema_version");
    let current = fs::read_to_string(&version_file)
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())
        .unwrap_or(0);
    if current != RUNTIME_SCHEMA_VERSION {
        log::warn!(
            "[runtime] schema version mismatch (have={} want={}), wiping rootfs",
            current,
            RUNTIME_SCHEMA_VERSION
        );
        let rootfs = dir.join("rootfs");
        if rootfs.exists() {
            if let Err(e) = fs::remove_dir_all(&rootfs) {
                log::warn!("[runtime] failed to wipe rootfs: {}", e);
            }
        }
        // Remove version file so next ready-check re-triggers extraction
        let _ = fs::remove_file(&version_file);
        return false;
    }
    true
}

/// Write the current schema version sentinel after a successful extraction.
pub fn write_schema_version(dir: &Path) {
    let path = dir.join(".schema_version");
    if let Err(e) = fs::write(&path, RUNTIME_SCHEMA_VERSION.to_string()) {
        log::warn!("[runtime] failed to write schema version: {}", e);
    }
}
