//! Embedded OpenCode server lifecycle (extracted from `runtime.rs` — D-01 step 2).
//!
//! Owns the server child process and its single-flight start gate, plus the
//! Tauri commands that start/stop/health-check/read-logs the bun sidecar. The
//! shared helpers it relies on (`runtime_dir`, `native_lib_dir`, `force_symlink`,
//! `prepare_toolchain_wrappers`, `check_health`) stay in `runtime.rs` and are
//! reached through `use super::*`.
//!
//! NOTE: `clippy::needless_borrows_for_generic_args` is disabled here because it
//! ICEs (rustc/clippy bug, "slice index starts at 27 but ends at 26", reproduced
//! on stable 1.94.1 and nightly) while computing its suggestion span over this
//! module under `cfg(test)`. rustc `-D warnings` is clean; all other clippy lints
//! still run. Remove once the upstream clippy bug is fixed.
#![allow(clippy::needless_borrows_for_generic_args)]
use super::*;

/// Static storage for the server child process.
static SERVER_PROCESS: Mutex<Option<Child>> = Mutex::new(None);

/// DEBT: D-18 — single-flight gate for `start_embedded_server`. Without it, two
/// rapid concurrent starts can both spawn a server and orphan one (the static
/// only tracks the last `Child`). Serializing starts guarantees each call kills
/// the previously-tracked child before spawning, so exactly one server lives.
static SERVER_START_LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();

fn server_start_lock() -> &'static tokio::sync::Mutex<()> {
    SERVER_START_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
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
    // DEBT: D-18 — serialize concurrent starts. Held across the whole spawn so a
    // second caller can't race past the "kill existing server" step below and
    // leave an orphaned process untracked by SERVER_PROCESS.
    let _start_guard = server_start_lock().lock().await;

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

    // App-private tmp dir for Node/Bun's os.tmpdir(). Android's rootfs `/` is
    // read-only for sandboxed apps, so any module calling mkdirSync(os.tmpdir()
    // + '/…') hits EROFS. Exporting TMPDIR (+ TMP/TEMP for cross-platform
    // libs) redirects every tmpdir consumer into the app's writable cache.
    let app_tmp_dir = home_dir.join(".cache").join("tmp");
    let _ = fs::create_dir_all(&app_tmp_dir);

    // External-storage symlinks live under $HOME/storage/ and are set up by
    // MainActivity.setupStorageSymlinks() in Java via Os.symlink(). Doing it
    // Java-side ensures the process FUSE mount namespace is the one resolving
    // the targets, which matters once MANAGE_EXTERNAL_STORAGE is granted.

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
    setup_compat_lib_symlinks(&nlib_dir, &dir, &lib_link_dir);

    // Create symlinks for executable binaries so they're found by `which`.
    // Android packages them as lib*.so but tools look for "bash", "rg", etc.
    let bin_link_dir = dir.join("bin");
    let _ = fs::create_dir_all(&bin_link_dir);
    // Symlink Android JNI binaries + toybox/busybox/system applets into bin/.
    setup_command_symlinks(&nlib_dir, &bin_link_dir);

    // Create shell init file (.mkshrc) for /system/bin/sh (mksh).
    // Sourced via ENV variable (set in .env_vars, passed to PTY spawn env).
    // Keep it minimal — TERM, PATH, HOME are already set via PTY env vars.
    // Do NOT re-export ENV here (causes infinite source loop in mksh).
    let mkshrc_path = home_dir.join(".mkshrc");

    let tool_fns = build_tool_functions(&dir, &nlib_dir);

    write_shell_rc_files(&home_dir, &mkshrc_path, &tool_fns);

    let (resolv_path, ca_bundle_path) = setup_dns_and_ca(&dir);
    let rootfs_dir = dir.join("rootfs");

    // Library search path: lib_links (for symlinked names) + nlib_dir
    let lib_path = format!("{}:{}", lib_link_dir.display(), nlib_dir.display());

    // Set up Cargo / Rust / GCC / binutils on-device. Wraps in-rootfs
    // sub-binaries (cc1, collect2, lto1, ld.bfd, …) as shebang scripts and
    // generates entry-point wrappers under cache/wrappers/. See the docstring
    // on prepare_toolchain_wrappers for the full SELinux story.
    let cache_dir = home_dir.join(".cache");
    let _ = fs::create_dir_all(&cache_dir);
    let wrappers_dir = match prepare_toolchain_wrappers(&rootfs_dir, &nlib_dir, &cache_dir) {
        Ok(p) => Some(p),
        Err(e) => {
            log::warn!("[OpenCode] prepare_toolchain_wrappers failed: {} — Rust/Cargo on-device will not work", e);
            None
        }
    };

    // Build PATH with bin links and nativeLibraryDir.
    // NOTE: /system/bin is intentionally excluded — Android SELinux blocks exec()
    // of system binaries from the untrusted_app domain, causing silent failures
    // and terminal freezes. All needed commands are provided via toybox symlinks.
    let sys_path = std::env::var("PATH").unwrap_or_default();
    // Wrappers dir comes FIRST so cargo / rustc / cc are resolved through the
    // bash + linker chain rather than execve'd as raw musl ELFs (denied by
    // SELinux execute_no_trans).
    let path = if let Some(ref w) = wrappers_dir {
        format!("{}:{}:{}:{}", w.display(), bin_link_dir.display(), nlib_dir.display(), sys_path)
    } else {
        format!("{}:{}:{}", bin_link_dir.display(), nlib_dir.display(), sys_path)
    };

    // Phase C: detect whether adbd is running. When the user has USB debugging
    // active and pairs the device with a PC running cargo-proxy.mjs over
    // `adb reverse tcp:9999 tcp:9999`, the bash tool routes toolchain commands
    // (cargo, rustc, npm, ...) to the host PC. Otherwise the bash tool runs
    // commands locally as before.
    let cargo_proxy_active = Command::new("/system/bin/getprop")
        .arg("init.svc.adbd")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "running")
        .unwrap_or(false);
    log::debug!("[OpenCode] adbd running = {} → OPENCODE_CARGO_PROXY = {}",
        cargo_proxy_active, if cargo_proxy_active { "1" } else { "0" });

    // On Android, bun is linked against musl. We invoke it via the musl dynamic
    // linker shipped alongside (also in nativeLibraryDir for exec permission).
    // Write env vars to a file — musl linker doesn't pass Command::env() to bun.
    // mobile-entry.ts reads this file and applies env vars at startup.
    // Use the bundled bash (libbash_exec.so, in nativeLibraryDir which has
    // exec_no_trans allowed by SELinux for `untrusted_app`). Driving the
    // bash tool through this shell lets us set BASH_ENV so .bashrc is
    // sourced even in non-interactive `bash -c "<cmd>"` invocations: the
    // shell-function wrappers (cargo / rustc / python / gcc / …) defined
    // below from the `tools` array become available, and the calls go
    // through libmusl_linker.so without ever exec()ing a script in
    // app_data_file (which `untrusted_app` cannot do).
    let env_file = dir.join(".env_vars");
    let bash_path = bin_link_dir.join("bash");
    let bash_env_path = home_dir.join(".bashrc");
    let env_content = format!(
        "HOME={home}\nTERM=xterm-256color\nENV={home}/.mkshrc\nBASH_ENV={bash_env}\nSSL_CERT_FILE={cert}\nNODE_EXTRA_CA_CERTS={cert}\nRESOLV_CONF={resolv}\nSHELL={shell}\nBUN_PTY_LIB={pty}\nOPENCODE_PTY_PORT=14098\nOPENCODE_SERVER_USERNAME=opencode\nOPENCODE_SERVER_PASSWORD={pw}\nOPENCODE_CLIENT=mobile-embedded\nOPENCODE_DISABLE_LSP_DOWNLOAD=false\nTMPDIR={tmp}\nTMP={tmp}\nTEMP={tmp}\nXDG_DATA_HOME={xdg_data}\nXDG_STATE_HOME={xdg_state}\nXDG_CACHE_HOME={xdg_cache}\nXDG_CONFIG_HOME={xdg_config}\nPATH={path_val}\nLD_LIBRARY_PATH={lib_path_val}\nHTTP_PROXY={proxy}\nHTTPS_PROXY={proxy}\nhttp_proxy={proxy}\nhttps_proxy={proxy}\n",
        home = home_dir.display(),
        bash_env = bash_env_path.display(),
        cert = ca_bundle_path.display(),
        resolv = resolv_path.display(),
        tmp = app_tmp_dir.display(),
        shell = bash_path.display(),
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
    let env_content = format!("{}OPENCODE_CARGO_PROXY={}\n", env_content, if cargo_proxy_active { "1" } else { "0" });
    // Pin RUSTC + MUSL_LINKER so cargo finds rustc through the wrapper chain
    // even when its `Command::new` ignores PATH ordering.
    let env_content = if let Some(ref w) = wrappers_dir {
        let r = format!("{}RUSTC={}\nMUSL_LINKER={}\n", env_content, w.join("rustc").display(), nlib_dir.join("libmusl_linker.so").display());
        r
    } else {
        env_content
    };
    let _ = fs::write(&env_file, &env_content);

    // Build command: use --preload to load resolv_override.so via CLI arg
    // (bypasses env var transmission issue with musl linker)
    let resolv_override = nlib_dir.join("libresolv_override.so");
    let (cmd_path, cmd_args) = build_server_command(
        &ld_musl,
        ld_musl.exists(),
        &bun_path,
        &cli_path,
        &lib_path,
        resolv_override.exists().then_some(resolv_override.as_path()),
        port,
    );

    let resolv_override_path = nlib_dir.join("libresolv_override.so");
    log::debug!("[OpenCode] Spawning: {} {:?}", cmd_path.display(), cmd_args);
    log::debug!("[OpenCode] LD_LIBRARY_PATH={}", lib_path);
    log::debug!("[OpenCode] LD_PRELOAD={} (exists={})", resolv_override_path.display(), resolv_override_path.exists());
    log::debug!("[OpenCode] SSL_CERT_FILE={} (exists={})", ca_bundle_path.display(), ca_bundle_path.exists());

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
        .env("TMPDIR", app_tmp_dir.to_str().unwrap_or(""))
        .env("TMP", app_tmp_dir.to_str().unwrap_or(""))
        .env("TEMP", app_tmp_dir.to_str().unwrap_or(""))
        .env("EXTERNAL_STORAGE", "/sdcard")
        .env("OPENCODE_HOME", home_dir.to_str().unwrap_or("/tmp"))
        .env("OPENCODE_SERVER_USERNAME", "opencode")
        .env("OPENCODE_SERVER_PASSWORD", &password)
        .env("OPENCODE_CLIENT", "mobile-embedded")
        .env("OPENCODE_CARGO_PROXY", if cargo_proxy_active { "1" } else { "0" })
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
        .env(
            "RUSTC",
            wrappers_dir
                .as_ref()
                .map(|w| w.join("rustc").to_string_lossy().to_string())
                .unwrap_or_default(),
        )
        .env(
            "MUSL_LINKER",
            nlib_dir.join("libmusl_linker.so").to_string_lossy().to_string(),
        )
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
            for line in reader.lines().map_while(Result::ok) {
                log::info!("[bun] {}", line);
                if let Some(ref mut f) = file {
                    let _ = writeln!(f, "{}", line);
                }
            }
        });
    }

    log::info!("[OpenCode] Server spawned with pid {:?}", child.id());

    // Check if process exited immediately (crash)
    std::thread::sleep(Duration::from_millis(500));
    match child.try_wait() {
        Ok(Some(status)) => {
            std::thread::sleep(Duration::from_millis(500)); // let stderr thread flush
            let stderr = fs::read_to_string(log_dir.join("server_stderr.log")).unwrap_or_default();
            log::error!("[OpenCode] Server exited immediately with status: {}", status);
            return Err(format!("Server crashed ({}): {}", status, &stderr[..stderr.len().min(500)]));
        }
        Ok(None) => {
            log::info!("[OpenCode] Server still running after 500ms — good");
        }
        Err(e) => {
            log::warn!("[OpenCode] Error checking server status: {}", e);
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

    // Kill the stored process AND reap it so its stderr pipe closes and the
    // background reader thread can exit. Without wait(), child becomes a
    // zombie and the BufReader<ChildStderr> in the stderr thread stays
    // blocked on `lines()` forever — repeated stop/start cycles leak
    // threads + fds on Android.
    let child_opt = SERVER_PROCESS.lock().ok().and_then(|mut g| g.take());
    if let Some(mut child) = child_opt {
        let _ = child.kill();
        let start = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(_status)) => break,
                Ok(None) if start.elapsed() > Duration::from_secs(2) => {
                    log::warn!("[OpenCode] Server did not exit within 2s after kill, detaching");
                    break;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(50)),
                Err(e) => {
                    log::warn!("[OpenCode] wait() after kill failed: {}", e);
                    break;
                }
            }
        }
    }

    Ok(())
}

/// Build the spawn command for the bun sidecar (D-01 step 2b extraction).
///
/// On Android, bun is musl-linked and must be launched through the musl dynamic
/// linker (`ld_musl`) with `--library-path` and an optional `--preload` of the
/// resolv override; without the linker bun is launched directly. Pure: the
/// caller performs the filesystem existence checks and passes the results in,
/// which keeps this unit-testable.
fn build_server_command(
    ld_musl: &Path,
    ld_musl_exists: bool,
    bun_path: &Path,
    cli_path: &Path,
    lib_path: &str,
    resolv_override: Option<&Path>,
    port: u32,
) -> (PathBuf, Vec<String>) {
    let serve_args = [
        "serve".to_string(),
        "--hostname".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        port.to_string(),
        "--print-logs".to_string(),
    ];
    if ld_musl_exists {
        let mut args = vec!["--library-path".to_string(), lib_path.to_string()];
        // --preload passes LD_PRELOAD via CLI instead of an env var (the musl
        // linker does not forward Command::env() to bun).
        if let Some(ro) = resolv_override {
            args.push("--preload".to_string());
            args.push(ro.to_string_lossy().to_string());
        }
        args.push(bun_path.to_string_lossy().to_string());
        args.push(cli_path.to_string_lossy().to_string());
        args.extend(serve_args);
        (ld_musl.to_path_buf(), args)
    } else {
        let mut args = vec![cli_path.to_string_lossy().to_string()];
        args.extend(serve_args);
        (bun_path.to_path_buf(), args)
    }
}

/// Non-interactive applets sourced from the static busybox (D-19): only those
/// toybox lacks. Must stay disjoint from [`SECCOMP_RISK_APPLETS`].
const BUSYBOX_FALLBACK_APPLETS: &[&str] = &["gawk", "ed", "bc", "dc", "expr"];

/// Interactive applets that SIGSYS under Android's zygote seccomp when run from
/// the static busybox (D-19). These must be served by the seccomp-safe
/// /system/bin/toybox, never by busybox — enforced by a unit test.
const SECCOMP_RISK_APPLETS: &[&str] =
    &["vi", "vim", "less", "top", "htop", "nano", "more", "microcom"];

/// Populate `bin_link_dir` with command symlinks (D-01 step 2b extraction):
/// the bundled JNI binaries (bash/sh/rg/bun/toybox/busybox/proot), the toybox
/// applet set, Android's seccomp-safe /system/bin/toybox applets, a few direct
/// /system/bin binaries, and busybox-only fallbacks. Idempotent: each symlink
/// is recreated only when missing or pointing at a stale target.
fn setup_command_symlinks(nlib_dir: &Path, bin_link_dir: &Path) {
    let bin_links = [
        ("libbash_exec.so", "bash"),
        ("libbash_exec.so", "sh"),
        ("librg_exec.so", "rg"),
        ("libbun_exec.so", "bun"),
        ("libtoybox_exec.so", "toybox"),
        // Busybox is optional — bundled only when `prepare-android-runtime.sh`
        // has downloaded it. If absent the block below silently skips it and
        // toybox continues to provide ls/cat/etc. Busybox's added value is
        // richer applets (vi, nano, awk, sed implementations, less, etc.).
        ("libbusybox_exec.so", "busybox"),
        // proot is bundled as a JNI lib so it benefits from nativeLibraryDir
        // exec permission. Downloading proot at runtime to runtime/bin/ fails
        // with EACCES because Android SELinux (targetSdk 29+) blocks exec of
        // files written to app private data dir. Only .so files extracted to
        // nativeLibraryDir by the installer get the exec label.
        ("libproot_exec.so", "proot"),
    ];
    for (src_name, link_name) in &bin_links {
        let src = nlib_dir.join(src_name);
        let link = bin_link_dir.join(link_name);
        let needs = match fs::read_link(&link) {
            Ok(target) => target != src,
            Err(_) => true,
        };
        if needs && src.exists() {
            force_symlink(&src, &link);
        }
    }

    // Toybox applet symlinks — provides standard Unix commands (ls, cat, grep, etc.)
    // Android SELinux blocks exec of /system/bin/* from app sandbox, but binaries
    // in nativeLibraryDir are allowed. Toybox multi-call binary detects the command
    // name from argv[0] (the symlink name).
    let toybox_src = nlib_dir.join("libtoybox_exec.so");
    if toybox_src.exists() {
        let toybox_cmds = [
            // Core file operations
            "ls", "cat", "cp", "mv", "rm", "mkdir", "rmdir", "ln", "touch",
            "chmod", "chown", "chgrp", "stat", "file", "readlink", "realpath",
            // Text processing
            "grep", "egrep", "fgrep", "sed", "head", "tail", "wc", "sort",
            "uniq", "tr", "cut", "tee", "xargs", "diff", "paste", "fold",
            "expand", "fmt", "nl", "od", "strings", "rev",
            // Search & navigation
            "find", "which", "dirname", "basename",
            // Editors & viewers
            "vi", "more", "hexedit",
            // Archives
            "tar", "gzip", "gunzip", "zcat", "bunzip2", "bzcat", "cpio",
            // System info
            "ps", "kill", "killall", "df", "du", "free", "uptime", "uname",
            "hostname", "id", "whoami", "env", "printenv", "date", "cal",
            "dmesg", "top", "w", "nproc", "pgrep", "pkill",
            // Network
            "ping", "wget", "nc", "netcat", "netstat", "ifconfig", "host",
            // Misc utilities
            "printf", "echo", "test", "true", "false", "sleep", "yes",
            "md5sum", "sha1sum", "sha256sum", "seq", "dd", "clear",
            "reset", "time", "timeout", "watch", "tee",
            "base64", "xxd", "cmp", "patch", "split", "truncate",
            "nohup", "nice", "xargs", "install",
        ];
        for cmd in &toybox_cmds {
            let link = bin_link_dir.join(cmd);
            // Always verify target matches — symlinks become dangling after APK updates
            // because nativeLibraryDir path changes with each install.
            let needs = match fs::read_link(&link) {
                Ok(target) => target != toybox_src,
                Err(_) => true,
            };
            if needs {
                force_symlink(&toybox_src, &link);
            }
        }
    }

    // Busybox applet symlinks — busybox is a STATIC binary that uses modern
    // syscalls (rseq/statx/clone3?) blocked by Android zygote seccomp.
    // Interactive applets (vi, less, nano, top) hit SIGSYS ("bad system
    // call"). Non-interactive applets happen to work by luck.
    //
    // STRATEGY: prefer Android's /system/bin/toybox (dynamic-bionic,
    // seccomp-safe) for every applet it provides. Fall back to busybox
    // only for applets toybox lacks (awk, gawk, ed, bc, dc, tr variant).
    // Android's toybox 0.8.6 covers most coreutils including vi.
    let busybox_src = nlib_dir.join("libbusybox_exec.so");
    let system_toybox = std::path::PathBuf::from("/system/bin/toybox");

    // Comprehensive list of applets that Android /system/bin/toybox
    // provides on modern Android (0.8.6+). Verified via `toybox` applet
    // list on Xiaomi Android 14. Interactive applets (vi, top, more,
    // microcom) + coreutils + filesystem + archive + network tools.
    if system_toybox.exists() {
        let system_toybox_cmds = [
            // Text editors / pagers
            "vi", "vim", "more", "less",
            // Process management
            "top", "ps", "kill", "killall", "pkill", "pgrep", "nice", "renice",
            "iotop", "ionice", "pidof", "pmap", "time", "timeout", "nohup", "watch",
            // File ops
            "ls", "cp", "mv", "rm", "mkdir", "rmdir", "ln", "touch", "readlink",
            "realpath", "stat", "chmod", "chown", "chgrp", "chattr", "file", "find",
            // Text processing
            "cat", "tac", "head", "tail", "wc", "sort", "uniq", "cut", "paste",
            "tr", "tee", "sed", "grep", "egrep", "fgrep", "expand", "fold", "fmt",
            "nl", "rev", "split", "strings", "xxd", "od", "dos2unix", "unix2dos",
            // Archive / compression
            "tar", "gzip", "gunzip", "zcat", "bzcat", "cpio", "uudecode", "uuencode",
            // Network
            "ping", "ping6", "nc", "netcat", "netstat", "ifconfig", "hostname",
            "traceroute", "traceroute6",
            // System info
            "df", "du", "free", "uptime", "uname", "whoami", "who", "groups",
            "id", "dmesg", "hostname", "lsof", "lspci", "lsusb", "lsmod",
            // Misc utilities
            "env", "printenv", "xargs", "yes", "seq", "sleep", "usleep",
            "echo", "printf", "true", "false", "test", "[", "which", "dirname",
            "basename", "pwd", "tty", "clear", "reset",
            // Hashing
            "md5sum", "sha1sum", "sha224sum", "sha256sum", "sha384sum", "sha512sum",
            "cmp", "diff",
            // Misc
            "date", "hwclock", "cal", "getopt", "install", "mktemp",
        ];
        for cmd in &system_toybox_cmds {
            let link = bin_link_dir.join(cmd);
            let needs = match fs::read_link(&link) {
                Ok(target) => target != system_toybox,
                Err(_) => true,
            };
            if needs {
                force_symlink(&system_toybox, &link);
            }
        }
    }

    // Additional system binaries in /system/bin/ (dynamic-bionic, safe).
    // These are real binaries, not toybox applets, so we symlink to them
    // directly. Available on most modern Android.
    let system_bin_cmds: &[(&str, &str)] = &[
        ("curl",   "/system/bin/curl"),
        ("strace", "/system/bin/strace"),
        ("wget",   "/system/bin/wget"),
        ("awk",    "/system/bin/awk"),
    ];
    for (name, target_path) in system_bin_cmds {
        let target = std::path::PathBuf::from(target_path);
        if !target.exists() { continue; }
        let link = bin_link_dir.join(name);
        let needs = match fs::read_link(&link) {
            Ok(t) => t != target,
            Err(_) => true,
        };
        if needs {
            force_symlink(&target, &link);
        }
    }

    // Busybox only for non-interactive applets toybox lacks (scripting/calc).
    // D-19: busybox is a STATIC binary; interactive applets (vi/less/top/…) hit
    // SIGSYS under Android's zygote seccomp. We therefore route those to the
    // seccomp-safe /system/bin/toybox above and NEVER list them here. The
    // BUSYBOX_FALLBACK_APPLETS / SECCOMP_RISK_APPLETS split makes that invariant
    // explicit and is enforced by `busybox_fallback_excludes_seccomp_risk_applets`.
    if busybox_src.exists() {
        for cmd in BUSYBOX_FALLBACK_APPLETS {
            let link = bin_link_dir.join(cmd);
            // Don't override if a system binary already claimed this slot.
            if link.exists() { continue; }
            let needs = match fs::read_link(&link) {
                Ok(target) => target != busybox_src,
                Err(_) => true,
            };
            if needs {
                force_symlink(&busybox_src, &link);
            }
        }
    }
}

/// Recreate the compat-name and bun-pty shared-library symlinks (D-01 step 2b).
/// Android ships libs as lib*.so JNI names; bun and bun-pty look them up under
/// their canonical names, so we point those at the nativeLibraryDir originals.
fn setup_compat_lib_symlinks(nlib_dir: &Path, dir: &Path, lib_link_dir: &Path) {
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
            force_symlink(&src, &link);
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
            force_symlink(&pty_lib_src, &pty_link);
        }
        // Also create the non-arm64 name as fallback
        let pty_link2 = pty_dir.join("librust_pty.so");
        let needs_pty_link2 = match fs::read_link(&pty_link2) {
            Ok(target) => target != pty_lib_src,
            Err(_) => true,
        };
        if needs_pty_link2 {
            force_symlink(&pty_lib_src, &pty_link2);
        }
    }
}

/// Build the shell-function wrappers (cargo/rustc/git/...) sourced by the bash
/// tool (D-01 step 2b extraction). Each wrapper invokes the binary through the
/// musl dynamic linker with LD_PRELOAD=libmusl_exec.so so sub-forks bypass the
/// SELinux execute_no_trans denial. Pure: derives all paths from dir/nlib_dir.
fn build_tool_functions(dir: &Path, nlib_dir: &Path) -> String {
    // Rootfs tool invocation via direct ld-musl loader — NOT proot.
    //
    // Why not proot: Android 13+ SELinux denies `execute_no_trans` on any
    // file under `app_data_file` label. proot copies its internal helper
    // (`prooted-XXX`) to PROOT_TMP_DIR (runtime/tmp, which has app_data_file
    // label) and exec's it via ptrace → EACCES. Termux patches proot to
    // work around this but that binary isn't in an easy-to-consume form.
    //
    // Alternative: invoke binaries via the musl dynamic linker directly.
    // libmusl_linker.so is bundled in nativeLibraryDir (JNI lib) which has
    // the `same_process_app_data_file` label and IS exec-allowed. The ld
    // loader then mmap's (not exec's) the target binary from the rootfs,
    // and mmap only needs READ — allowed under app_data_file for same UID.
    //
    // Syntax:
    //   LD_LIBRARY_PATH=$rootfs/lib:$rootfs/usr/lib  libmusl_linker.so  $rootfs/usr/bin/git  "$@"
    //
    // Caveat: binaries that fork sub-binaries via execve (e.g. `git clone`
    // → `git-remote-https`) still hit the same EACCES. Basic git (init,
    // status, add, commit, log, diff, branch, checkout) uses internal
    // functions only and works. Clone/push/fetch need additional work
    // (bundle git-core binaries individually via the same trick, or ship
    // a patched Termux proot later).
    let ld_musl_path = nlib_dir.join("libmusl_linker.so");
    let rootfs_path = dir.join("rootfs");
    let rootfs_lib_path = format!(
        "{}/lib:{}/usr/lib:{}/usr/libexec/git-core",
        rootfs_path.display(),
        rootfs_path.display(),
        rootfs_path.display()
    );
    let musl_exec_path = rootfs_path.join("usr/lib/libmusl_exec.so");
    let tools = [
        "git", "nano", "less", "vim",
        "make", "patch",
        "tmux", "screen",
        "ssh", "scp", "sftp", "ssh-keygen", "ssh-add",
        "rsync", "wget",
        "python3", "python", "node", "npm", "pip", "pip3",
        // Toolchain on-device (Alpine build-base + rust cargo). Adding the
        // wrappers here lets the user build native Rust / C / C++ projects
        // entirely on the phone, without a PC cargo proxy. The actual
        // binaries are installed in the rootfs by build-alpine-rootfs.sh.
        "gcc", "g++", "cc", "ar", "ld", "as", "ranlib", "objdump", "strip",
        "rustc", "cargo", "rustup",
        "jq", "tree", "htop", "fzf", "fd", "bat", "exa",
    ];
    let mut tool_fns = String::new();
    // GIT_EXEC_PATH: git uses this to locate sub-binaries (git-remote-https etc.)
    tool_fns.push_str(&format!(
        "export GIT_EXEC_PATH=\"{rootfs}/usr/libexec/git-core\"\n",
        rootfs = rootfs_path.display()
    ));
    for t in &tools {
        // Top-level invocation: exec via musl linker (exec-allowed from nativeLibraryDir).
        // LD_PRELOAD=libmusl_exec.so (musl-compiled, lives in rootfs) is injected so
        // sub-forks (git-remote-https, pip subprocesses, npm scripts) also get
        // redirected through the musl linker instead of hitting SELinux execute_no_trans.
        // MUSL_LINKER env var tells libmusl_exec where to redirect execve calls.
        // LD_LIBRARY_PATH lets the musl linker find Alpine shared libs at runtime.
        tool_fns.push_str(&format!(
            "{t}() {{ \
                LD_LIBRARY_PATH=\"{libs}\" \
                LD_PRELOAD=\"{musl_exec}\" \
                MUSL_LINKER=\"{ld}\" \
                \"{ld}\" \"{rootfs}/usr/bin/{t}\" \"$@\"; \
            }}\n",
            t = t,
            ld = ld_musl_path.display(),
            rootfs = rootfs_path.display(),
            libs = rootfs_lib_path,
            musl_exec = musl_exec_path.display(),
        ));
    }
    tool_fns
}

/// Write the interactive shell rc files (.mkshrc/.bashrc/.profile) that source
/// the tool wrappers and set the prompt/aliases (D-01 step 2b extraction).
fn write_shell_rc_files(home_dir: &Path, mkshrc_path: &Path, tool_fns: &str) {
    // mksh uses $'\e[...]' syntax for ANSI escapes in PS1 (not bash's \[\033[...]\])
    let mkshrc_content = format!(
        "# OpenCode mobile shell init\n\
PS1=$'\\e[1;32m'\"$USER@opencode\"$'\\e[0m'\":\"$'\\e[1;34m'\"\\w\"$'\\e[0m'\"$ \"\n\
alias ls='ls --color=auto'\n\
alias ll='ls -la --color=auto'\n\
alias la='ls -A --color=auto'\n\
alias grep='grep --color=auto'\n\
alias ..='cd ..'\n\
alias cls='clear'\n\
{tool_fns}"
    );
    let _ = fs::write(&mkshrc_path, &mkshrc_content);

    // .bashrc for bash (which is the real shell via libbash_exec.so symlinked
    // as both `bash` and `sh`). Same content as .mkshrc — mksh-specific PS1
    // escape syntax ($'\e[...]') also works in bash via ANSI-C quoting.
    let bashrc_path = home_dir.join(".bashrc");
    let _ = fs::write(&bashrc_path, &mkshrc_content);

    // .profile for login shells — source both rc files for robustness.
    let profile_path = home_dir.join(".profile");
    let _ = fs::write(
        &profile_path,
        "# Source shell rc — works for bash and mksh\n\
[ -f \"$HOME/.bashrc\" ] && . \"$HOME/.bashrc\"\n\
[ -z \"$BASH_VERSION\" ] && [ -f \"$HOME/.mkshrc\" ] && . \"$HOME/.mkshrc\"\n",
    );
}

/// Write resolv.conf (app + rootfs) and assemble the Android CA bundle for TLS
/// (D-01 step 2b extraction). Returns (resolv_path, ca_bundle_path).
fn setup_dns_and_ca(dir: &Path) -> (PathBuf, PathBuf) {
    // Create resolv.conf with public DNS servers (Android has no /etc/resolv.conf)
    let resolv_path = dir.join("resolv.conf");
    let _ = fs::write(&resolv_path, "nameserver 8.8.8.8\nnameserver 8.8.4.4\nnameserver 1.1.1.1\n");

    // Refresh rootfs /etc/resolv.conf every launch so git-http / wget / pip
    // keep working after network changes or /tmp cleanup.
    let rootfs_dir = dir.join("rootfs");
    if rootfs_dir.exists() {
        let _ = fs::create_dir_all(rootfs_dir.join("etc"));
        let _ = fs::write(
            rootfs_dir.join("etc/resolv.conf"),
            "nameserver 8.8.8.8\nnameserver 8.8.4.4\nnameserver 1.1.1.1\n",
        );
    }

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
            log::info!("[OpenCode] Created CA bundle with {} bytes", bundle.len());
        } else {
            log::warn!("[OpenCode] No CA certificates found on device");
        }
    }
    (resolv_path, ca_bundle_path)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn busybox_fallback_excludes_seccomp_risk_applets() {
        // D-19 invariant: the static busybox (which SIGSYS's on interactive
        // applets under Android seccomp) must never be the source for any
        // known risk applet. Adding e.g. "vi" to the fallback list fails here.
        for applet in BUSYBOX_FALLBACK_APPLETS {
            assert!(
                !SECCOMP_RISK_APPLETS.contains(applet),
                "{applet} routes to the static busybox but is a known SIGSYS-risk applet"
            );
        }
    }

    #[test]
    fn build_server_command_via_musl_linker_with_preload() {
        let (cmd, args) = build_server_command(
            Path::new("/nlib/libmusl_linker.so"),
            true,
            Path::new("/nlib/libbun_exec.so"),
            Path::new("/data/opencode-cli.js"),
            "/lib:/usr/lib",
            Some(Path::new("/nlib/libresolv_override.so")),
            14096,
        );
        assert_eq!(cmd, PathBuf::from("/nlib/libmusl_linker.so"));
        let argv: Vec<&str> = args.iter().map(String::as_str).collect();
        assert_eq!(
            argv,
            vec![
                "--library-path",
                "/lib:/usr/lib",
                "--preload",
                "/nlib/libresolv_override.so",
                "/nlib/libbun_exec.so",
                "/data/opencode-cli.js",
                "serve",
                "--hostname",
                "127.0.0.1",
                "--port",
                "14096",
                "--print-logs",
            ]
        );
    }

    #[test]
    fn build_server_command_via_musl_linker_without_preload() {
        let (cmd, args) = build_server_command(
            Path::new("/nlib/libmusl_linker.so"),
            true,
            Path::new("/nlib/libbun_exec.so"),
            Path::new("/data/cli.js"),
            "/lib",
            None,
            14096,
        );
        assert_eq!(cmd, PathBuf::from("/nlib/libmusl_linker.so"));
        assert!(!args.iter().any(|a| a == "--preload"));
        assert_eq!(&args[0], "--library-path");
        assert_eq!(&args[1], "/lib");
    }

    #[test]
    fn build_server_command_direct_when_no_linker() {
        let (cmd, args) = build_server_command(
            Path::new("/unused"),
            false,
            Path::new("/nlib/libbun_exec.so"),
            Path::new("/data/cli.js"),
            "/lib",
            Some(Path::new("/ro.so")),
            14096,
        );
        assert_eq!(cmd, PathBuf::from("/nlib/libbun_exec.so"));
        assert_eq!(&args[0], "/data/cli.js");
        assert_eq!(&args[1], "serve");
        assert!(!args.iter().any(|a| a == "--library-path"));
    }
}
