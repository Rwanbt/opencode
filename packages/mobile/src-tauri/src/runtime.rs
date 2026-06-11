use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const DEFAULT_PORT: u32 = 14096;
const HEALTH_CHECK_TIMEOUT: Duration = Duration::from_secs(2);
const RUNTIME_SUBDIR: &str = "runtime";
// Bump this when the rootfs layout, wrapper scripts, or binary ABI changes
// in a way that requires a clean re-extraction. Models directory is preserved.
const RUNTIME_SCHEMA_VERSION: u32 = 1;

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
    // Health criteria: git + musl linker + libmusl_exec.so (sub-fork hook).
    // The libmusl_exec.so sentinel distinguishes the pre-built rootfs bundle
    // (which includes the hook) from older proot-based installs that lack it.
    // Absence of libmusl_exec.so → wipe + re-extract from the new rootfs.tar.gz.
    let extended_env = rootfs_dir.exists()
        && rootfs_dir.join("usr/bin/git").exists()
        && rootfs_dir.join("lib/ld-musl-aarch64.so.1").exists()
        && rootfs_dir.join("usr/lib/libmusl_exec.so").exists();
    log::info!(
        "[check_runtime] ready={} extended_env={} rootfs_exists={} git={} musl={}",
        ready,
        extended_env,
        rootfs_dir.exists(),
        rootfs_dir.join("usr/bin/git").exists(),
        rootfs_dir.join("lib/ld-musl-aarch64.so.1").exists()
    );

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

/// Recreate rootfs hardlink aliases as symlinks. Alpine ships several
/// duplicate names (`gcc-ar` ↔ `aarch64-alpine-linux-musl-gcc-ar`,
/// `g++` ↔ `aarch64-alpine-linux-musl-g++`, etc.) as hardlinks; SELinux
/// `app_data_file` blocks `link()`, so tar can't recreate them on-device.
/// We turn them into symlinks instead.
fn repair_rootfs_hardlinks(rootfs_dir: &Path) {
    let bin = rootfs_dir.join("usr/bin");
    // Each tuple is a (canonical_short, target_prefixed) pair that Alpine
    // ships as hardlinks. Whichever side tar managed to extract is the
    // "real" file; the missing side becomes a symlink to it. The direction
    // depends on tar archive ordering, which is non-deterministic — so we
    // detect at runtime instead of assuming.
    let pairs: &[(&str, &str)] = &[
        ("gcc",        "aarch64-alpine-linux-musl-gcc"),
        ("gcc-ar",     "aarch64-alpine-linux-musl-gcc-ar"),
        ("gcc-nm",     "aarch64-alpine-linux-musl-gcc-nm"),
        ("gcc-ranlib", "aarch64-alpine-linux-musl-gcc-ranlib"),
        ("c++",        "aarch64-alpine-linux-musl-c++"),
        ("cpp",        "aarch64-alpine-linux-musl-cpp"),
        ("cc",         "aarch64-alpine-linux-musl-cc"),
        ("g++",        "aarch64-alpine-linux-musl-g++"),
        ("ar",         "aarch64-alpine-linux-musl-ar"),
        ("ranlib",     "aarch64-alpine-linux-musl-ranlib"),
        ("strip",      "aarch64-alpine-linux-musl-strip"),
        ("objcopy",    "aarch64-alpine-linux-musl-objcopy"),
        ("objdump",    "aarch64-alpine-linux-musl-objdump"),
        ("nm",         "aarch64-alpine-linux-musl-nm"),
        ("as",         "aarch64-alpine-linux-musl-as"),
        ("readelf",    "aarch64-alpine-linux-musl-readelf"),
        ("addr2line",  "aarch64-alpine-linux-musl-addr2line"),
        ("size",       "aarch64-alpine-linux-musl-size"),
        ("strings",    "aarch64-alpine-linux-musl-strings"),
        ("c++filt",    "aarch64-alpine-linux-musl-c++filt"),
    ];
    for (a, b) in pairs {
        let a_path = bin.join(a);
        let b_path = bin.join(b);
        let a_exists = a_path.exists() || fs::symlink_metadata(&a_path).is_ok();
        let b_exists = b_path.exists() || fs::symlink_metadata(&b_path).is_ok();
        match (a_exists, b_exists) {
            (true, false) => { let _ = std::os::unix::fs::symlink(a, &b_path); }
            (false, true) => { let _ = std::os::unix::fs::symlink(b, &a_path); }
            _ => {}
        }
    }
}

/// Set up cargo / rustc / gcc / binutils so they run on-device despite the
/// Android 13+ `untrusted_app` SELinux policy denying `execute_no_trans` on
/// `app_data_file`.
///
/// Why this is needed:
/// musl libc resolves intra-libc calls (`execve`, `posix_spawn`) with hidden
/// visibility, so an LD_PRELOAD interposer cannot intercept the syscalls that
/// `cargo` and `rustc` use to spawn `rustc` / `cc` / `collect2` / `ld` /
/// `cc1` / `as`. Each of those targets sits in `/rootfs/...` (app_data_file)
/// and the kernel returns EACCES (reported as ENOENT by the SELinux hook).
///
/// Two-step solution:
/// 1. **In-rootfs wrap.** For every musl-ELF subprocess that is spawned by
///    absolute path (cc1, collect2, lto1, the binutils, the rustc-specific
///    LLVM tools), rename the binary to `<name>.elf64` and replace the
///    original with a shebang script `#!<nlib>/libbash_exec.so` that
///    re-execs through `<nlib>/libmusl_linker.so <name>.elf64`. The kernel's
///    binfmt_script handler exec'd into `libbash_exec.so` (which lives in
///    `nativeLibraryDir`, an apk_data_file label that *is* execute-allowed),
///    bypassing the EACCES on the script's app_data_file label.
/// 2. **Entry-point wrappers.** Generate `<cache>/wrappers/{cargo,rustc,…}`
///    shebang scripts for the toolchain binaries Cargo / the user invoke
///    directly. PATH-first prepends this dir; `RUSTC` env var hard-pins the
///    rustc wrapper for cargo.
///
/// Idempotent: skips files already wrapped (those whose `.elf64` backup
/// exists). Liblto_plugin.so is restored if it was wrapped (it must remain a
/// loadable shared library, not a script).
fn prepare_toolchain_wrappers(
    rootfs_dir: &Path,
    nlib_dir: &Path,
    cache_dir: &Path,
) -> std::io::Result<PathBuf> {
    use std::os::unix::fs::PermissionsExt;

    let bash_exec = nlib_dir.join("libbash_exec.so");
    let musl_linker = nlib_dir.join("libmusl_linker.so");

    if !bash_exec.exists() || !musl_linker.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "libbash_exec.so or libmusl_linker.so not found in nativeLibraryDir",
        ));
    }

    // Wrap one ELF binary as a shebang-script that re-execs through linker.
    // Idempotent: if `<file>.elf64` already exists we assume `file` is
    // already a wrapper script and skip. Symlinks are skipped — wrapping a
    // symlink would break the resolver chain.
    let wrap_one = |file: &Path| -> std::io::Result<()> {
        // Skip our own `.elf64` backup files — without this, a second pass
        // through the libexec directory would treat `collect2.elf64` as a
        // fresh ELF and wrap it AGAIN, producing `collect2.elf64.elf64` and
        // a wrapper script at `collect2.elf64` that the linker then can't
        // load ("Not a valid dynamic program").
        if file
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.ends_with(".elf64"))
            .unwrap_or(false)
        {
            return Ok(());
        }
        // Convention: append `.elf64` to the FULL filename so `liblto_plugin.so`
        // becomes `liblto_plugin.so.elf64` (rather than `liblto_plugin.elf64`,
        // which `with_extension` would produce).
        let backup = PathBuf::from(format!("{}.elf64", file.display()));
        let meta_res = fs::symlink_metadata(file);

        // If both `<file>` (wrapper script) and `<file>.elf64` (real ELF) exist
        // already, this is a previous wrap. Don't redo the rename — but DO
        // refresh the wrapper script: nativeLibraryDir contains the per-install
        // APK hash, so a wrapper from a prior install points to a now-dead
        // `libbash_exec.so` path and `cc: cannot execute: required file not
        // found`. Always re-write so the shebang tracks the current install.
        if backup.exists() {
            if let Ok(meta) = &meta_res {
                if meta.file_type().is_symlink() {
                    return Ok(());
                }
            }
            let script = format!(
                "#!{bash}\nexec \"{linker}\" \"{backup}\" \"$@\"\n",
                bash = bash_exec.display(),
                linker = musl_linker.display(),
                backup = backup.display(),
            );
            let _ = fs::write(file, script);
            if let Ok(mut perm) = fs::metadata(file).map(|m| m.permissions()) {
                perm.set_mode(0o755);
                let _ = fs::set_permissions(file, perm);
            }
            return Ok(());
        }

        let meta = meta_res?;
        if meta.file_type().is_symlink() {
            return Ok(());
        }
        if !meta.is_file() || meta.len() < 1024 {
            return Ok(());
        }
        let mut magic = [0u8; 4];
        {
            use std::io::Read;
            let mut f = fs::File::open(file)?;
            let _ = f.read(&mut magic);
        }
        if magic != [0x7f, b'E', b'L', b'F'] {
            return Ok(());
        }
        fs::rename(file, &backup)?;
        let script = format!(
            "#!{bash}\nexec \"{linker}\" \"{backup}\" \"$@\"\n",
            bash = bash_exec.display(),
            linker = musl_linker.display(),
            backup = backup.display(),
        );
        fs::write(file, script)?;
        let mut perm = fs::metadata(file)?.permissions();
        perm.set_mode(0o755);
        fs::set_permissions(file, perm)?;
        Ok(())
    };

    // 1. Wrap GCC libexec internals (cc1, cc1plus, collect2, lto1, …) — these
    //    are spawned by absolute path by cc/g++ and bypass any PATH wrappers.
    let libexec_root = rootfs_dir.join("usr/libexec/gcc");
    if let Ok(versions) = fs::read_dir(&libexec_root) {
        for triplet in versions.flatten() {
            if let Ok(versions2) = fs::read_dir(triplet.path()) {
                for ver in versions2.flatten() {
                    if let Ok(entries) = fs::read_dir(ver.path()) {
                        for entry in entries.flatten() {
                            let p = entry.path();
                            // Skip .so plugins (must remain dlopen-able).
                            if p.extension().and_then(|e| e.to_str()) == Some("so") {
                                continue;
                            }
                            let _ = wrap_one(&p);
                        }
                    }
                }
            }
        }
    }

    // Restore liblto_plugin.so if it was previously wrapped (must be a real .so).
    if let Ok(entries) = fs::read_dir(&libexec_root) {
        for triplet in entries.flatten() {
            if let Ok(versions) = fs::read_dir(triplet.path()) {
                for ver in versions.flatten() {
                    let lto_dir = ver.path();
                    let lto = lto_dir.join("liblto_plugin.so");
                    let lto_backup = lto_dir.join("liblto_plugin.so.elf64");
                    if lto.exists() && lto_backup.exists() {
                        // The script wrapper is at lto, the real .so is at backup
                        let is_script = fs::read(&lto)
                            .ok()
                            .map(|b| b.starts_with(b"#!"))
                            .unwrap_or(false);
                        if is_script {
                            let _ = fs::remove_file(&lto);
                            let _ = fs::rename(&lto_backup, &lto);
                        }
                    }
                }
            }
        }
    }

    // 2. Wrap binutils + target-prefixed binutils + rustc-specific LLVM tools.
    let binutils_targets = [
        "as", "ld.bfd", "ld.gold", "ar", "ranlib", "strip",
        "objcopy", "objdump", "nm", "readelf", "addr2line", "size", "strings", "c++filt",
    ];
    for name in &binutils_targets {
        let p = rootfs_dir.join("usr/bin").join(name);
        if p.exists() {
            let _ = wrap_one(&p);
        }
    }
    if let Ok(entries) = fs::read_dir(rootfs_dir.join("usr/bin")) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            if let Some(s) = name.to_str() {
                if s.starts_with("aarch64-alpine-linux-musl-")
                    && !s.ends_with(".elf64")
                {
                    let _ = wrap_one(&entry.path());
                }
            }
        }
    }
    let rustlib_bin = rootfs_dir.join("usr/lib/rustlib/aarch64-alpine-linux-musl/bin");
    if let Ok(entries) = fs::read_dir(&rustlib_bin) {
        for entry in entries.flatten() {
            let _ = wrap_one(&entry.path());
        }
    }

    // 3. Recreate `ld` symlink to ld.bfd if missing — Alpine binutils ship it
    //    as a symlink and `collect2` looks for it by bare name. Some prior
    //    wrap passes lost it.
    let ld = rootfs_dir.join("usr/bin/ld");
    let ld_bfd = rootfs_dir.join("usr/bin/ld.bfd");
    if ld_bfd.exists() && !ld.exists() {
        let _ = std::os::unix::fs::symlink("ld.bfd", &ld);
    }

    // 4. Generate /cache/wrappers/ entry-point scripts.
    let wrappers = cache_dir.join("wrappers");
    fs::create_dir_all(&wrappers)?;

    // ELF entry points (cargo, rustc, python3, …) — invoke linker directly.
    // Mix of musl ELFs and shell scripts; the is_script branch below handles both.
    let elf_tools = [
        // Existing core toolchain
        "rustc", "cargo", "python", "python3", "node", "npm", "node-gyp",
        "pip", "pip3", "rustup",
        // Phase 1 extension: debug + profiling
        "gdb", "lldb", "strace", "ltrace",
        // PHP stack
        "php", "php83", "composer",
        // SQL clients
        "sqlite3", "psql", "mysql",
        // Modern build systems
        "cmake", "ctest", "ninja", "samu", "meson", "pkgconf",
        // Go
        "go", "gofmt",
        // Ruby
        "ruby", "gem", "irb",
        // Java / JVM tooling
        "java", "javac", "jar", "gradle", "mvn",
        // Linters / formatters
        "shellcheck", "shfmt", "clang-tidy", "clang-format",
    ];
    // Resolve symlinks while keeping resolution sandboxed inside the rootfs.
    // fs::canonicalize escapes the sandbox: an absolute symlink like
    // `/usr/lib/go/bin/go` (typical for go/gradle/mvn/psql in Alpine) resolves
    // against the device root (which has no /usr/lib/go) and yields ENOENT.
    // We strip the leading slash and re-anchor at rootfs_dir instead.
    fn resolve_in_rootfs(path: &Path, rootfs: &Path) -> Option<PathBuf> {
        let mut current = path.to_path_buf();
        for _ in 0..16 {
            match fs::symlink_metadata(&current) {
                Ok(md) if md.file_type().is_symlink() => {
                    let target = fs::read_link(&current).ok()?;
                    current = if target.is_absolute() {
                        rootfs.join(target.strip_prefix("/").ok()?)
                    } else {
                        current.parent()?.join(target)
                    };
                }
                Ok(_) => return Some(current),
                Err(_) => return None,
            }
        }
        None
    }

    // Extract the interpreter basename from a `#!...` shebang line.
    // Returns None if the file has no shebang or the line is malformed.
    fn parse_shebang_interp(path: &Path) -> Option<String> {
        let buf = fs::read(path).ok()?;
        if !buf.starts_with(b"#!") {
            return None;
        }
        let line_end = buf[2..].iter().position(|&b| b == b'\n').unwrap_or(buf.len() - 2);
        let line = std::str::from_utf8(&buf[2..2 + line_end]).ok()?.trim();
        let interp_path = line.split_whitespace().next()?;
        Path::new(interp_path)
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
    }

    // LD_LIBRARY_PATH injected into every wrapper so dynamically-linked tools
    // (php, gdb, sqlite3, java, ruby, clang-tidy, …) find their .so deps in
    // the rootfs. Without this, exec succeeds but the loader bails on the
    // first DT_NEEDED. Includes llvm19/lib (clang-extra-tools) and the JDK
    // lib dir so `java` finds libjli.so + libz.so.1.
    let ld_path = format!(
        "{r}/usr/lib:{r}/lib:{r}/usr/lib/llvm19/lib:{r}/usr/lib/jvm/java-21-openjdk/lib",
        r = rootfs_dir.display()
    );

    for t in &elf_tools {
        let src = rootfs_dir.join("usr/bin").join(t);
        let real = match resolve_in_rootfs(&src, rootfs_dir) {
            Some(r) => r,
            None => continue,
        };
        let head = fs::read(&real).ok();
        let is_script = head
            .as_ref()
            .map(|b| b.starts_with(b"#!"))
            .unwrap_or(false);
        // Statically-linked ELFs (e.g. Go binaries) have no PT_INTERP, so the
        // "ld-musl" string never appears in their headers. They cannot be run
        // via libmusl_linker.so (which expects a dynamic ELF to mmap+relocate)
        // and SELinux blocks direct execve from app_data_file. Skip them — a
        // user-facing wrapper that just errors is worse than no wrapper.
        // Static ELFs (Go binaries: go, gofmt, shfmt) have no PT_INTERP and
        // can't run via libmusl_linker.so (which expects a dynamic ELF). Parse
        // the ELF program headers and look for a PT_INTERP entry — this is
        // more robust than scanning for the "ld-musl" string, which has false
        // negatives (shfmt embeds the literal in a data section even though
        // it's static) and required a full-file scan to avoid false positives
        // on Rust binaries (cargo/rustc keep the interp past the first 2 KB).
        fn is_static_elf64(buf: &[u8]) -> bool {
            if buf.len() < 64 || &buf[..4] != b"\x7fELF" || buf[4] != 2 {
                return false;
            }
            let to_u64 = |o: usize| u64::from_le_bytes(buf[o..o + 8].try_into().unwrap()) as usize;
            let to_u16 = |o: usize| u16::from_le_bytes(buf[o..o + 2].try_into().unwrap()) as usize;
            let phoff = to_u64(0x20);
            let phentsize = to_u16(0x36);
            let phnum = to_u16(0x38);
            if phoff == 0 || phentsize == 0 || phnum == 0 {
                return false;
            }
            let table_end = phoff.saturating_add(phnum.saturating_mul(phentsize));
            if table_end > buf.len() {
                return false;
            }
            for i in 0..phnum {
                let off = phoff + i * phentsize;
                let p_type = u32::from_le_bytes(buf[off..off + 4].try_into().unwrap());
                if p_type == 3 {
                    return false; // PT_INTERP found → dynamic
                }
            }
            true
        }
        let is_static_elf = head.as_ref().map(|b| is_static_elf64(b)).unwrap_or(false);
        if is_static_elf {
            log::info!(
                "[wrap] skip {} — static ELF (cannot run via libmusl_linker)",
                t
            );
            continue;
        }
        let script = if is_script {
            // Map the script's shebang interpreter to one of our generated
            // wrappers (or libbash_exec.so for sh scripts). Three issues we
            // dodge by re-routing instead of letting the kernel re-exec the
            // shebang directly:
            //   1. /bin/sh on Android = Bionic /system/bin/sh which honors
            //      LD_LIBRARY_PATH and CANNOT_LINK against musl libc when our
            //      LD_LIBRARY_PATH is exported. Sending sh scripts through
            //      libbash_exec.so (bash-as-shared-lib in nativeLibraryDir)
            //      bypasses Bionic entirely.
            //   2. /usr/bin/env doesn't exist on Android, so `#!/usr/bin/env
            //      python3` would fail at the kernel binfmt_script step.
            //   3. /usr/bin/python3 etc. point at the device root, not the
            //      rootfs. Routing through wrappers/python3 hits the rootfs
            //      ELF with the proper LD_LIBRARY_PATH already set in that
            //      wrapper.
            // Also: do NOT export LD_LIBRARY_PATH at the script level. Any
            // sub-binary the script spawns is itself wrapped (cargo, java,
            // php, …); each wrapper sets its own. Exporting here propagates
            // the path into Bionic /bin/sh sub-shells and breaks them.
            let shebang_interp = parse_shebang_interp(&real);
            let interp_path: Option<String> = shebang_interp.as_deref().and_then(|name| {
                match name {
                    "sh" | "bash" => Some(bash_exec.display().to_string()),
                    "env" => None,
                    other => {
                        let w = wrappers.join(other);
                        if rootfs_dir.join("usr/bin").join(other).exists() {
                            Some(w.display().to_string())
                        } else {
                            None
                        }
                    }
                }
            });
            match interp_path {
                Some(interp) => format!(
                    "#!{bash}\nexec \"{interp}\" \"{real}\" \"$@\"\n",
                    bash = bash_exec.display(),
                    interp = interp,
                    real = real.display(),
                ),
                None => format!(
                    "#!{bash}\nexec \"{real}\" \"$@\"\n",
                    bash = bash_exec.display(),
                    real = real.display(),
                ),
            }
        } else {
            format!(
                "#!{bash}\nexport LD_LIBRARY_PATH=\"{ld}:${{LD_LIBRARY_PATH}}\"\nexec \"{linker}\" \"{real}\" \"$@\"\n",
                bash = bash_exec.display(),
                ld = ld_path,
                linker = musl_linker.display(),
                real = real.display(),
            )
        };
        let dst = wrappers.join(t);
        fs::write(&dst, script)?;
        let mut perm = fs::metadata(&dst)?.permissions();
        perm.set_mode(0o755);
        fs::set_permissions(&dst, perm)?;
    }

    // Script entry points (cc, gcc, g++, binutils …) — already wrapped in
    // rootfs by the wrap_one pass; just delegate via libbash_exec.so so the
    // kernel binfmt_script handler does the dance.
    let script_tools = [
        "gcc", "g++", "cc", "ar", "as", "ld", "ld.bfd", "ranlib", "strip",
        "objcopy", "objdump", "nm", "cpp", "c++",
    ];
    for t in &script_tools {
        let src = rootfs_dir.join("usr/bin").join(t);
        if !src.exists() {
            continue;
        }
        let script = format!(
            "#!{bash}\nexec \"{src}\" \"$@\"\n",
            bash = bash_exec.display(),
            src = src.display(),
        );
        let dst = wrappers.join(t);
        fs::write(&dst, script)?;
        let mut perm = fs::metadata(&dst)?.permissions();
        perm.set_mode(0o755);
        fs::set_permissions(&dst, perm)?;
    }

    Ok(wrappers)
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

/// Extract the pre-built Alpine rootfs from the bundled APK asset.
/// Replaces the previous proot + runtime `apk add` approach which failed on
/// Android 15 / HyperOS (SDK 36 strict SELinux: execute_no_trans denied on
/// app_data_file for untrusted_app). The pre-built rootfs includes all dev
/// tools + libmusl_exec.so (musl-compiled LD_PRELOAD hook for sub-fork fix).
#[tauri::command]
pub async fn install_extended_env(app: AppHandle) -> Result<(), String> {
    log::info!("[install_ext] ENTRY");
    let dir = runtime_dir(&app);
    let rootfs_dir = dir.join("rootfs");

    // Health sentinels — all three must be present for a complete install:
    //   git        : confirms apk packages were installed
    //   ld-musl-*  : musl dynamic linker present (required to exec Alpine ELFs)
    //   libmusl_exec.so : LD_PRELOAD sub-fork hook (absent in proot-era rootfs)
    let git_bin   = rootfs_dir.join("usr/bin/git");
    let ld_musl   = rootfs_dir.join("lib/ld-musl-aarch64.so.1");
    let musl_exec = rootfs_dir.join("usr/lib/libmusl_exec.so");
    let rootfs_exists = rootfs_dir.exists();
    let complete = rootfs_exists && git_bin.exists() && ld_musl.exists() && musl_exec.exists();

    log::info!(
        "[install_ext] rootfs_exists={} git={} musl={} musl_exec={}",
        rootfs_exists, git_bin.exists(), ld_musl.exists(), musl_exec.exists()
    );

    if complete {
        log::info!("[install_ext] rootfs already complete, skip");
        return Ok(());
    }

    // Wipe unhealthy/stale rootfs (proot-era or partial extract) and
    // re-extract from the pre-built tar.gz. Safe: rootfs has no user state.
    if rootfs_exists {
        log::warn!("[install_ext] rootfs unhealthy or stale — wiping for fresh extract");
        if let Err(e) = fs::remove_dir_all(&rootfs_dir) {
            log::warn!("[install_ext] wipe failed: {} (continuing anyway)", e);
        }
    }

    let _ = app.emit(
        "extraction-progress",
        ExtractionProgress {
            phase: "Preparing rootfs...".to_string(),
            progress: 0.1,
        },
    );

    // rootfs.tar.gz is copied from APK assets by RuntimeExtractor.kt on first launch.
    let rootfs_tar = dir.join("rootfs.tar.gz");
    if !rootfs_tar.exists() {
        return Err(
            "rootfs.tar.gz not found in runtime dir. Reinstall the app.".to_string()
        );
    }

    fs::create_dir_all(&rootfs_dir).map_err(|e| format!("mkdir rootfs: {}", e))?;

    let _ = app.emit(
        "extraction-progress",
        ExtractionProgress {
            phase: "Unpacking pre-built rootfs (~80 MB, 30-60 s)...".to_string(),
            progress: 0.3,
        },
    );

    // Extract: entries in rootfs.tar.gz are relative (./usr/bin/git etc.)
    // so tar extracts directly into rootfs_dir without needing --strip-components.
    let tar_bin = if Path::new("/system/bin/tar").exists() {
        "/system/bin/tar"
    } else {
        "tar"
    };
    log::info!("[install_ext] extracting {} via {}", rootfs_tar.display(), tar_bin);

    let output = Command::new(tar_bin)
        .args(["-xzf", rootfs_tar.to_str().unwrap_or("")])
        .current_dir(&rootfs_dir)
        .output()
        .map_err(|e| format!("tar spawn: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // SELinux on Android denies link() under app_data_file, so rootfs.tgz
        // hardlinks (gcc-ar→aarch64-…-gcc-ar etc.) abort tar. Treat as
        // non-fatal: most files still extracted, missing hardlinks are
        // recreated as symlinks below in repair_rootfs_hardlinks.
        log::warn!(
            "[install_ext] tar reported errors (treated as non-fatal): {}",
            stderr.trim()
        );
    }
    log::info!("[install_ext] rootfs extracted to {}", rootfs_dir.display());

    // Repair: tar's failed hardlinks left aliases like `aarch64-…-gcc-ar`
    // missing while the canonical `gcc-ar` is present. Re-create as symlinks.
    repair_rootfs_hardlinks(&rootfs_dir);

    // Seed /etc/resolv.conf so git-http, wget, pip etc. can resolve DNS.
    let _ = fs::create_dir_all(rootfs_dir.join("etc"));
    let _ = fs::write(
        rootfs_dir.join("etc/resolv.conf"),
        "nameserver 8.8.8.8\nnameserver 8.8.4.4\nnameserver 1.1.1.1\n",
    );

    let _ = app.emit(
        "extraction-progress",
        ExtractionProgress {
            phase: "Extended environment ready!".to_string(),
            progress: 1.0,
        },
    );

    let final_git = git_bin.exists();
    let final_exec = musl_exec.exists();
    log::info!(
        "[install_ext] DONE git={} libmusl_exec={}",
        final_git, final_exec
    );

    if !final_git {
        return Err(
            "rootfs extracted but git is missing — rebuild APK with a fresh rootfs.tar.gz.".to_string()
        );
    }
    if !final_exec {
        return Err(
            "rootfs extracted but libmusl_exec.so is missing — rebuild rootfs with build-alpine-rootfs.sh.".to_string()
        );
    }

    // Bake the toolchain wrappers immediately after extraction so cargo /
    // rustc / gcc are usable without a server restart. start_embedded_server
    // also calls this — both are idempotent. Rationale: the very first
    // launch goes through ExtractionProgress (this command) → onComplete →
    // start_embedded_server. If the user's UI flow ever inverts that order
    // (warm restart against a fresh rootfs), the wrappers still get created.
    if let Some(nlib) = native_lib_dir(&dir) {
        let cache_dir = dir.join("home").join(".cache");
        let _ = fs::create_dir_all(&cache_dir);
        match prepare_toolchain_wrappers(&rootfs_dir, &nlib, &cache_dir) {
            Ok(p) => log::info!("[install_ext] toolchain wrappers ready at {}", p.display()),
            Err(e) => log::warn!("[install_ext] prepare_toolchain_wrappers failed: {}", e),
        }
    }

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

/// Check if the runtime binaries are present, ignoring schema version.
/// Used during the extraction polling loop before write_schema_version is called.
fn is_ready_without_schema_check(dir: &Path) -> bool {
    dir.join("opencode-cli.js").exists()
        && dir.join(".native_lib_dir").exists()
        && native_lib_dir(dir).map(|d| d.join("libbun_exec.so").exists()).unwrap_or(false)
}

fn is_runtime_ready(dir: &Path) -> bool {
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

pub(crate) async fn check_health(port: u32, password: Option<&str>) -> bool {
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

// runtime.rs uses Unix-specific APIs (set_mode, forkpty, etc.) so tests only
// compile and run on Android/Linux targets — not on Windows dev machines.
#[cfg(all(test, target_os = "android"))]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn temp_test_dir(name: &str) -> std::path::PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("opencode_test_{}_{}", name, n));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // ─── is_ready_without_schema_check ───────────────────────────────

    #[test]
    fn is_ready_without_schema_check_missing_all_files() {
        let dir = temp_test_dir("no_files");
        let result = is_ready_without_schema_check(&dir);
        let _ = std::fs::remove_dir_all(&dir);
        assert!(!result, "empty dir should return false");
    }

    #[test]
    fn is_ready_without_schema_check_missing_native_lib_dir() {
        let dir = temp_test_dir("missing_nld");
        // Create opencode-cli.js but NOT .native_lib_dir
        std::fs::write(dir.join("opencode-cli.js"), b"// cli").unwrap();
        let result = is_ready_without_schema_check(&dir);
        let _ = std::fs::remove_dir_all(&dir);
        assert!(!result, "missing .native_lib_dir should return false");
    }

    #[test]
    fn is_ready_without_schema_check_ok() {
        let dir = temp_test_dir("ok");
        // Create a fake nativeLibraryDir with libbun_exec.so
        let nlib_dir = temp_test_dir("nlib_ok");
        std::fs::write(nlib_dir.join("libbun_exec.so"), b"ELF").unwrap();

        std::fs::write(dir.join("opencode-cli.js"), b"// cli").unwrap();
        std::fs::write(dir.join(".native_lib_dir"), nlib_dir.to_str().unwrap()).unwrap();

        let result = is_ready_without_schema_check(&dir);
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&nlib_dir);
        assert!(result, "all required files present should return true");
    }

    // ─── write_schema_version ────────────────────────────────────────

    #[test]
    fn write_schema_version_creates_file() {
        let dir = temp_test_dir("schema_write");
        write_schema_version(&dir);
        let content = std::fs::read_to_string(dir.join(".schema_version"))
            .expect(".schema_version should exist after write_schema_version");
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(
            content.trim(),
            RUNTIME_SCHEMA_VERSION.to_string(),
            ".schema_version should contain the current RUNTIME_SCHEMA_VERSION"
        );
    }

    // ─── is_runtime_ready ────────────────────────────────────────────

    /// Helper: populate `dir` with the minimal structure for is_runtime_ready,
    /// using `nlib_dir` as the nativeLibraryDir (must contain libbun_exec.so).
    fn setup_runtime_files(dir: &Path, nlib_dir: &Path) {
        std::fs::write(dir.join("opencode-cli.js"), b"// cli").unwrap();
        std::fs::write(dir.join(".native_lib_dir"), nlib_dir.to_str().unwrap()).unwrap();
        std::fs::write(nlib_dir.join("libbun_exec.so"), b"ELF").unwrap();
    }

    #[test]
    fn is_runtime_ready_no_schema_version() {
        let dir = temp_test_dir("rr_no_schema");
        let nlib_dir = temp_test_dir("rr_no_schema_nlib");
        setup_runtime_files(&dir, &nlib_dir);

        // Create rootfs so we can verify it gets removed
        let rootfs = dir.join("rootfs");
        std::fs::create_dir_all(&rootfs).unwrap();

        // .schema_version is absent — should return false
        let result = is_runtime_ready(&dir);

        let rootfs_still_exists = rootfs.exists();
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&nlib_dir);

        assert!(!result, "missing .schema_version should return false");
        assert!(
            !rootfs_still_exists,
            "is_runtime_ready should wipe rootfs when schema version is missing"
        );
    }

    #[test]
    fn is_runtime_ready_wrong_schema_version() {
        let dir = temp_test_dir("rr_wrong_schema");
        let nlib_dir = temp_test_dir("rr_wrong_schema_nlib");
        setup_runtime_files(&dir, &nlib_dir);
        // Write an old/wrong schema version
        std::fs::write(dir.join(".schema_version"), b"0").unwrap();

        let result = is_runtime_ready(&dir);
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&nlib_dir);

        assert!(!result, "outdated .schema_version should return false");
    }

    #[test]
    fn is_runtime_ready_correct_schema_version() {
        let dir = temp_test_dir("rr_ok");
        let nlib_dir = temp_test_dir("rr_ok_nlib");
        setup_runtime_files(&dir, &nlib_dir);
        // Write the current schema version
        std::fs::write(
            dir.join(".schema_version"),
            RUNTIME_SCHEMA_VERSION.to_string(),
        )
        .unwrap();

        let result = is_runtime_ready(&dir);
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&nlib_dir);

        assert!(result, "correct .schema_version and all files should return true");
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
