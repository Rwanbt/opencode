// FORK: Git runtime diagnostics.
//
// Deliberately separate from GitHub API/identity checks: the mission this
// implements is explicit that "API reachable" and "git can actually
// push/pull over HTTPS" must never be conflated into a single "GitHub
// operational" verdict — a connected identity with a broken transport (the
// Android git-remote-https SIGSYS case fixed in
// packages/mobile/src-tauri/src/runtime/toolchain.rs) must show as broken.
import { execFile } from "node:child_process"
import os from "node:os"
import { redact } from "@/security/dlp"
import { resolveGitInvocation } from "@/git/android-launcher"
import type { GitFailureCategory, GitRuntimeReport } from "./schema"

const PROBE_TIMEOUT_MS = 15_000
// Read-only, unauthenticated probe target — never touches user data. Exercises
// the exact same git-remote-https code path that clone/fetch/push use.
const PROBE_URL = "https://github.com/octocat/Hello-World.git"

interface RunResult {
  stdout: string
  stderr: string
  code: number | null
  signal: string | null
}

function run(bin: string, args: string[], env?: Record<string, string>): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { timeout: PROBE_TIMEOUT_MS, env: { ...process.env, ...env } },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout: stdout.toString(), stderr: stderr.toString(), code: 0, signal: null })
          return
        }
        const err = error as NodeJS.ErrnoException & { code?: number | string; signal?: string }
        resolve({
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() || err.message,
          code: typeof err.code === "number" ? err.code : null,
          signal: err.signal ?? null,
        })
      },
    )
  })
}

// All actual `git` invocations route through here rather than calling
// run("git", ...) directly — see android-launcher.ts for why: on Android,
// "git" must be spawned as libmusl_linker.so with the rootfs git binary as
// its first argument, never as a bare/absolute path to the wrapper script.
function runGit(args: string[], env?: Record<string, string>): Promise<RunResult> {
  const invocation = resolveGitInvocation()
  return run(invocation.bin, invocation.args(args), { ...invocation.env, ...env })
}

/** Exported for direct unit testing (test/github/diagnostics.test.ts) — the
 *  mapping logic is the valuable, easily-testable part; `diagnose()` itself
 *  needs a real (or broken) git installation to exercise end to end. */
export function categorize(stderr: string, code: number | null, signal: string | null): GitFailureCategory {
  const s = stderr.toLowerCase()
  // SIGSYS ("Bad system call") is the Android zygote seccomp-bpf signature
  // for an unwrapped/incompatible ELF spawn — see the toolchain.rs fix.
  if (signal === "SIGSYS" || code === 159) return "https_helper_blocked"
  if (s.includes("permission denied")) return "https_helper_permission_denied"
  if (s.includes("cannot exec") || s.includes("cannot spawn") || s.includes("cannot run")) return "https_helper_missing"
  if (s.includes("could not resolve host")) return "dns_failure"
  if (s.includes("ssl") || s.includes("certificate") || s.includes("tls")) return "tls_failure"
  if (
    s.includes("could not read username") ||
    s.includes("authentication failed") ||
    s.includes("invalid credentials") ||
    s.includes("401")
  )
    return "authentication_failure"
  if (s.includes("403") || s.includes("access denied")) return "authorization_failure"
  if (s.includes("repository not found") || (s.includes("not found") && s.includes("http")))
    return "repository_not_found"
  if (s.includes("could not connect") || s.includes("network is unreachable") || s.includes("timed out"))
    return "network_failure"
  return "unknown"
}

/** `probeNetwork` is injectable so unit tests can exercise the full report
 *  shape (failure categorization, redaction) without a real network call —
 *  AGENTS.md forbids network dependencies in unit tests. Production callers
 *  never pass it; the default hits the real read-only public-repo probe. */
export async function diagnose(
  probeNetwork: (url: string) => Promise<RunResult> = (url) => runGit(["ls-remote", "--exit-code", url, "HEAD"]),
): Promise<GitRuntimeReport> {
  const platform = os.platform()
  const architecture = os.arch()

  const version = await runGit(["--version"])
  if (version.code !== 0) {
    return {
      gitAvailable: false,
      httpsHelperFound: false,
      httpsHelperExecutable: false,
      httpsProbeSucceeded: false,
      sshAvailable: false,
      platform,
      architecture,
      failure: {
        stage: "git --version",
        code: version.code ?? undefined,
        signal: version.signal ?? undefined,
        category: "git_missing",
        safeMessage: redact(version.stderr).text || "git binary not found on PATH",
      },
    }
  }
  const gitVersion = version.stdout.trim()

  const execPathResult = await runGit(["--exec-path"])
  const execPath = execPathResult.code === 0 ? execPathResult.stdout.trim() : undefined

  let httpsHelperFound = false
  let httpsHelperPath: string | undefined
  let httpsHelperExecutable = false
  if (execPath) {
    const fs = await import("node:fs/promises")
    const path = await import("node:path")
    for (const name of ["git-remote-https", "git-remote-http"]) {
      const candidate = path.join(execPath, name)
      try {
        const stat = await fs.stat(candidate)
        httpsHelperFound = true
        httpsHelperPath = candidate
        httpsHelperExecutable = (stat.mode & 0o111) !== 0
        break
      } catch {
        // try the next candidate name
      }
    }
  }

  // `ssh -V` prints its version banner to stderr and exits 0 on OpenSSH.
  const sshCheck = await run("ssh", ["-V"])
  const sshAvailable = sshCheck.code === 0 || sshCheck.stderr.toLowerCase().includes("openssh")

  const probe = await probeNetwork(PROBE_URL)
  const httpsProbeSucceeded = probe.code === 0

  const report: GitRuntimeReport = {
    gitAvailable: true,
    gitVersion,
    execPath,
    httpsHelperFound,
    httpsHelperPath,
    httpsHelperExecutable,
    httpsProbeSucceeded,
    sshAvailable,
    platform,
    architecture,
  }

  if (!httpsProbeSucceeded) {
    report.failure = {
      stage: "git ls-remote (probe)",
      code: probe.code ?? undefined,
      signal: probe.signal ?? undefined,
      category: categorize(probe.stderr, probe.code, probe.signal),
      safeMessage: redact(probe.stderr).text || "git ls-remote failed with no output",
    }
  }

  return report
}

/** Authenticated probe against the user's own GitHub session — used by
 *  "Tester la connexion" once a session exists. Returns the same shape;
 *  `gitHttpsAuthenticated` semantics live one level up (see auth.ts /
 *  server/routes/github.ts) since building the auth env is credentials.ts's
 *  job, not diagnostics'. */
export async function probeAuthenticated(env: Record<string, string>): Promise<{ ok: boolean; safeMessage?: string }> {
  const probe = await runGit(["ls-remote", "--exit-code", PROBE_URL, "HEAD"], env)
  if (probe.code === 0) return { ok: true }
  return { ok: false, safeMessage: redact(probe.stderr).text || "git ls-remote failed" }
}
