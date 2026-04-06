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

    // Log debug info
    if let Some(nlib) = native_lib_dir(&dir) {
        eprintln!("[OpenCode] nativeLibDir={}, bun_exists={}, cli_exists={}",
            nlib.display(), nlib.join("libbun_exec.so").exists(), dir.join("opencode-cli.js").exists());
    } else {
        eprintln!("[OpenCode] nativeLibDir not found, cli_exists={}", dir.join("opencode-cli.js").exists());
    }

    RuntimeInfo {
        ready,
        server_running,
        port,
        extended_env,
    }
}

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

/// Start the embedded OpenCode server.
/// Spawns bun with the bundled CLI and stores the child process handle.
/// On Android, executables are in nativeLibraryDir (packaged as JNI libs)
/// to satisfy SELinux execute permissions.
#[tauri::command]
pub async fn start_embedded_server(
    app: AppHandle,
    port: u32,
    password: String,
) -> Result<(), String> {
    let dir = runtime_dir(&app);
    let home_dir = dir.join("home");
    let cli_path = dir.join("opencode-cli.js");

    // Get nativeLibraryDir where Android installs JNI libs (with exec permission)
    let nlib_dir = native_lib_dir(&dir)
        .ok_or_else(|| "nativeLibraryDir not found. Restart the app.".to_string())?;

    let bun_path = nlib_dir.join("libbun_exec.so");
    let ld_musl = nlib_dir.join("libmusl_linker.so");

    if !bun_path.exists() {
        return Err(format!("bun not found at {}", bun_path.display()));
    }

    if !cli_path.exists() {
        return Err("opencode-cli.js not found.".to_string());
    }

    // Ensure home directory exists
    let _ = fs::create_dir_all(&home_dir);
    let _ = fs::create_dir_all(home_dir.join(".opencode"));

    // Kill any existing server
    if let Ok(mut guard) = SERVER_PROCESS.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
        }
    }

    // Create symlinks for shared libs that bun expects with their original names.
    // Android JNI requires lib*.so naming, but bun looks for libstdc++.so.6 etc.
    let lib_link_dir = dir.join("lib_links");
    let _ = fs::create_dir_all(&lib_link_dir);
    let links = [
        ("libstdcpp_compat.so", "libstdc++.so.6"),
        ("libgcc_compat.so", "libgcc_s.so.1"),
    ];
    for (src_name, link_name) in &links {
        let src = nlib_dir.join(src_name);
        let link = lib_link_dir.join(link_name);
        if src.exists() && !link.exists() {
            let _ = std::os::unix::fs::symlink(&src, &link);
        }
    }
    // Library search path: lib_links (for symlinked names) + nlib_dir
    let lib_path = format!("{}:{}", lib_link_dir.display(), nlib_dir.display());

    // Build PATH with nativeLibraryDir first
    let sys_path = std::env::var("PATH").unwrap_or_default();
    let path = format!("{}:{}", nlib_dir.display(), sys_path);

    // On Android, bun is linked against musl. We invoke it via the musl dynamic
    // linker shipped alongside (also in nativeLibraryDir for exec permission).
    let (cmd_path, cmd_args) = if ld_musl.exists() {
        (
            ld_musl,
            vec![
                "--library-path".to_string(),
                lib_path.clone(),
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

    eprintln!("[OpenCode] Spawning: {} {:?}", cmd_path.display(), cmd_args);
    eprintln!("[OpenCode] LD_LIBRARY_PATH={}", lib_path);

    // Use log files instead of piped stdout/stderr to avoid blocking on full pipe buffer
    let log_dir = dir.join("logs");
    let _ = fs::create_dir_all(&log_dir);
    let stdout_file = fs::File::create(log_dir.join("server_stdout.log"))
        .map_err(|e| format!("Create stdout log: {}", e))?;
    let stderr_file = fs::File::create(log_dir.join("server_stderr.log"))
        .map_err(|e| format!("Create stderr log: {}", e))?;

    let mut child = Command::new(&cmd_path)
        .args(&cmd_args)
        .env("PATH", &path)
        .env("LD_LIBRARY_PATH", &lib_path)
        .env("HOME", home_dir.to_str().unwrap_or("/tmp"))
        .env("OPENCODE_SERVER_USERNAME", "opencode")
        .env("OPENCODE_SERVER_PASSWORD", &password)
        .env("OPENCODE_CLIENT", "mobile-embedded")
        .env("OPENCODE_DISABLE_LSP_DOWNLOAD", "false")
        .env("XDG_DATA_HOME", home_dir.join(".local/share").to_str().unwrap_or(""))
        .env("XDG_STATE_HOME", home_dir.join(".local/state").to_str().unwrap_or(""))
        .env("XDG_CACHE_HOME", home_dir.join(".cache").to_str().unwrap_or(""))
        .env("XDG_CONFIG_HOME", home_dir.join(".config").to_str().unwrap_or(""))
        .stdout(stdout_file)
        .stderr(stderr_file)
        .spawn()
        .map_err(|e| format!("Failed to spawn server: {}", e))?;

    eprintln!("[OpenCode] Server spawned with pid {:?}", child.id());

    // Check if process exited immediately (crash)
    std::thread::sleep(Duration::from_millis(500));
    match child.try_wait() {
        Ok(Some(status)) => {
            let stderr = fs::read_to_string(log_dir.join("server_stderr.log")).unwrap_or_default();
            let stdout = fs::read_to_string(log_dir.join("server_stdout.log")).unwrap_or_default();
            eprintln!("[OpenCode] Server exited immediately with status: {}", status);
            eprintln!("[OpenCode] stderr: {}", &stderr[..stderr.len().min(2000)]);
            eprintln!("[OpenCode] stdout: {}", &stdout[..stdout.len().min(500)]);
            return Err(format!("Server crashed ({}): {}", status, &stderr[..stderr.len().min(500)]));
        }
        Ok(None) => {
            eprintln!("[OpenCode] Server still running after 500ms — good");
        }
        Err(e) => {
            eprintln!("[OpenCode] Error checking server status: {}", e);
        }
    }

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

fn check_extraction_progress(dir: &Path) -> f32 {
    // Only non-executable assets need extraction now
    let checks = [
        dir.join("opencode-cli.js"),
        dir.join(".native_lib_dir"),
    ];
    let done = checks.iter().filter(|p| p.exists()).count();
    done as f32 / checks.len() as f32
}

fn runtime_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .data_dir()
        .unwrap_or_else(|_| PathBuf::from("/data/data/ai.opencode.mobile/files"))
        .join(RUNTIME_SUBDIR)
}

/// Read the nativeLibraryDir path written by Kotlin at startup.
fn native_lib_dir(runtime_dir: &Path) -> Option<PathBuf> {
    let path_file = runtime_dir.join(".native_lib_dir");
    fs::read_to_string(&path_file).ok().map(|s| PathBuf::from(s.trim()))
}

fn is_runtime_ready(dir: &Path) -> bool {
    // Executables are in nativeLibraryDir (JNI libs), we just need the JS bundle
    dir.join("opencode-cli.js").exists()
        && dir.join(".native_lib_dir").exists()
        && native_lib_dir(dir)
            .map(|d| d.join("libbun_exec.so").exists())
            .unwrap_or(false)
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
