use serde::{Deserialize, Serialize};
#[allow(unused_imports)]
use std::fs;
#[allow(unused_imports)]
use std::path::{Path, PathBuf};
#[allow(unused_imports)]
use std::process::{Child, Command, Stdio};
#[allow(unused_imports)]
use std::sync::Mutex;
#[allow(unused_imports)]
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

// D-01 step 1: the on-device toolchain wrapper cluster (rootfs hardlink repair,
// the logged symlink helper, and the cargo/rustc/gcc shebang wrappers) lives in
// `runtime/toolchain.rs`. Re-imported here so `start_embedded_server` /
// `install_extended_env` and `mod tests` keep calling them unqualified.
//
// The module is gated to Unix (C-008) — every entry point uses `std::os::unix`
// or `PermissionsExt::set_mode`. Windows hosts don't have those, so the mod
// decl + re-import are Unix-only too.
#[cfg(unix)]
mod toolchain;
#[cfg(unix)]
use toolchain::{force_symlink, prepare_toolchain_wrappers, repair_rootfs_hardlinks};

// D-01 step 3: runtime extraction + readiness/schema gating lives in
// `runtime/extraction.rs`. `extract_runtime` is re-exported for the Tauri
// handler (`runtime::extract_runtime`); `is_runtime_ready` / `write_schema_version`
// are re-imported because `check_runtime` and the tests still call them.
mod extraction;
// Re-exported so lib.rs's `generate_handler!` can reference
// `runtime::extract_runtime`. That handler is `#[cfg(target_os = "android")]`,
// so on host/test builds this re-export has no user — hence the allow.
#[allow(unused_imports)]
// NOTE: re-export the `#[tauri::command]` companion macro `__cmd__*` alongside
// the fn — `generate_handler![runtime::extract_runtime]` in lib.rs (android-only,
// so the host test build never exercises it) resolves `runtime::__cmd__extract_runtime`.
// Re-exporting only the fn left the companion in the submodule → E0433 at APK build.
pub use extraction::{__cmd__extract_runtime, extract_runtime};
use extraction::is_runtime_ready;

const DEFAULT_PORT: u32 = 14096;
const HEALTH_CHECK_TIMEOUT: Duration = Duration::from_secs(2);
const RUNTIME_SUBDIR: &str = "runtime";
// Bump this when the rootfs layout, wrapper scripts, or binary ABI changes
// in a way that requires a clean re-extraction. Models directory is preserved.
const RUNTIME_SCHEMA_VERSION: u32 = 1;

// D-01 step 2: the embedded-server lifecycle (start/stop/health/logs + the
// SERVER_PROCESS / single-flight statics) lives in `runtime/server.rs`. The
// commands are re-exported so lib.rs's android-only generate_handler! can still
// reference `runtime::start_embedded_server` etc.
//
// `start_embedded_server` and `__cmd__start_embedded_server` are Unix-only
// (C-008 — they pull in the toolchain Unix APIs via setup_*_symlinks).
#[cfg(unix)]
mod server;
#[cfg(unix)]
#[allow(unused_imports)]
pub use server::{
    __cmd__check_local_health, __cmd__read_server_logs, __cmd__start_embedded_server,
    __cmd__stop_local_server, check_local_health, read_server_logs, start_embedded_server,
    stop_local_server,
};

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

// D-01 step 3: extract_runtime (with its doc) moved to runtime/extraction.rs
// (re-exported via `pub use extraction::extract_runtime` at the top of this file).

// D-01 step 1: repair_rootfs_hardlinks, force_symlink, and
// prepare_toolchain_wrappers moved verbatim to runtime/toolchain.rs and
// re-imported via the `mod toolchain` / `use toolchain::{…}` at the top of
// this file. They had no outgoing dependency on the rest of `runtime`.

/// Extract the pre-built Alpine rootfs from the bundled APK asset.
/// Replaces the previous proot + runtime `apk add` approach which failed on
/// Android 15 / HyperOS (SDK 36 strict SELinux: execute_no_trans denied on
/// app_data_file for untrusted_app). The pre-built rootfs includes all dev
/// tools + libmusl_exec.so (musl-compiled LD_PRELOAD hook for sub-fork fix).
#[tauri::command]
#[cfg(unix)]
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
    // A silent failure here surfaces much later as a confusing "could not
    // resolve host" deep inside git/pip — log it so it's greppable in logcat.
    if let Err(e) = fs::create_dir_all(rootfs_dir.join("etc")) {
        log::warn!("[install_ext] failed to create rootfs /etc dir: {}", e);
    }
    if let Err(e) = fs::write(
        rootfs_dir.join("etc/resolv.conf"),
        "nameserver 8.8.8.8\nnameserver 8.8.4.4\nnameserver 1.1.1.1\n",
    ) {
        log::warn!(
            "[install_ext] failed to seed /etc/resolv.conf: {} — on-device DNS (git/pip/wget) will fail",
            e
        );
    }

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

    // Extraction verified complete: the ~786 MB compressed archive is now
    // pure dead weight (rootfs/ already holds everything it contained) and
    // was never being deleted, permanently wasting that space on every
    // device after every fresh extraction. Best-effort: a failed delete
    // isn't fatal, just leaves the waste for next time.
    if let Err(e) = fs::remove_file(&rootfs_tar) {
        log::warn!("[install_ext] failed to remove rootfs.tar.gz after extraction: {}", e);
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

// D-01 step 3: check_extraction_progress moved to runtime/extraction.rs.

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

// D-01 step 3: is_ready_without_schema_check, is_runtime_ready, and
// write_schema_version moved to runtime/extraction.rs. is_runtime_ready and
// write_schema_version are re-imported at the top of this file (used by
// check_runtime and the tests); is_ready_without_schema_check is reached by the
// tests via `super::extraction`.

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

// runtime.rs uses Unix-specific APIs (set_mode, symlink, etc.) so tests only
// compile and run on Unix targets (Android + Linux/macOS CI) — not on Windows
// dev machines. Previously gated to Android only, which made the suite
// unrunnable in CI; now host-runnable so the FS-pure logic is actually
// exercised. (D-21)
#[cfg(all(test, unix))]
mod tests {
    use super::*;
    // These live in the extraction submodule and have no non-test caller in
    // `runtime`, so they are not re-imported at module scope — reach them here.
    use super::extraction::{is_ready_without_schema_check, write_schema_version};
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

    // ─── prepare_toolchain_wrappers idempotence (D-16) ───────────────
    //
    // The wrap pass renames an ELF to `<name>.elf64` and replaces it with a
    // shebang script. The documented invariant is that re-running never
    // double-wraps (`<name>.elf64.elf64`) nor corrupts the backed-up ELF —
    // this is load-bearing because extraction can run more than once per
    // install. See the shebang/LD_PRELOAD chain in
    // docs/KNOWN_FAILURE_PATTERNS.md.

    #[test]
    fn prepare_toolchain_wrappers_is_idempotent() {
        let base = temp_test_dir("wrap_idem");
        let rootfs = base.join("rootfs");
        let nlib = base.join("nlib");
        let cache = base.join("cache");
        std::fs::create_dir_all(&nlib).unwrap();
        std::fs::create_dir_all(&cache).unwrap();
        std::fs::create_dir_all(rootfs.join("usr/bin")).unwrap();

        // Interposer libs must exist or the function bails early.
        std::fs::write(nlib.join("libbash_exec.so"), b"stub").unwrap();
        std::fs::write(nlib.join("libmusl_linker.so"), b"stub").unwrap();

        // A fake ELF deep in the gcc libexec tree: ELF magic + >= 1024 bytes.
        let libexec = rootfs.join("usr/libexec/gcc/aarch64-alpine-linux-musl/13.2.0");
        std::fs::create_dir_all(&libexec).unwrap();
        let cc1 = libexec.join("cc1");
        let mut elf = vec![0x7f, b'E', b'L', b'F'];
        elf.resize(elf.len() + 2048, 0u8);
        std::fs::write(&cc1, &elf).unwrap();

        // First pass: cc1 becomes a script, original bytes saved to cc1.elf64.
        prepare_toolchain_wrappers(&rootfs, &nlib, &cache).expect("first pass should succeed");
        let backup = libexec.join("cc1.elf64");
        assert!(backup.exists(), "first pass should create the .elf64 backup");
        assert_eq!(
            std::fs::read(&backup).unwrap(),
            elf,
            "backup must hold the original ELF bytes"
        );
        assert!(
            std::fs::read_to_string(&cc1).unwrap().starts_with("#!"),
            "cc1 must become a shebang script"
        );

        // Second pass must not double-wrap nor mangle the backup.
        prepare_toolchain_wrappers(&rootfs, &nlib, &cache).expect("second pass should succeed");
        assert!(
            !libexec.join("cc1.elf64.elf64").exists(),
            "second pass must not create cc1.elf64.elf64"
        );
        assert_eq!(
            std::fs::read(&backup).unwrap(),
            elf,
            "backup bytes must be unchanged after the second pass"
        );
        assert!(
            std::fs::read_to_string(&cc1).unwrap().starts_with("#!"),
            "cc1 must remain a shebang script after the second pass"
        );

        let _ = std::fs::remove_dir_all(&base);
    }

    // ─── repair_rootfs_hardlinks / force_symlink (D-09 / D-12 / D-13) ──
    //
    // SELinux blocks tar from recreating Alpine's hardlinked toolchain
    // duplicates on-device, so repair_rootfs_hardlinks turns whichever side
    // survived extraction into a symlink. These cover both directions and the
    // symlink-recreation helper.

    #[test]
    fn repair_rootfs_hardlinks_links_missing_prefixed_name() {
        let base = temp_test_dir("repair_fwd");
        let bin = base.join("usr/bin");
        std::fs::create_dir_all(&bin).unwrap();
        // Only the short canonical name survived extraction.
        std::fs::write(bin.join("gcc"), b"ELF").unwrap();

        repair_rootfs_hardlinks(&base);

        let prefixed = bin.join("aarch64-alpine-linux-musl-gcc");
        let md = std::fs::symlink_metadata(&prefixed).expect("prefixed name should exist");
        assert!(md.file_type().is_symlink(), "missing prefixed name must become a symlink");

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn repair_rootfs_hardlinks_links_missing_short_name() {
        let base = temp_test_dir("repair_rev");
        let bin = base.join("usr/bin");
        std::fs::create_dir_all(&bin).unwrap();
        // Only the prefixed name survived extraction.
        std::fs::write(bin.join("aarch64-alpine-linux-musl-g++"), b"ELF").unwrap();

        repair_rootfs_hardlinks(&base);

        let short = bin.join("g++");
        let md = std::fs::symlink_metadata(&short).expect("short name should exist");
        assert!(md.file_type().is_symlink(), "missing short name must become a symlink");

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn repair_rootfs_hardlinks_no_panic_when_both_absent() {
        let base = temp_test_dir("repair_none");
        std::fs::create_dir_all(base.join("usr/bin")).unwrap();
        // Neither side present — must not panic and must not fabricate files.
        repair_rootfs_hardlinks(&base);
        assert!(!base.join("usr/bin/gcc").exists());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn force_symlink_replaces_stale_link() {
        let base = temp_test_dir("force_link");
        std::fs::create_dir_all(&base).unwrap();
        let old_target = base.join("old");
        let new_target = base.join("new");
        std::fs::write(&old_target, b"old").unwrap();
        std::fs::write(&new_target, b"new").unwrap();
        let link = base.join("link");

        force_symlink(&old_target, &link);
        assert_eq!(std::fs::read_link(&link).unwrap(), old_target);

        // Re-pointing an existing link must replace it, not fail.
        force_symlink(&new_target, &link);
        assert_eq!(std::fs::read_link(&link).unwrap(), new_target);
        assert_eq!(std::fs::read_to_string(&link).unwrap(), "new");

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn prepare_toolchain_wrappers_errors_without_interposer_libs() {
        let base = temp_test_dir("wrap_no_libs");
        let rootfs = base.join("rootfs");
        let nlib = base.join("nlib"); // intentionally missing libbash_exec.so
        let cache = base.join("cache");
        std::fs::create_dir_all(&nlib).unwrap();
        std::fs::create_dir_all(&cache).unwrap();

        let err = prepare_toolchain_wrappers(&rootfs, &nlib, &cache);
        assert!(err.is_err(), "must fail when interposer libs are absent");

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn prepare_toolchain_wrappers_skips_so_and_small_files() {
        let base = temp_test_dir("wrap_skip");
        let rootfs = base.join("rootfs");
        let nlib = base.join("nlib");
        let cache = base.join("cache");
        std::fs::create_dir_all(&nlib).unwrap();
        std::fs::create_dir_all(&cache).unwrap();
        std::fs::create_dir_all(rootfs.join("usr/bin")).unwrap();
        std::fs::write(nlib.join("libbash_exec.so"), b"stub").unwrap();
        std::fs::write(nlib.join("libmusl_linker.so"), b"stub").unwrap();

        let libexec = rootfs.join("usr/libexec/gcc/aarch64-alpine-linux-musl/13.2.0");
        std::fs::create_dir_all(&libexec).unwrap();
        // A .so plugin must stay a real shared library (dlopen-able), never wrapped.
        let plugin = libexec.join("liblto_plugin.so");
        let mut so_bytes = vec![0x7f, b'E', b'L', b'F'];
        so_bytes.resize(so_bytes.len() + 2048, 0u8);
        std::fs::write(&plugin, &so_bytes).unwrap();
        // A tiny "ELF" below the 1024-byte threshold must be skipped.
        let tiny = libexec.join("tinytool");
        std::fs::write(&tiny, b"\x7fELFsmall").unwrap();

        prepare_toolchain_wrappers(&rootfs, &nlib, &cache).expect("should succeed");

        assert!(!libexec.join("liblto_plugin.so.elf64").exists(), ".so must not be wrapped");
        assert_eq!(std::fs::read(&plugin).unwrap(), so_bytes, ".so bytes must be untouched");
        assert!(!libexec.join("tinytool.elf64").exists(), "sub-1KB file must not be wrapped");

        let _ = std::fs::remove_dir_all(&base);
    }

    // ─── repair_rootfs_hardlinks equivalence groups (D-13) ───────────
    //
    // Regression for the on-device c++ gap (Mi 10 Pro): SELinux blocks tar's
    // link() on app_data_file, so only one member of each hardlink set
    // survives extraction. The repair must self-heal the whole equivalence
    // group from whichever member survived — including backing `c++` with a
    // surviving `g++` (same driver), which the old per-pair logic could not.

    /// `<rootfs>/usr/bin` with `names` as real files. Returns (rootfs, bin).
    fn rootfs_with_bins(tag: &str, names: &[&str]) -> (std::path::PathBuf, std::path::PathBuf) {
        let rootfs = temp_test_dir(tag);
        let bin = rootfs.join("usr/bin");
        std::fs::create_dir_all(&bin).unwrap();
        for n in names {
            std::fs::write(bin.join(n), b"\x7fELF").unwrap();
        }
        (rootfs, bin)
    }

    /// True if `p` resolves (following symlinks) to a regular file.
    fn resolves(p: &Path) -> bool {
        std::fs::metadata(p).map(|m| m.is_file()).unwrap_or(false)
    }

    /// True if `p` is itself a symlink (regardless of whether it resolves).
    fn is_symlink(p: &Path) -> bool {
        std::fs::symlink_metadata(p)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false)
    }

    #[test]
    fn repair_hardlinks_cpp_group_heals_from_gpp() {
        // Only g++ survived — the exact device case that left c++ broken.
        let (rootfs, bin) = rootfs_with_bins("hl_cpp", &["g++"]);
        repair_rootfs_hardlinks(&rootfs);

        for name in ["c++", "aarch64-alpine-linux-musl-c++", "aarch64-alpine-linux-musl-g++"] {
            assert!(resolves(&bin.join(name)), "{name} should resolve after repair");
            assert!(is_symlink(&bin.join(name)), "{name} should be a symlink");
        }
        // The created symlinks must point at the surviving driver, not dangle.
        assert_eq!(std::fs::read_link(bin.join("c++")).unwrap(), Path::new("g++"));

        let _ = std::fs::remove_dir_all(&rootfs);
    }

    #[test]
    fn repair_hardlinks_c_group_heals_from_prefixed_gcc() {
        // Only the prefixed gcc survived → gcc, cc, prefixed-cc must self-heal.
        let (rootfs, bin) = rootfs_with_bins("hl_c", &["aarch64-alpine-linux-musl-gcc"]);
        repair_rootfs_hardlinks(&rootfs);

        for name in ["gcc", "cc", "aarch64-alpine-linux-musl-cc"] {
            assert!(resolves(&bin.join(name)), "{name} should resolve after repair");
        }
        let _ = std::fs::remove_dir_all(&rootfs);
    }

    #[test]
    fn repair_hardlinks_repairs_dangling_symlink() {
        // c++ extracted as a hardlink-turned-dangling-symlink to a name that
        // never made it; repair must re-point it at the live survivor.
        let (rootfs, bin) = rootfs_with_bins("hl_dangle", &["g++"]);
        std::os::unix::fs::symlink("does-not-exist", bin.join("c++")).unwrap();
        assert!(!resolves(&bin.join("c++")), "precondition: c++ dangles");

        repair_rootfs_hardlinks(&rootfs);

        assert!(resolves(&bin.join("c++")), "dangling c++ should be repaired");
        assert_eq!(std::fs::read_link(bin.join("c++")).unwrap(), Path::new("g++"));
        let _ = std::fs::remove_dir_all(&rootfs);
    }

    #[test]
    fn repair_hardlinks_empty_group_does_not_panic() {
        // No compiler survived at all — must degrade gracefully (warn, no panic,
        // no bogus symlink) so the CRITICAL check can report it.
        let (rootfs, bin) = rootfs_with_bins("hl_empty", &[]);
        repair_rootfs_hardlinks(&rootfs);
        assert!(!resolves(&bin.join("c++")), "absent c++ must stay absent");
        assert!(!bin.join("c++").exists(), "no bogus c++ symlink should be created");
        let _ = std::fs::remove_dir_all(&rootfs);
    }

    #[test]
    fn repair_hardlinks_leaves_existing_real_files_untouched() {
        // When both names survived as real files, repair must not overwrite
        // either with a symlink.
        let (rootfs, bin) = rootfs_with_bins("hl_both", &["g++", "c++"]);
        repair_rootfs_hardlinks(&rootfs);
        assert!(!is_symlink(&bin.join("g++")), "real g++ must stay a real file");
        assert!(!is_symlink(&bin.join("c++")), "real c++ must stay a real file");
        let _ = std::fs::remove_dir_all(&rootfs);
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
