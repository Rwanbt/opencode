use serde::{Deserialize, Serialize};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
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
    // extended_env is only considered ready if the rootfs exists AND at least
    // one of the apk-installed tools is present. Checking only rootfs existence
    // is not enough: `apk add` may fail silently (network issue, stale proot
    // binary, permission errors) leaving a base-only Alpine with apk-tools but
    // none of the user-facing tools (git, nano, tmux, python, node). We pick
    // `git` as the sentinel because it's the most frequently requested tool
    // and its absence is the clearest signal that install_extended_env didn't
    // finish. If this check fails, the frontend re-runs installExtendedEnv.
    let rootfs_dir = dir.join("rootfs");
    let extended_env = rootfs_dir.exists() && rootfs_dir.join("usr/bin/git").exists();

    // Log debug info
    if let Some(nlib) = native_lib_dir(&dir) {
        log::debug!("[OpenCode] nativeLibDir={}, bun_exists={}, cli_exists={}",
            nlib.display(), nlib.join("libbun_exec.so").exists(), dir.join("opencode-cli.js").exists());
    } else {
        log::debug!("[OpenCode] nativeLibDir not found, cli_exists={}", dir.join("opencode-cli.js").exists());
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

    // Expose external storage to the server via symlinks
    // Android apps can access /sdcard with READ/WRITE_EXTERNAL_STORAGE permissions
    let external_storage = PathBuf::from("/sdcard");
    if external_storage.exists() {
        // Symlink common user directories into HOME so the server can browse them
        for dir_name in &["Documents", "Downloads", "projects", "Projects", "dev", "code"] {
            let target = external_storage.join(dir_name);
            let link = home_dir.join(dir_name);
            if target.exists() && !link.exists() {
                let _ = std::os::unix::fs::symlink(&target, &link);
                log::debug!("[OpenCode] Symlinked {} -> {}", link.display(), target.display());
            }
        }
        // Also create a "storage" link to the full /sdcard
        let storage_link = home_dir.join("storage");
        if !storage_link.exists() {
            let _ = std::os::unix::fs::symlink(&external_storage, &storage_link);
            log::debug!("[OpenCode] Symlinked {} -> {}", storage_link.display(), external_storage.display());
        }
    }

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
        ("libtoybox_exec.so", "toybox"),
        // Busybox is optional — bundled only when `prepare-android-runtime.sh`
        // has downloaded it. If absent the block below silently skips it and
        // toybox continues to provide ls/cat/etc. Busybox's added value is
        // richer applets (vi, nano, awk, sed implementations, less, etc.).
        ("libbusybox_exec.so", "busybox"),
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
                let _ = fs::remove_file(&link);
                let _ = std::os::unix::fs::symlink(&toybox_src, &link);
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
                let _ = fs::remove_file(&link);
                let _ = std::os::unix::fs::symlink(&system_toybox, &link);
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
            let _ = fs::remove_file(&link);
            let _ = std::os::unix::fs::symlink(&target, &link);
        }
    }

    // Busybox only for applets NOT in toybox Android (scripting/calc).
    // Note: busybox is static so some of these may still SIGSYS, but
    // most non-interactive applets (awk/sed/ed/bc/dc/expr) work.
    if busybox_src.exists() {
        let busybox_cmds = [
            "gawk",         // busybox has no gawk, fallback for awk compat
            "ed",           // line editor, no toybox equivalent
            "bc", "dc",     // calculators, no toybox equivalent
            "expr",         // toybox has expr but busybox is richer
        ];
        for cmd in &busybox_cmds {
            let link = bin_link_dir.join(cmd);
            // Don't override if a system binary already claimed this slot.
            if link.exists() { continue; }
            let needs = match fs::read_link(&link) {
                Ok(target) => target != busybox_src,
                Err(_) => true,
            };
            if needs {
                let _ = fs::remove_file(&link);
                let _ = std::os::unix::fs::symlink(&busybox_src, &link);
            }
        }
    }

    // Create shell init file (.mkshrc) for /system/bin/sh (mksh).
    // Sourced via ENV variable (set in .env_vars, passed to PTY spawn env).
    // Keep it minimal — TERM, PATH, HOME are already set via PTY env vars.
    // Do NOT re-export ENV here (causes infinite source loop in mksh).
    let mkshrc_path = home_dir.join(".mkshrc");
    // No false aliases: nano ≠ vi, htop ≠ top — user will get "command not
    // found" if these tools aren't bundled, which is the honest behaviour.
    let editor_aliases = "";
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
{editor_aliases}"
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

    // Create resolv.conf with public DNS servers (Android has no /etc/resolv.conf)
    let resolv_path = dir.join("resolv.conf");
    let _ = fs::write(&resolv_path, "nameserver 8.8.8.8\nnameserver 8.8.4.4\nnameserver 1.1.1.1\n");

    // Regenerate proot-run every launch when the Alpine rootfs is present.
    // The wrapper bakes in the APK install path (nativeLibraryDir) which
    // rotates on every upgrade — a stale wrapper points at a path that no
    // longer exists and causes every proot invocation (git, nano, tmux…)
    // to fail silently. install_extended_env writes this same file but is
    // only called once per device; we need it to stay fresh after upgrades.
    let rootfs_dir = dir.join("rootfs");
    if rootfs_dir.exists() {
        let proot_path = bin_link_dir.join("proot");
        let proot_run_path = bin_link_dir.join("proot-run");
        let proot_tmp_dir = dir.join("tmp");
        let _ = fs::create_dir_all(&proot_tmp_dir);
        // Also refresh the rootfs DNS config — if the user cleared /tmp or a
        // prior install shipped with no /etc/resolv.conf, apk/git/etc will
        // fail with "bad address" errors. Idempotent.
        let rootfs_etc = rootfs_dir.join("etc");
        let _ = fs::create_dir_all(&rootfs_etc);
        let _ = fs::write(
            rootfs_etc.join("resolv.conf"),
            "nameserver 8.8.8.8\nnameserver 8.8.4.4\nnameserver 1.1.1.1\n",
        );
        let proot_run_content = format!(
            "#!/bin/sh\n\
export LD_LIBRARY_PATH=\"{lib_links}:{nlib}\"\n\
export PROOT_TMP_DIR=\"{tmp}\"\n\
mkdir -p \"$PROOT_TMP_DIR\"\n\
exec {proot} \\\n  --rootfs={rootfs} \\\n  --bind={bin}:/usr/local/bin \\\n  --bind={nlib}:/usr/local/lib \\\n  --bind=/dev:/dev \\\n  --bind=/proc:/proc \\\n  --bind=/sys:/sys \\\n  -w /root \\\n  \"$@\"\n",
            proot = proot_path.display(),
            rootfs = rootfs_dir.display(),
            bin = bin_link_dir.display(),
            nlib = nlib_dir.display(),
            lib_links = lib_link_dir.display(),
            tmp = proot_tmp_dir.display(),
        );
        if fs::write(&proot_run_path, proot_run_content).is_ok() {
            if let Ok(meta) = fs::metadata(&proot_run_path) {
                let mut p = meta.permissions();
                p.set_mode(0o755);
                let _ = fs::set_permissions(&proot_run_path, p);
            }
        }
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

    // Library search path: lib_links (for symlinked names) + nlib_dir
    let lib_path = format!("{}:{}", lib_link_dir.display(), nlib_dir.display());

    // Build PATH with bin links and nativeLibraryDir.
    // NOTE: /system/bin is intentionally excluded — Android SELinux blocks exec()
    // of system binaries from the untrusted_app domain, causing silent failures
    // and terminal freezes. All needed commands are provided via toybox symlinks.
    let sys_path = std::env::var("PATH").unwrap_or_default();
    let path = format!("{}:{}:{}", bin_link_dir.display(), nlib_dir.display(), sys_path);

    // On Android, bun is linked against musl. We invoke it via the musl dynamic
    // linker shipped alongside (also in nativeLibraryDir for exec permission).
    // Write env vars to a file — musl linker doesn't pass Command::env() to bun.
    // mobile-entry.ts reads this file and applies env vars at startup.
    let env_file = dir.join(".env_vars");
    let env_content = format!(
        "HOME={home}\nTERM=xterm-256color\nENV={home}/.mkshrc\nSSL_CERT_FILE={cert}\nNODE_EXTRA_CA_CERTS={cert}\nRESOLV_CONF={resolv}\nSHELL={shell}\nBUN_PTY_LIB={pty}\nOPENCODE_PTY_PORT=14098\nOPENCODE_SERVER_USERNAME=opencode\nOPENCODE_SERVER_PASSWORD={pw}\nOPENCODE_CLIENT=mobile-embedded\nOPENCODE_DISABLE_LSP_DOWNLOAD=false\nXDG_DATA_HOME={xdg_data}\nXDG_STATE_HOME={xdg_state}\nXDG_CACHE_HOME={xdg_cache}\nXDG_CONFIG_HOME={xdg_config}\nPATH={path_val}\nLD_LIBRARY_PATH={lib_path_val}\nHTTP_PROXY={proxy}\nHTTPS_PROXY={proxy}\nhttp_proxy={proxy}\nhttps_proxy={proxy}\n",
        home = home_dir.display(),
        cert = ca_bundle_path.display(),
        resolv = resolv_path.display(),
        // Use /system/bin/sh (Android's mksh, bionic-compiled) instead of the
        // statically-linked bash binary. Static bash uses its own libc fork()
        // which triggers Android's seccomp filter (SIGSYS/exitCode=159).
        // /system/bin/sh uses bionic's clone() which is whitelisted.
        shell = "/system/bin/sh",
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
        .env("EXTERNAL_STORAGE", "/sdcard")
        .env("OPENCODE_HOME", home_dir.to_str().unwrap_or("/tmp"))
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

    // Download proot static binary. The original gitlab pages URL
    // (proot.gitlab.io/proot/bin/proot-aarch64-static) is dead and returns
    // HTML — the resulting "proot" binary is an HTML blob that syntax-errors
    // when sh tries to exec it, causing every subsequent apk invocation to
    // fail silently (proot error leaks as sh error, apk add reports "partial
    // failure", rootfs stays base-only). Use the proot-me/proot GitHub
    // releases which host real statically-linked binaries.
    let proot_url =
        "https://github.com/proot-me/proot/releases/download/v5.3.0/proot-v5.3.0-aarch64-static";
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

    // Seed the rootfs with a working /etc/resolv.conf so apk, git-http, wget,
    // ssh etc. can resolve DNS inside proot. Alpine minirootfs ships without
    // one, and proot's sandbox hides the Android /etc tree — resulting in
    // "bad address" errors during apk update / package fetch. We reuse the
    // same public resolvers we wrote to the parent runtime's resolv.conf
    // (see extract_runtime, line ~466) so both the host bun sidecar and
    // the chrooted Alpine agree on name resolution.
    let rootfs_etc = rootfs_dir.join("etc");
    let _ = fs::create_dir_all(&rootfs_etc);
    let _ = fs::write(
        rootfs_etc.join("resolv.conf"),
        "nameserver 8.8.8.8\nnameserver 8.8.4.4\nnameserver 1.1.1.1\n",
    );

    // Create proot-run wrapper script. Notes:
    //  - PROOT_TMP_DIR must be exported: proot needs a writable tmp dir for
    //    its shadow filesystem; without it every invocation errors with
    //    "can't create temporary file: No such file or directory".
    //  - mkdir -p is idempotent and cheap; keeps the wrapper self-healing
    //    when /data/.../runtime/tmp gets cleaned.
    //  - Copy host resolv.conf into the rootfs so apk/git/etc. can resolve
    //    DNS — Alpine minirootfs ships without /etc/resolv.conf.
    let wrapper = format!(
        r#"#!/bin/sh
export LD_LIBRARY_PATH="{lib_links}:{nlib}"
export PROOT_TMP_DIR="{tmp}"
mkdir -p "$PROOT_TMP_DIR"
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
        tmp = dir.join("tmp").display(),
    );

    let wrapper_path = bin_link_dir.join("proot-run");
    fs::write(&wrapper_path, wrapper).map_err(|e| format!("Write wrapper: {}", e))?;
    let mut perms = fs::metadata(&wrapper_path)
        .map_err(|e| format!("metadata: {}", e))?
        .permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&wrapper_path, perms).map_err(|e| format!("chmod: {}", e))?;

    // ── apk install: advanced toolchain ───────────────────────────────
    let _ = app.emit(
        "extraction-progress",
        ExtractionProgress {
            phase: "Installing packages (nano, git, tmux, python, node, ...)".to_string(),
            progress: 0.85,
        },
    );

    // Comprehensive set of tools a developer expects. Roughly grouped:
    // - Editors: nano, less, vim (Alpine vim is richer than toybox)
    // - Dev: git, make, patch
    // - Multiplexer: tmux, screen
    // - Remote: openssh-client, rsync, wget, curl
    // - Runtimes: python3, nodejs, npm
    // - Modern UNIX: jq, tree, htop, fzf, fd, bat, exa, ripgrep
    // - Misc: file, diffutils, findutils, sed, grep, gawk
    let apk_packages = [
        "nano", "less", "vim",
        "git", "make", "patch",
        "tmux", "screen",
        "openssh-client", "rsync", "wget", "curl",
        "python3", "nodejs", "npm",
        "jq", "tree", "htop", "fzf", "fd", "bat", "exa", "ripgrep",
        "file", "diffutils", "findutils", "gawk",
        "ca-certificates",
    ];

    let rootfs_arg = format!("--rootfs={}", rootfs_dir.display());
    let proot_common_args: Vec<&str> = vec![
        rootfs_arg.as_str(),
        "--bind=/dev",
        "--bind=/proc",
        "--bind=/sys",
        "-w", "/root",
    ];

    // apk update (best effort — may fail on restricted networks, not fatal)
    let update_out = Command::new(&proot_path)
        .args(&proot_common_args)
        .args(["/sbin/apk", "update"])
        .env("PATH", "/sbin:/bin:/usr/sbin:/usr/bin")
        .env("HOME", "/root")
        .output();
    if let Ok(out) = &update_out {
        if !out.status.success() {
            log::warn!(
                "[OpenCode] apk update failed: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        }
    }

    // apk add <packages>
    let mut apk_add_args: Vec<&str> = vec!["/sbin/apk", "add", "--no-cache"];
    for p in &apk_packages { apk_add_args.push(p); }
    let install_out = Command::new(&proot_path)
        .args(&proot_common_args)
        .args(&apk_add_args)
        .env("PATH", "/sbin:/bin:/usr/sbin:/usr/bin")
        .env("HOME", "/root")
        .output()
        .map_err(|e| format!("apk add: {}", e))?;
    if !install_out.status.success() {
        log::warn!(
            "[OpenCode] apk add partial failure: {}\nstdout: {}",
            String::from_utf8_lossy(&install_out.stderr),
            String::from_utf8_lossy(&install_out.stdout)
        );
    }

    // ── Create wrapper scripts in runtime/bin/ for installed tools ───
    // Each wrapper invokes `proot-run <cmd> "$@"` so users can type the
    // tool name naturally (nano, git, tmux...) instead of `proot-run nano`.
    let _ = app.emit(
        "extraction-progress",
        ExtractionProgress {
            phase: "Creating command wrappers...".to_string(),
            progress: 0.95,
        },
    );

    let tool_wrappers = [
        "nano", "less", "vim",
        "git", "make", "patch",
        "tmux", "screen",
        "ssh", "scp", "sftp", "ssh-keygen", "ssh-add",
        "rsync", "wget",
        "python3", "python", "node", "npm",
        "jq", "tree", "htop", "fzf", "fd", "bat", "exa", "ripgrep",
    ];
    let proot_run_abs = wrapper_path.to_str().unwrap_or("proot-run");
    for tool in &tool_wrappers {
        let link = bin_link_dir.join(tool);
        let _ = fs::remove_file(&link);
        let wrapper_content = format!(
            "#!/system/bin/sh\nexec {proot_run} /usr/bin/{tool} \"$@\"\n",
            proot_run = proot_run_abs,
            tool = tool,
        );
        if fs::write(&link, wrapper_content).is_ok() {
            if let Ok(meta) = fs::metadata(&link) {
                let mut p = meta.permissions();
                p.set_mode(0o755);
                let _ = fs::set_permissions(&link, p);
            }
        }
    }

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

#[derive(Clone, Serialize, Debug)]
pub struct StorageRoot {
    /// Filesystem path the user can navigate into.
    pub path: String,
    /// Human-friendly label shown in the picker.
    pub label: String,
}

/// Probe the Android device for navigable storage roots.
///
/// On Android, /storage/ itself is not listable for non-system apps even
/// with MANAGE_EXTERNAL_STORAGE — so we cannot enumerate volumes by walking
/// the directory. Instead we probe each well-known and discovered candidate:
///
///  1. /storage/emulated/0     — primary internal storage (every device)
///  2. /sdcard                  — symlink to /storage/emulated/0 (kept for clarity)
///  3. /storage/<UUID>          — physical SD cards / OTG drives, discovered
///                                via getExternalFilesDirs() then walked back
///                                to the volume root
///  4. The runtime home dir     — opencode's own working directory (always)
///
/// A path is included only if it can actually be opened and read from this
/// process. The label is derived from the path (Internal storage / SD card N).
#[tauri::command]
pub async fn list_storage_roots(app: AppHandle) -> Vec<StorageRoot> {
    let mut roots: Vec<StorageRoot> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    let try_add = |path: &str, label: &str, roots: &mut Vec<StorageRoot>, seen: &mut std::collections::HashSet<String>| {
        // Canonicalize so /sdcard and /storage/emulated/0 dedupe correctly.
        let canonical = std::fs::canonicalize(path)
            .ok()
            .and_then(|p| p.to_str().map(String::from))
            .unwrap_or_else(|| path.to_string());
        if seen.contains(&canonical) {
            return;
        }
        // Probe: must be a directory and readable.
        if let Ok(meta) = std::fs::metadata(&canonical) {
            if meta.is_dir() && std::fs::read_dir(&canonical).is_ok() {
                seen.insert(canonical.clone());
                roots.push(StorageRoot {
                    path: canonical,
                    label: label.to_string(),
                });
            }
        }
    };

    // 1. Internal storage (primary, every Android device)
    try_add("/storage/emulated/0", "Internal storage", &mut roots, &mut seen);
    try_add("/sdcard", "Internal storage", &mut roots, &mut seen);

    // 2. Physical SD cards / OTG drives.
    // /storage/ cannot be listed directly, so we probe well-known mount points.
    // Most Android devices expose physical volumes under /storage/<UUID> where
    // UUID matches XXXX-XXXX (FAT32) or a longer hex string. We can't enumerate
    // them without /storage/ access, so we read /proc/mounts which IS readable
    // and shows all mounted filesystems.
    if let Ok(mounts) = std::fs::read_to_string("/proc/mounts") {
        let mut sdcard_idx = 1;
        for line in mounts.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 3 {
                continue;
            }
            let mount_point = parts[1];
            let fs_type = parts[2];
            // Only mounts under /storage/ that look like external volumes
            if !mount_point.starts_with("/storage/") {
                continue;
            }
            if mount_point == "/storage/emulated"
                || mount_point == "/storage/self"
                || mount_point.starts_with("/storage/emulated/")
            {
                continue;
            }
            // Whitelist common removable filesystems
            if !matches!(
                fs_type,
                "vfat" | "exfat" | "ntfs" | "fuseblk" | "sdcardfs" | "ext4" | "ext3" | "ext2" | "f2fs"
            ) {
                continue;
            }
            let label = if sdcard_idx == 1 {
                "SD card".to_string()
            } else {
                format!("SD card {}", sdcard_idx)
            };
            sdcard_idx += 1;
            try_add(mount_point, &label, &mut roots, &mut seen);
        }
    }

    // 3. opencode runtime home (always available, contains symlinks to Documents/storage)
    if let Some(runtime_dir) = app.path().app_data_dir().ok().map(|p| p.join(RUNTIME_SUBDIR)) {
        let home = runtime_dir.join("home");
        if let Some(home_str) = home.to_str() {
            try_add(home_str, "OpenCode home", &mut roots, &mut seen);
        }
    }

    roots
}
