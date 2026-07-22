// FORK: Android git spawn launcher.
//
// On Android, Bun's own posix_spawn cannot execute the shebang-script
// wrappers under `<home>/.cache/wrappers/*` (app_data_file label) even
// though the exact same wrapper runs fine through a real shell (see the
// diagnostic writeup in this repo's history — a real shell's execve()
// transparently follows the kernel's binfmt_script re-exec into
// libbash_exec.so/libmusl_linker.so in nativeLibraryDir, but Bun's spawn
// path fails on the initial file with EACCES regardless of whether a bare
// name or an absolute path is given).
//
// Workaround: skip the shebang hop entirely and have Bun spawn
// libmusl_linker.so DIRECTLY — it lives in nativeLibraryDir (apk_data_file,
// exec-allowed) and takes the real target ELF path as argv[1], forwarding
// the rest of argv unchanged (see packages/mobile/src-tauri/src/runtime/
// server.rs::build_tool_functions, which already uses this exact
// invocation for the interactive shell's `git()` function). Loading the
// target ELF afterwards is a read/mmap done by the linker itself, not a
// kernel execve, so it isn't subject to the same SELinux check.
//
// GIT_EXEC_PATH must point at the rootfs (not git's compiled-in prefix,
// which doesn't exist on device) so git can find git-remote-https itself.
// Every executable in git-core is replaced by an APK-native dispatcher that
// re-enters the musl linker with the preserved .elf64 target. Do not preload
// libmusl_exec here: Git would propagate it into that Bionic dispatcher and
// make Android's loader resolve musl's libc.so before dispatcher main runs.
// path.posix, not path.join: these are always Unix paths inside the Android
// rootfs, regardless of the host OS this module happens to be type-checked
// or tested on.
import path from "node:path"

export interface GitInvocation {
  readonly bin: string
  readonly args: (gitArgs: string[]) => string[]
  readonly env?: Record<string, string>
}

let cached: GitInvocation | undefined

export function resolveGitInvocation(): GitInvocation {
  if (cached) return cached

  const linker = process.env.OPENCODE_MOBILE_MUSL_LINKER
  const rootfs = process.env.OPENCODE_MOBILE_ROOTFS_DIR

  if (!linker || !rootfs) {
    cached = { bin: "git", args: (gitArgs) => gitArgs }
    return cached
  }

  const gitBin = path.posix.join(rootfs, "usr/bin/git")
  const gitExecPath = path.posix.join(rootfs, "usr/libexec/git-core")
  const gitSslCaInfo = path.posix.join(rootfs, "etc/ssl/certs/ca-certificates.crt")
  const ldLibraryPath = [path.posix.join(rootfs, "lib"), path.posix.join(rootfs, "usr/lib"), gitExecPath].join(":")
  cached = {
    bin: linker,
    // The native dispatcher owns recursive git-core launches. Keeping the
    // musl exec hook out of this process prevents mixed-libc child startup.
    args: (gitArgs) => [`--library-path`, ldLibraryPath, gitBin, `--exec-path=${gitExecPath}`, ...gitArgs],
    env: {
      // The child re-execs an APK-native Bionic dispatcher. Musl paths here
      // would make Bionic load the rootfs libc before main; loader arguments
      // above carry the musl paths without contaminating the child environment.
      LD_LIBRARY_PATH: "",
      GIT_EXEC_PATH: gitExecPath,
      GIT_SSL_CAINFO: gitSslCaInfo,
      LD_PRELOAD: "",
      MUSL_LINKER: linker,
    },
  }
  return cached
}

/** Exported for tests only — real callers must not force a specific mode. */
export function _resetGitInvocationCacheForTests() {
  cached = undefined
}
