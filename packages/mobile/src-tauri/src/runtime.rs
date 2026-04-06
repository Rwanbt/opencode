use serde::{Deserialize, Serialize};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const DEFAULT_PORT: u32 = 14096;
const HEALTH_CHECK_TIMEOUT: Duration = Duration::from_secs(2);
const RUNTIME_SUBDIR: &str = "runtime";

/// Static storage for the server child process.
static SERVER_PROCESS: Mutex<Option<Child>> = Mutex::new(None);

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct RuntimeInfo {
    pub ready: bool,
    pub server_running: bool,
    pub port: u32,
    pub extended_env: bool,
}

#[derive(Clone, Serialize, Debug)]
struct ExtractionProgress {
    phase: String,
    progress: f32,
}

// ─── Tauri Commands ─────────────────────────────────────────────────

/// Check if the embedded runtime is extracted and if the server is running.
#[tauri::command]
pub async fn check_runtime(app: AppHandle) -> RuntimeInfo {
    let dir = runtime_dir(&app);
    let ready = is_runtime_ready(&dir);
    let port = DEFAULT_PORT;
    let server_running = if ready {
        check_health(port, None).await
    } else {
        false
    };
    let extended_env = dir.join("rootfs").exists();

    RuntimeInfo {
        ready,
        server_running,
        port,
        extended_env,
    }
}

/// Extract runtime binaries from APK assets to the app's private directory.
/// Emits "extraction-progress" events so the frontend can show a progress bar.
#[tauri::command]
pub async fn extract_runtime(app: AppHandle) -> Result<(), String> {
    let dir = runtime_dir(&app);
    let bin_dir = dir.join("bin");
    let lib_dir = dir.join("lib");
    let home_dir = dir.join("home");

    fs::create_dir_all(&bin_dir).map_err(|e| format!("mkdir bin: {}", e))?;
    fs::create_dir_all(&lib_dir).map_err(|e| format!("mkdir lib: {}", e))?;
    fs::create_dir_all(&home_dir).map_err(|e| format!("mkdir home: {}", e))?;
    fs::create_dir_all(home_dir.join(".opencode")).map_err(|e| format!("mkdir .opencode: {}", e))?;

    // The runtime assets are embedded in the APK under assets/runtime/
    // Tauri resolves them via the resource directory on Android.
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir: {}", e))?;

    let assets_runtime = resource_dir.join("assets").join("runtime");

    // If assets dir doesn't exist, try the app data directory (dev mode)
    let src_dir = if assets_runtime.exists() {
        assets_runtime
    } else {
        // Fallback: check if binaries are already at the target
        if is_runtime_ready(&dir) {
            return Ok(());
        }
        return Err("Runtime assets not found in APK. Run prepare-android-runtime.sh first.".to_string());
    };

    let binaries = ["bun", "git", "bash", "rg"];
    let total_steps = binaries.len() + 1; // +1 for opencode-cli.js

    for (i, name) in binaries.iter().enumerate() {
        let src = src_dir.join("bin").join(name);
        let dst = bin_dir.join(name);

        let _ = app.emit(
            "extraction-progress",
            ExtractionProgress {
                phase: format!("Extracting {}...", name),
                progress: i as f32 / total_steps as f32,
            },
        );

        if src.exists() {
            fs::copy(&src, &dst).map_err(|e| format!("copy {}: {}", name, e))?;
            // Set executable permission
            let mut perms = fs::metadata(&dst)
                .map_err(|e| format!("metadata {}: {}", name, e))?
                .permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&dst, perms)
                .map_err(|e| format!("chmod {}: {}", name, e))?;
        }
    }

    // Copy musl dynamic linker (required to run bun on Android)
    let musl_src = src_dir.join("lib").join("ld-musl-aarch64.so.1");
    let musl_dst = lib_dir.join("ld-musl-aarch64.so.1");
    if musl_src.exists() {
        fs::copy(&musl_src, &musl_dst).map_err(|e| format!("copy musl: {}", e))?;
        let mut perms = fs::metadata(&musl_dst)
            .map_err(|e| format!("metadata musl: {}", e))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&musl_dst, perms)
            .map_err(|e| format!("chmod musl: {}", e))?;
    }

    // Copy opencode-cli.js
    let _ = app.emit(
        "extraction-progress",
        ExtractionProgress {
            phase: "Preparing CLI...".to_string(),
            progress: binaries.len() as f32 / total_steps as f32,
        },
    );

    let cli_src = src_dir.join("opencode-cli.js");
    let cli_dst = dir.join("opencode-cli.js");
    if cli_src.exists() {
        fs::copy(&cli_src, &cli_dst).map_err(|e| format!("copy cli: {}", e))?;
    }

    let _ = app.emit(
        "extraction-progress",
        ExtractionProgress {
            phase: "Ready!".to_string(),
            progress: 1.0,
        },
    );

    Ok(())
}

/// Start the embedded OpenCode server.
/// Spawns bun with the bundled CLI and stores the child process handle.
#[tauri::command]
pub async fn start_embedded_server(
    app: AppHandle,
    port: u32,
    password: String,
) -> Result<(), String> {
    let dir = runtime_dir(&app);
    let bin_dir = dir.join("bin");
    let home_dir = dir.join("home");
    let bun_path = bin_dir.join("bun");
    let cli_path = dir.join("opencode-cli.js");

    if !bun_path.exists() {
        return Err("Runtime not extracted. Call extract_runtime first.".to_string());
    }

    if !cli_path.exists() {
        return Err("opencode-cli.js not found.".to_string());
    }

    // Kill any existing server
    if let Ok(mut guard) = SERVER_PROCESS.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
        }
    }

    // Build PATH with our bin directory first, then system PATH
    let sys_path = std::env::var("PATH").unwrap_or_default();
    let path = format!("{}:{}", bin_dir.display(), sys_path);

    // On Android, bun is linked against musl. We invoke it via the musl dynamic
    // linker shipped alongside: ld-musl-aarch64.so.1 ./bun opencode-cli.js serve
    let ld_musl = dir.join("lib").join("ld-musl-aarch64.so.1");
    let (cmd_path, cmd_args) = if ld_musl.exists() {
        // Use musl linker to run bun (Android doesn't have /lib/ld-musl-aarch64.so.1)
        (
            ld_musl,
            vec![
                bun_path.to_string_lossy().to_string(),
                cli_path.to_string_lossy().to_string(),
                "serve".to_string(),
                "--hostname".to_string(),
                "127.0.0.1".to_string(),
                "--port".to_string(),
                port.to_string(),
            ],
        )
    } else {
        // Fallback: direct execution (works if bun is statically linked or on desktop)
        (
            bun_path.clone(),
            vec![
                cli_path.to_string_lossy().to_string(),
                "serve".to_string(),
                "--hostname".to_string(),
                "127.0.0.1".to_string(),
                "--port".to_string(),
                port.to_string(),
            ],
        )
    };

    let child = Command::new(&cmd_path)
        .args(&cmd_args)
        .env("PATH", &path)
        .env("HOME", home_dir.to_str().unwrap_or("/tmp"))
        .env("OPENCODE_SERVER_USERNAME", "opencode")
        .env("OPENCODE_SERVER_PASSWORD", &password)
        .env("OPENCODE_CLIENT", "mobile-embedded")
        .env("OPENCODE_DISABLE_LSP_DOWNLOAD", "false")
        .env("XDG_DATA_HOME", home_dir.join(".local/share").to_str().unwrap_or(""))
        .env("XDG_STATE_HOME", home_dir.join(".local/state").to_str().unwrap_or(""))
        .env("XDG_CACHE_HOME", home_dir.join(".cache").to_str().unwrap_or(""))
        .env("XDG_CONFIG_HOME", home_dir.join(".config").to_str().unwrap_or(""))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn server: {}", e))?;

    if let Ok(mut guard) = SERVER_PROCESS.lock() {
        *guard = Some(child);
    }

    Ok(())
}

/// Check if the local server is healthy via HTTP.
#[tauri::command]
pub async fn check_local_health(port: u32, password: Option<String>) -> bool {
    check_health(port, password.as_deref()).await
}

/// Stop the embedded server. Tries graceful shutdown first, then kills the process.
#[tauri::command]
pub async fn stop_local_server(port: u32, password: Option<String>) -> Result<(), String> {
    // Try graceful shutdown via HTTP
    let url = format!("http://127.0.0.1:{}/instance/dispose", port);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .no_proxy()
        .build()
        .ok();

    if let Some(client) = client {
        let mut req = client.post(&url);
        if let Some(ref pw) = password {
            req = req.basic_auth("opencode", Some(pw));
        }
        let _ = req.send().await;
    }

    // Kill the stored process
    if let Ok(mut guard) = SERVER_PROCESS.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
        }
    }

    Ok(())
}

/// Download and install the extended environment (proot + Alpine rootfs).
/// This enables `apt install` for additional packages.
#[tauri::command]
pub async fn install_extended_env(app: AppHandle) -> Result<(), String> {
    let dir = runtime_dir(&app);
    let rootfs_dir = dir.join("rootfs");

    if rootfs_dir.exists() {
        return Ok(()); // Already installed
    }

    let _ = app.emit(
        "extraction-progress",
        ExtractionProgress {
            phase: "Downloading Alpine Linux rootfs...".to_string(),
            progress: 0.1,
        },
    );

    // Download proot static binary
    let proot_url = "https://proot.gitlab.io/proot/bin/proot-aarch64-static";
    let proot_path = dir.join("bin").join("proot");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("HTTP client: {}", e))?;

    let proot_bytes = client
        .get(proot_url)
        .send()
        .await
        .map_err(|e| format!("Download proot: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("Read proot: {}", e))?;

    fs::write(&proot_path, &proot_bytes).map_err(|e| format!("Write proot: {}", e))?;
    let mut perms = fs::metadata(&proot_path)
        .map_err(|e| format!("metadata: {}", e))?
        .permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&proot_path, perms).map_err(|e| format!("chmod: {}", e))?;

    let _ = app.emit(
        "extraction-progress",
        ExtractionProgress {
            phase: "Downloading Alpine rootfs...".to_string(),
            progress: 0.4,
        },
    );

    // Download Alpine minirootfs
    let alpine_url =
        "https://dl-cdn.alpinelinux.org/alpine/v3.21/releases/aarch64/alpine-minirootfs-3.21.3-aarch64.tar.gz";
    let alpine_path = dir.join("alpine-rootfs.tar.gz");

    let alpine_bytes = client
        .get(alpine_url)
        .send()
        .await
        .map_err(|e| format!("Download Alpine: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("Read Alpine: {}", e))?;

    fs::write(&alpine_path, &alpine_bytes).map_err(|e| format!("Write Alpine: {}", e))?;

    let _ = app.emit(
        "extraction-progress",
        ExtractionProgress {
            phase: "Extracting rootfs...".to_string(),
            progress: 0.7,
        },
    );

    // Extract rootfs
    fs::create_dir_all(&rootfs_dir).map_err(|e| format!("mkdir rootfs: {}", e))?;

    let output = Command::new("tar")
        .args(["-xzf", alpine_path.to_str().unwrap_or("")])
        .current_dir(&rootfs_dir)
        .output()
        .map_err(|e| format!("Extract rootfs: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "tar failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    fs::remove_file(&alpine_path).ok();

    // Create proot-run wrapper script
    let bin_dir = dir.join("bin");
    let wrapper = format!(
        r#"#!/bin/sh
exec {proot} \
  --rootfs={rootfs} \
  --bind={bin}/bun:/usr/local/bin/bun \
  --bind={bin}/git:/usr/local/bin/git \
  --bind={bin}/rg:/usr/local/bin/rg \
  --bind=/dev:/dev \
  --bind=/proc:/proc \
  --bind=/sys:/sys \
  -w /root \
  "$@"
"#,
        proot = proot_path.display(),
        rootfs = rootfs_dir.display(),
        bin = bin_dir.display(),
    );

    let wrapper_path = bin_dir.join("proot-run");
    fs::write(&wrapper_path, wrapper).map_err(|e| format!("Write wrapper: {}", e))?;
    let mut perms = fs::metadata(&wrapper_path)
        .map_err(|e| format!("metadata: {}", e))?
        .permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&wrapper_path, perms).map_err(|e| format!("chmod: {}", e))?;

    let _ = app.emit(
        "extraction-progress",
        ExtractionProgress {
            phase: "Extended environment ready!".to_string(),
            progress: 1.0,
        },
    );

    Ok(())
}

// ─── Internal ───────────────────────────────────────────────────────

fn runtime_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .data_dir()
        .unwrap_or_else(|_| PathBuf::from("/data/data/ai.opencode.mobile/files"))
        .join(RUNTIME_SUBDIR)
}

fn is_runtime_ready(dir: &Path) -> bool {
    dir.join("bin").join("bun").exists()
        && dir.join("opencode-cli.js").exists()
        && dir.join("lib").join("ld-musl-aarch64.so.1").exists()
}

async fn check_health(port: u32, password: Option<&str>) -> bool {
    let url = format!("http://127.0.0.1:{}/global/health", port);
    let client = match reqwest::Client::builder()
        .timeout(HEALTH_CHECK_TIMEOUT)
        .no_proxy()
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    let mut req = client.get(&url);
    if let Some(pw) = password {
        req = req.basic_auth("opencode", Some(pw));
    }

    match req.send().await {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}
