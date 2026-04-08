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

    // Start local CONNECT proxy (Rust/tokio uses Android's native DNS)
    let proxy_port = crate::proxy::start_proxy()
        .await
        .map_err(|e| format!("Proxy start failed: {}", e))?;
    let proxy_url = format!("http://127.0.0.1:{}", proxy_port);

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
        // Recreate if dangling (target moved after APK reinstall) or missing
        let needs_update = match fs::read_link(&link) {
            Ok(target) => target != src,
            Err(_) => true,
        };
        if needs_update && src.exists() {
            let _ = fs::remove_file(&link);
            let _ = std::os::unix::fs::symlink(&src, &link);
        }
    }
    // Symlink librust_pty.so into the path bun-pty searches automatically.
    // bun-pty looks at: {dataDir}/rust-pty/target/release/librust_pty_arm64.so
    let pty_lib_src = nlib_dir.join("librust_pty.so");
    if pty_lib_src.exists() {
        let pty_dir = dir.join("rust-pty").join("target").join("release");
        let _ = fs::create_dir_all(&pty_dir);
        let pty_link = pty_dir.join("librust_pty_arm64.so");
        let needs_pty_link = match fs::read_link(&pty_link) {
            Ok(target) => target != pty_lib_src,
            Err(_) => true,
        };
        if needs_pty_link {
            let _ = fs::remove_file(&pty_link);
            let _ = std::os::unix::fs::symlink(&pty_lib_src, &pty_link);
        }
        // Also create the non-arm64 name as fallback
        let pty_link2 = pty_dir.join("librust_pty.so");
        let needs_pty_link2 = match fs::read_link(&pty_link2) {
            Ok(target) => target != pty_lib_src,
            Err(_) => true,
        };
        if needs_pty_link2 {
            let _ = fs::remove_file(&pty_link2);
            let _ = std::os::unix::fs::symlink(&pty_lib_src, &pty_link2);
        }
    }

    // Create symlinks for executable binaries so they're found by `which`.
    // Android packages them as lib*.so but tools look for "bash", "rg", etc.
    let bin_link_dir = dir.join("bin");
    let _ = fs::create_dir_all(&bin_link_dir);
    let bin_links = [
        ("libbash_exec.so", "bash"),
        ("libbash_exec.so", "sh"),
        ("librg_exec.so", "rg"),
        ("libbun_exec.so", "bun"),
    ];
    for (src_name, link_name) in &bin_links {
        let src = nlib_dir.join(src_name);
        let link = bin_link_dir.join(link_name);
        let needs = match fs::read_link(&link) {
            Ok(target) => target != src,
            Err(_) => true,
        };
        if needs && src.exists() {
            let _ = fs::remove_file(&link);
            let _ = std::os::unix::fs::symlink(&src, &link);
        }
    }

    // Create resolv.conf with public DNS servers (Android has no /etc/resolv.conf)
    let resolv_path = dir.join("resolv.conf");
    let _ = fs::write(&resolv_path, "nameserver 8.8.8.8\nnameserver 8.8.4.4\nnameserver 1.1.1.1\n");

    // Concatenate Android CA certificates into a single PEM file for TLS.
    // musl-linked Bun/BoringSSL can't find Android's certs at /system/etc/security/cacerts/.
    let ca_bundle_path = dir.join("ca-certificates.crt");
    if !ca_bundle_path.exists() {
        let mut bundle = String::new();
        let cert_dirs = ["/system/etc/security/cacerts", "/system/etc/security/cacerts_google"];
        for cert_dir in &cert_dirs {
            if let Ok(entries) = fs::read_dir(cert_dir) {
                for entry in entries.flatten() {
                    if let Ok(content) = fs::read_to_string(entry.path()) {
                        if content.contains("BEGIN CERTIFICATE") {
                            bundle.push_str(&content);
                            if !content.ends_with('\n') {
                                bundle.push('\n');
                            }
                        }
                    }
                }
            }
        }
        if !bundle.is_empty() {
            let _ = fs::write(&ca_bundle_path, &bundle);
            eprintln!("[OpenCode] Created CA bundle with {} bytes", bundle.len());
        } else {
            eprintln!("[OpenCode] WARNING: No CA certificates found on device");
        }
    }

    // Library search path: lib_links (for symlinked names) + nlib_dir
    let lib_path = format!("{}:{}", lib_link_dir.display(), nlib_dir.display());

    // Build PATH with bin links and nativeLibraryDir first
    let sys_path = std::env::var("PATH").unwrap_or_default();
    let path = format!("{}:{}:{}", bin_link_dir.display(), nlib_dir.display(), sys_path);

    // On Android, bun is linked against musl. We invoke it via the musl dynamic
    // linker shipped alongside (also in nativeLibraryDir for exec permission).
    // Write env vars to a file — musl linker doesn't pass Command::env() to bun.
    // mobile-entry.ts reads this file and applies env vars at startup.
    let env_file = dir.join(".env_vars");
    let env_content = format!(
        "HOME={home}\nSSL_CERT_FILE={cert}\nNODE_EXTRA_CA_CERTS={cert}\nRESOLV_CONF={resolv}\nSHELL={shell}\nBUN_PTY_LIB={pty}\nOPENCODE_SERVER_USERNAME=opencode\nOPENCODE_SERVER_PASSWORD={pw}\nOPENCODE_CLIENT=mobile-embedded\nOPENCODE_DISABLE_LSP_DOWNLOAD=false\nXDG_DATA_HOME={xdg_data}\nXDG_STATE_HOME={xdg_state}\nXDG_CACHE_HOME={xdg_cache}\nXDG_CONFIG_HOME={xdg_config}\nPATH={path_val}\nLD_LIBRARY_PATH={lib_path_val}\nHTTP_PROXY={proxy}\nHTTPS_PROXY={proxy}\nhttp_proxy={proxy}\nhttps_proxy={proxy}\n",
        home = home_dir.display(),
        cert = ca_bundle_path.display(),
        resolv = resolv_path.display(),
        shell = bin_link_dir.join("bash").display(),
        pty = nlib_dir.join("librust_pty.so").display(),
        pw = password,
        xdg_data = home_dir.join(".local/share").display(),
        xdg_state = home_dir.join(".local/state").display(),
        xdg_cache = home_dir.join(".cache").display(),
        xdg_config = home_dir.join(".config").display(),
        path_val = path,
        lib_path_val = lib_path,
        proxy = proxy_url,
    );
    // Also add NO_PROXY for local connections
    let env_content = format!("{}NO_PROXY=127.0.0.1,localhost\nno_proxy=127.0.0.1,localhost\n", env_content);
    let _ = fs::write(&env_file, &env_content);

    // Build command: use --preload to load resolv_override.so via CLI arg
    // (bypasses env var transmission issue with musl linker)
    let resolv_override = nlib_dir.join("libresolv_override.so");

    let (cmd_path, cmd_args) = if ld_musl.exists() {
        let mut args = vec![
            "--library-path".to_string(),
            lib_path.clone(),
        ];
        // --preload passes LD_PRELOAD via CLI instead of env var
        if resolv_override.exists() {
            args.push("--preload".to_string());
            args.push(resolv_override.to_string_lossy().to_string());
        }
        args.extend([
            bun_path.to_string_lossy().to_string(),
            cli_path.to_string_lossy().to_string(),
            "serve".to_string(),
            "--hostname".to_string(),
            "127.0.0.1".to_string(),
            "--port".to_string(),
            port.to_string(),
            "--print-logs".to_string(),
        ]);
        (ld_musl, args)
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
                "--print-logs".to_string(),
            ],
        )
    };

    let resolv_override_path = nlib_dir.join("libresolv_override.so");
    eprintln!("[OpenCode] Spawning: {} {:?}", cmd_path.display(), cmd_args);
    eprintln!("[OpenCode] LD_LIBRARY_PATH={}", lib_path);
    eprintln!("[OpenCode] LD_PRELOAD={} (exists={})", resolv_override_path.display(), resolv_override_path.exists());
    eprintln!("[OpenCode] SSL_CERT_FILE={} (exists={})", ca_bundle_path.display(), ca_bundle_path.exists());

    // Log files for post-mortem analysis + stderr piped through a thread to logcat
    let log_dir = dir.join("logs");
    let _ = fs::create_dir_all(&log_dir);
    let stdout_file = fs::File::create(log_dir.join("server_stdout.log"))
        .map_err(|e| format!("Create stdout log: {}", e))?;

    let mut child = Command::new(&cmd_path)
        .args(&cmd_args)
        .env("PATH", &path)
        .env("LD_LIBRARY_PATH", &lib_path)
        .env("HOME", home_dir.to_str().unwrap_or("/tmp"))
        .env("OPENCODE_SERVER_USERNAME", "opencode")
        .env("OPENCODE_SERVER_PASSWORD", &password)
        .env("OPENCODE_CLIENT", "mobile-embedded")
        .env("OPENCODE_DISABLE_LSP_DOWNLOAD", "false")
        .env("BUN_PTY_LIB", nlib_dir.join("librust_pty.so").to_str().unwrap_or(""))
        .env("SHELL", bin_link_dir.join("bash").to_str().unwrap_or("/bin/sh"))
        .env("SSL_CERT_FILE", ca_bundle_path.to_str().unwrap_or(""))
        .env("NODE_EXTRA_CA_CERTS", ca_bundle_path.to_str().unwrap_or(""))
        .env("RESOLV_CONF", resolv_path.to_str().unwrap_or(""))
        .env("LD_PRELOAD", nlib_dir.join("libresolv_override.so").to_str().unwrap_or(""))
        .env("XDG_DATA_HOME", home_dir.join(".local/share").to_str().unwrap_or(""))
        .env("XDG_STATE_HOME", home_dir.join(".local/state").to_str().unwrap_or(""))
        .env("XDG_CACHE_HOME", home_dir.join(".cache").to_str().unwrap_or(""))
        .env("XDG_CONFIG_HOME", home_dir.join(".config").to_str().unwrap_or(""))
        .stdout(stdout_file)
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn server: {}", e))?;

    // Stream stderr to logcat + file in a background thread
    if let Some(stderr_pipe) = child.stderr.take() {
        let log_file_path = log_dir.join("server_stderr.log");
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader, Write};
            let reader = BufReader::new(stderr_pipe);
            let mut file = fs::File::create(&log_file_path).ok();
            for line in reader.lines() {
                if let Ok(line) = line {
                    eprintln!("[bun] {}", line);
                    if let Some(ref mut f) = file {
                        let _ = writeln!(f, "{}", line);
                    }
                }
            }
        });
    }

    eprintln!("[OpenCode] Server spawned with pid {:?}", child.id());

    // Check if process exited immediately (crash)
    std::thread::sleep(Duration::from_millis(500));
    match child.try_wait() {
        Ok(Some(status)) => {
            std::thread::sleep(Duration::from_millis(500)); // let stderr thread flush
            let stderr = fs::read_to_string(log_dir.join("server_stderr.log")).unwrap_or_default();
            eprintln!("[OpenCode] Server exited immediately with status: {}", status);
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

/// Read the last N lines of the server stderr log (for debugging).
#[tauri::command]
pub async fn read_server_logs(app: AppHandle, lines: Option<usize>) -> String {
    let dir = runtime_dir(&app);
    let log_path = dir.join("logs").join("server_stderr.log");
    match fs::read_to_string(&log_path) {
        Ok(content) => {
            let n = lines.unwrap_or(100);
            let all_lines: Vec<&str> = content.lines().collect();
            let start = if all_lines.len() > n { all_lines.len() - n } else { 0 };
            all_lines[start..].join("\n")
        }
        Err(e) => format!("Error reading log: {}", e),
    }
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

    let nlib_dir = native_lib_dir(&dir)
        .ok_or_else(|| "nativeLibraryDir not found".to_string())?;
    let lib_link_dir = dir.join("lib_links");
    let bin_link_dir = dir.join("bin");
    let _ = fs::create_dir_all(&bin_link_dir);

    let _ = app.emit(
        "extraction-progress",
        ExtractionProgress {
            phase: "Downloading Alpine Linux rootfs...".to_string(),
            progress: 0.1,
        },
    );

    // Download proot static binary
    let proot_url = "https://proot.gitlab.io/proot/bin/proot-aarch64-static";
    let proot_path = bin_link_dir.join("proot");

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

    // Extract rootfs — try system tar, then busybox
    fs::create_dir_all(&rootfs_dir).map_err(|e| format!("mkdir rootfs: {}", e))?;

    let tar_bin = if Path::new("/system/bin/tar").exists() {
        "/system/bin/tar"
    } else {
        "tar"
    };

    let output = Command::new(tar_bin)
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
    let wrapper = format!(
        r#"#!/bin/sh
export LD_LIBRARY_PATH="{lib_links}:{nlib}"
exec {proot} \
  --rootfs={rootfs} \
  --bind={bin}:/usr/local/bin \
  --bind={nlib}:/usr/local/lib \
  --bind=/dev:/dev \
  --bind=/proc:/proc \
  --bind=/sys:/sys \
  -w /root \
  "$@"
"#,
        proot = proot_path.display(),
        rootfs = rootfs_dir.display(),
        bin = bin_link_dir.display(),
        nlib = nlib_dir.display(),
        lib_links = lib_link_dir.display(),
    );

    let wrapper_path = bin_link_dir.join("proot-run");
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

pub(crate) fn runtime_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .data_dir()
        .unwrap_or_else(|_| PathBuf::from("/data/data/ai.opencode.mobile/files"))
        .join(RUNTIME_SUBDIR)
}

/// Read the nativeLibraryDir path written by Kotlin at startup.
pub(crate) fn native_lib_dir(runtime_dir: &Path) -> Option<PathBuf> {
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
