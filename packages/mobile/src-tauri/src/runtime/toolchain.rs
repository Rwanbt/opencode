//! On-device toolchain wrapper setup (extracted from `runtime.rs` — D-01 step 1).
//!
//! Self-contained cluster lifted verbatim from the former `runtime.rs` god file:
//! rootfs hardlink repair, the logged symlink helper, and the shebang +
//! `LD_PRELOAD` wrapper generation that lets cargo / rustc / gcc run under
//! Android's `untrusted_app` SELinux policy. It has **no outgoing dependency**
//! on the rest of `runtime` (only `std` + `log`), so it moves cleanly.
//!
//! `use super::*` re-imports the parent's `std::fs` / `std::path` aliases; the
//! three entry points are `pub(super)` so `start_embedded_server` /
//! `install_extended_env` (still in `runtime.rs`) and the `mod tests` can call
//! them through `runtime`'s `use toolchain::{…}` re-export.
//!
//! File gated to Unix (C-008): every entry point here uses `std::os::unix` or
//! `PermissionsExt::set_mode`, neither of which exists on Windows. On Windows
//! `cargo clippy --all-targets` would otherwise fail with E0433 / E0599 in the
//! host `cfg(test)` build. Tests in `runtime.rs` that call these entry points
//! carry their own `#[cfg(unix)]` so the Windows test set skips them cleanly.
#![cfg(unix)]

use super::*;

/// Recreate rootfs hardlink aliases as symlinks. Alpine ships each compiler
/// driver / binutils tool under several names hardlinked to ONE inode
/// (`gcc` ↔ `aarch64-alpine-linux-musl-gcc`, and crucially `c++` ↔ `g++` ↔
/// their prefixed forms — all the *same* C++ driver). `tar` serialises the
/// first member of a hardlink set as a real file and the rest as hardlink
/// entries; SELinux `app_data_file` blocks `link()` on-device, so typically
/// only ONE member of each set survives extraction. We pick the survivor and
/// symlink every missing member to it.
///
/// DEBT: D-13 device finding (Mi 10 Pro) — the previous per-*pair* logic
/// treated `(c++, prefixed-c++)` and `(g++, prefixed-g++)` as independent
/// sets. When tar happened to keep `g++` (or its prefixed form), the c++ pair
/// was `(absent, absent)` and could not self-heal, leaving on-device C++
/// compilation broken. Modelling the four C++ names as one equivalence group
/// fixes this: a surviving `g++` now backs `c++`. Likewise `cc` ≡ `gcc`.
pub(super) fn repair_rootfs_hardlinks(rootfs_dir: &Path) {
    let bin = rootfs_dir.join("usr/bin");

    // Each inner slice is one hardlink / functionally-equivalent driver set.
    // `cc` is the generic name for `gcc` and `c++` for `g++` (same drivers), so
    // any survivor in a compiler group can stand in for the whole group — that
    // is what closes the c++ gap above.
    const GROUPS: &[&[&str]] = &[
        &["gcc", "aarch64-alpine-linux-musl-gcc", "cc", "aarch64-alpine-linux-musl-cc"],
        &["g++", "aarch64-alpine-linux-musl-g++", "c++", "aarch64-alpine-linux-musl-c++"],
        &["cpp", "aarch64-alpine-linux-musl-cpp"],
        &["gcc-ar", "aarch64-alpine-linux-musl-gcc-ar"],
        &["gcc-nm", "aarch64-alpine-linux-musl-gcc-nm"],
        &["gcc-ranlib", "aarch64-alpine-linux-musl-gcc-ranlib"],
        &["ar", "aarch64-alpine-linux-musl-ar"],
        &["ranlib", "aarch64-alpine-linux-musl-ranlib"],
        &["strip", "aarch64-alpine-linux-musl-strip"],
        &["objcopy", "aarch64-alpine-linux-musl-objcopy"],
        &["objdump", "aarch64-alpine-linux-musl-objdump"],
        &["nm", "aarch64-alpine-linux-musl-nm"],
        &["as", "aarch64-alpine-linux-musl-as"],
        &["readelf", "aarch64-alpine-linux-musl-readelf"],
        &["addr2line", "aarch64-alpine-linux-musl-addr2line"],
        &["size", "aarch64-alpine-linux-musl-size"],
        &["strings", "aarch64-alpine-linux-musl-strings"],
        &["c++filt", "aarch64-alpine-linux-musl-c++filt"],
    ];

    for group in GROUPS {
        repair_hardlink_group(&bin, group);
    }

    // D-13: a missing C/C++ compiler driver only surfaces much later as a
    // confusing "command not found" deep inside cargo/gcc. Check the critical
    // drivers right after repair and warn loudly if any are still absent.
    const CRITICAL: &[&str] = &["gcc", "g++", "cc", "c++"];
    let missing: Vec<&str> = CRITICAL
        .iter()
        .copied()
        .filter(|name| !resolves_to_file(&bin.join(name)))
        .collect();
    if !missing.is_empty() {
        log::warn!(
            "[OpenCode] repair_rootfs_hardlinks: critical toolchain binaries missing after extraction: {:?} — on-device compilation will fail",
            missing
        );
    }
}

/// True if `p` resolves (following symlinks) to an existing regular file.
/// A dangling symlink resolves to nothing → `false`, so such a member is
/// treated as missing and gets re-pointed at a live survivor.
pub(super) fn resolves_to_file(p: &Path) -> bool {
    fs::metadata(p).map(|m| m.is_file()).unwrap_or(false)
}

/// Symlink every missing member of one hardlink/equivalence group to a
/// surviving member. No-op if the whole group is absent (warns instead — the
/// caller's CRITICAL check escalates that for compiler drivers).
pub(super) fn repair_hardlink_group(bin: &Path, group: &[&str]) {
    // First member that resolves to a real file becomes the link target.
    let Some(survivor) = group.iter().copied().find(|m| resolves_to_file(&bin.join(m))) else {
        log::warn!(
            "[OpenCode] repair_rootfs_hardlinks: no member of group {:?} present after extraction",
            group
        );
        return;
    };
    for member in group.iter().copied() {
        if member == survivor {
            continue;
        }
        let member_path = bin.join(member);
        // Already a working file (real, or a symlink that resolves)? leave it.
        if resolves_to_file(&member_path) {
            continue;
        }
        // Absent or a dangling symlink → (re)create it pointing at the
        // survivor. Relative target: both live in usr/bin.
        force_symlink(Path::new(survivor), &member_path);
    }
}

/// Recreate `link` as a symlink pointing at `src`, logging any failure rather
/// than swallowing it. Used for the 50+ binary/applet symlinks rebuilt on
/// every launch (their nativeLibraryDir target changes with each APK install).
/// A silent failure here leaves a dangling command with no diagnostic.
/// DEBT: D-12 — replaces the `let _ = fs::remove_file(); let _ = symlink();` pairs.
pub(super) fn force_symlink(src: &Path, link: &Path) {
    if let Err(e) = fs::remove_file(link) {
        if e.kind() != std::io::ErrorKind::NotFound {
            log::warn!(
                "[OpenCode] force_symlink: failed to remove stale {}: {}",
                link.display(),
                e
            );
        }
    }
    if let Err(e) = std::os::unix::fs::symlink(src, link) {
        log::warn!(
            "[OpenCode] force_symlink: failed to link {} -> {}: {}",
            link.display(),
            src.display(),
            e
        );
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
pub(super) fn prepare_toolchain_wrappers(
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

    // LD_LIBRARY_PATH injected into every wrapper script. The binfmt_script →
    // libbash_exec.so → libmusl_linker.so chain re-execs the .elf64 from
    // scratch, so the script's own env (not git's env at exec time) is what
    // the dynamic linker sees. Without this, ELF helpers under
    // usr/libexec/git-core/ (git-remote-http, git-http-fetch, …) can't
    // resolve libcurl.so.4 / libpcre2-8.so.0 / libz.so.1 / libssl.so.3 /
    // libcrypto.so.3 even though they exist in <rootfs>/usr/lib/ — verified
    // on-device: with LD_LIBRARY_PATH unset the linker reports
    // "Error loading shared library libcurl.so.4"; with it set the helper
    // starts cleanly and waits for the git remote-helper protocol on stdin.
    // Includes usr/libexec/git-core so helpers there find their dependencies
    // when the loader is invoked with no LD_LIBRARY_PATH from the parent.
    // Also includes llvm19/lib (clang-extra-tools) and the JDK lib dir so
    // java finds libjli.so + libz.so.1 — same set as the entry-point
    // wrappers further down for consistency.
    let ld_path = format!(
        "{r}/usr/lib:{r}/lib:{r}/usr/libexec/git-core:{r}/usr/lib/llvm19/lib:{r}/usr/lib/jvm/java-21-openjdk/lib",
        r = rootfs_dir.display()
    );

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
        // Also: the script MUST export LD_LIBRARY_PATH so the dynamic linker
        // (libmusl_linker.so) can resolve libcurl.so.4 / libpcre2-8.so.0 /
        // libz.so.1 for git-core helpers, and libstdc++.so.6 for cargo/rustc
        // binutils spawned by absolute path.
        if backup.exists() {
            if let Ok(meta) = &meta_res {
                if meta.file_type().is_symlink() {
                    return Ok(());
                }
            }
            let script = format!(
                "#!{bash}\nexport LD_LIBRARY_PATH=\"{ld}:${{LD_LIBRARY_PATH}}\"\nexec \"{linker}\" \"{backup}\" \"$@\"\n",
                bash = bash_exec.display(),
                ld = ld_path,
                linker = musl_linker.display(),
                backup = backup.display(),
            );
            if let Err(e) = fs::write(file, script) {
                log::warn!(
                    "[OpenCode] prepare_toolchain_wrappers: failed to refresh wrapper {}: {} — stale shebang may point at a dead libbash_exec.so (cc: cannot execute)",
                    file.display(),
                    e
                );
            }
            if let Ok(mut perm) = fs::metadata(file).map(|m| m.permissions()) {
                perm.set_mode(0o755);
                if let Err(e) = fs::set_permissions(file, perm) {
                    log::warn!(
                        "[OpenCode] prepare_toolchain_wrappers: failed to chmod refreshed wrapper {}: {}",
                        file.display(),
                        e
                    );
                }
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
            "#!{bash}\nexport LD_LIBRARY_PATH=\"{ld}:${{LD_LIBRARY_PATH}}\"\nexec \"{linker}\" \"{backup}\" \"$@\"\n",
            bash = bash_exec.display(),
            ld = ld_path,
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
                            if let Err(e) = wrap_one(&p) {
                                log::warn!(
                                    "[OpenCode] prepare_toolchain_wrappers: failed to wrap gcc libexec {}: {} — linking may fail later with a misleading error",
                                    p.display(),
                                    e
                                );
                            }
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
                            if let Err(e) = fs::remove_file(&lto) {
                                log::warn!(
                                    "[OpenCode] prepare_toolchain_wrappers: failed to remove wrapped lto script {}: {}",
                                    lto.display(),
                                    e
                                );
                            }
                            if let Err(e) = fs::rename(&lto_backup, &lto) {
                                log::warn!(
                                    "[OpenCode] prepare_toolchain_wrappers: failed to restore liblto_plugin.so at {}: {} — LTO builds will break",
                                    lto.display(),
                                    e
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    // 1b. Wrap git-core internals (git-remote-https, git-remote-http,
    //     git-http-backend, git-http-fetch, …) — spawned by `git` via an
    //     absolute path resolved from its own exec-path (`usr/libexec/git-core`
    //     on Alpine), exactly like cc1/collect2 above. Without this, `git
    //     clone`/`push`/`pull` over https:// fail with SIGSYS ("Bad system
    //     call") or EACCES ("Permission denied") because the kernel's direct
    //     execve of an unwrapped app_data_file ELF is blocked/unsafe under the
    //     untrusted_app SELinux policy — the musl hidden-visibility issue
    //     means an LD_PRELOAD execve hook never sees this spawn either.
    let git_core_root = rootfs_dir.join("usr/libexec/git-core");
    if let Ok(entries) = fs::read_dir(&git_core_root) {
        for entry in entries.flatten() {
            let p = entry.path();
            // Skip .so plugins and symlinks (e.g. git-remote-https -> git-remote-http);
            // wrap_one already skips symlinks itself, but .so has no extension
            // gate here since git-core ships none — kept for parity with the
            // gcc libexec loop in case a future Alpine build adds one.
            if p.extension().and_then(|e| e.to_str()) == Some("so") {
                continue;
            }
            if let Err(e) = wrap_one(&p) {
                log::warn!(
                    "[OpenCode] prepare_toolchain_wrappers: failed to wrap git-core {}: {} — git clone/push/pull over https will fail",
                    p.display(),
                    e
                );
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
            if let Err(e) = wrap_one(&p) {
                log::warn!(
                    "[OpenCode] prepare_toolchain_wrappers: failed to wrap binutils {}: {}",
                    p.display(),
                    e
                );
            }
        }
    }
    if let Ok(entries) = fs::read_dir(rootfs_dir.join("usr/bin")) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            if let Some(s) = name.to_str() {
                if s.starts_with("aarch64-alpine-linux-musl-")
                    && !s.ends_with(".elf64")
                {
                    let p = entry.path();
                    if let Err(e) = wrap_one(&p) {
                        log::warn!(
                            "[OpenCode] prepare_toolchain_wrappers: failed to wrap prefixed binutils {}: {}",
                            p.display(),
                            e
                        );
                    }
                }
            }
        }
    }
    let rustlib_bin = rootfs_dir.join("usr/lib/rustlib/aarch64-alpine-linux-musl/bin");
    if let Ok(entries) = fs::read_dir(&rustlib_bin) {
        for entry in entries.flatten() {
            let p = entry.path();
            if let Err(e) = wrap_one(&p) {
                log::warn!(
                    "[OpenCode] prepare_toolchain_wrappers: failed to wrap rustlib tool {}: {}",
                    p.display(),
                    e
                );
            }
        }
    }

    // 3. Recreate `ld` symlink to ld.bfd if missing — Alpine binutils ship it
    //    as a symlink and `collect2` looks for it by bare name. Some prior
    //    wrap passes lost it.
    let ld = rootfs_dir.join("usr/bin/ld");
    let ld_bfd = rootfs_dir.join("usr/bin/ld.bfd");
    if ld_bfd.exists() && !ld.exists() {
        // DEBT: D-12 — collect2 resolves `ld` by bare name; a silent failure
        // here breaks linking with a misleading error far downstream.
        if let Err(e) = std::os::unix::fs::symlink("ld.bfd", &ld) {
            log::warn!("[OpenCode] failed to recreate ld -> ld.bfd symlink: {}", e);
        }
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
        // Git (push/pull/fetch over https; internal git-core helpers wrapped
        // separately above since they're spawned by absolute path, not PATH)
        "git",
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
