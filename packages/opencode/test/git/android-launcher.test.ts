/**
 * Tests for src/git/android-launcher.ts.
 *
 * Desktop (no OPENCODE_MOBILE_* env vars) must pass "git" straight through —
 * this is what every non-Android test/CI run exercises. Android mode is only
 * reachable when both env vars are present (set from packages/mobile/src-tauri
 * /src/runtime/server.rs's .env_vars, never user-controlled), and must never
 * let git arguments leak into a shell string — args stay a real argv array.
 */
import { afterEach, beforeEach, expect, test } from "bun:test"
import { _resetGitInvocationCacheForTests, resolveGitInvocation } from "../../src/git/android-launcher"

const ORIGINAL_LINKER = process.env.OPENCODE_MOBILE_MUSL_LINKER
const ORIGINAL_ROOTFS = process.env.OPENCODE_MOBILE_ROOTFS_DIR

beforeEach(() => {
  _resetGitInvocationCacheForTests()
})

afterEach(() => {
  _resetGitInvocationCacheForTests()
  if (ORIGINAL_LINKER === undefined) delete process.env.OPENCODE_MOBILE_MUSL_LINKER
  else process.env.OPENCODE_MOBILE_MUSL_LINKER = ORIGINAL_LINKER
  if (ORIGINAL_ROOTFS === undefined) delete process.env.OPENCODE_MOBILE_ROOTFS_DIR
  else process.env.OPENCODE_MOBILE_ROOTFS_DIR = ORIGINAL_ROOTFS
})

test("desktop: no android env vars → bin is bare 'git', args passed through unchanged", () => {
  delete process.env.OPENCODE_MOBILE_MUSL_LINKER
  delete process.env.OPENCODE_MOBILE_ROOTFS_DIR
  const invocation = resolveGitInvocation()
  expect(invocation.bin).toBe("git")
  expect(invocation.args(["--version"])).toEqual(["--version"])
  expect(invocation.env).toBeUndefined()
})

test("android: bin becomes the musl linker, rootfs git prepended as first arg", () => {
  process.env.OPENCODE_MOBILE_MUSL_LINKER = "/data/app/~~x/lib/arm64/libmusl_linker.so"
  process.env.OPENCODE_MOBILE_ROOTFS_DIR = "/data/user/0/ai.opencode.mobile/runtime/rootfs"
  const invocation = resolveGitInvocation()
  expect(invocation.bin).toBe("/data/app/~~x/lib/arm64/libmusl_linker.so")
  expect(invocation.args(["--version"])).toEqual([
    "--library-path",
    "/data/user/0/ai.opencode.mobile/runtime/rootfs/lib:/data/user/0/ai.opencode.mobile/runtime/rootfs/usr/lib:/data/user/0/ai.opencode.mobile/runtime/rootfs/usr/libexec/git-core",
    "/data/user/0/ai.opencode.mobile/runtime/rootfs/usr/bin/git",
    "--exec-path=/data/user/0/ai.opencode.mobile/runtime/rootfs/usr/libexec/git-core",
    "--version",
  ])
})

test("android: keeps the Bionic dispatcher environment free of musl loader variables", () => {
  process.env.OPENCODE_MOBILE_MUSL_LINKER = "/nlib/libmusl_linker.so"
  process.env.OPENCODE_MOBILE_ROOTFS_DIR = "/rootfs"
  const invocation = resolveGitInvocation()
  expect(invocation.env?.GIT_EXEC_PATH).toBe("/rootfs/usr/libexec/git-core")
  expect(invocation.env?.GIT_SSL_CAINFO).toBe("/rootfs/etc/ssl/certs/ca-certificates.crt")
  expect(invocation.env?.LD_PRELOAD).toBe("")
  expect(invocation.env?.MUSL_LINKER).toBe("/nlib/libmusl_linker.so")
  expect(invocation.env?.LD_LIBRARY_PATH).toBe("")
})

test("android: hostile branch names stay separate argv entries, never interpolated", () => {
  process.env.OPENCODE_MOBILE_MUSL_LINKER = "/nlib/libmusl_linker.so"
  process.env.OPENCODE_MOBILE_ROOTFS_DIR = "/rootfs"
  const invocation = resolveGitInvocation()
  const hostile = "feature/test;touch /tmp/pwned"
  const args = invocation.args(["push", "origin", hostile])
  expect(args).toEqual(["--library-path", "/rootfs/lib:/rootfs/usr/lib:/rootfs/usr/libexec/git-core", "/rootfs/usr/bin/git", "--exec-path=/rootfs/usr/libexec/git-core", "push", "origin", hostile])
  // The hostile value must appear as exactly one array element, never
  // concatenated into a larger string a shell could re-split/interpret.
  expect(args.filter((a) => a === hostile)).toHaveLength(1)
})

test("result is cached across calls until reset (mirrors real one-process lifetime)", () => {
  delete process.env.OPENCODE_MOBILE_MUSL_LINKER
  delete process.env.OPENCODE_MOBILE_ROOTFS_DIR
  const first = resolveGitInvocation()
  process.env.OPENCODE_MOBILE_MUSL_LINKER = "/nlib/libmusl_linker.so"
  process.env.OPENCODE_MOBILE_ROOTFS_DIR = "/rootfs"
  const second = resolveGitInvocation()
  expect(second).toBe(first)
  _resetGitInvocationCacheForTests()
  const third = resolveGitInvocation()
  expect(third.bin).not.toBe(first.bin)
})
