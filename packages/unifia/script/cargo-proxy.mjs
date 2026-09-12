#!/usr/bin/env node
// Cargo ADB reverse proxy — Phase C of Prism-EQ bench parity plan.
//
// Listens on 127.0.0.1:9999 (or --port). The mobile app, via `adb reverse
// tcp:9999 tcp:9999`, routes whitelisted toolchain commands (cargo, rustc,
// npm, pnpm, yarn, tsc, bun) to this PC daemon. The daemon pulls the
// on-device project to a cache dir, runs the command on the PC, pushes back
// modified sources (excluding target/, .git/, node_modules/), and returns
// stdout/stderr/exitCode to the mobile bash tool.
//
// Usage:
//   node script/cargo-proxy.mjs [--port 9999] [--device <adb-serial>]
//
// API:
//   POST /exec
//     body: { deviceCwd: string, command: string, env: object }
//     returns: { stdout: string, stderr: string, exitCode: number, durationMs: number }
//     403 unless the caller sends application/json without browser fetch
//     headers, the command starts with an ALLOWED_TOOLS entry and carries no
//     shell control characters, and env sets no loader/resolution variable.
//   GET /health → { ok: true }

import { createServer } from "node:http"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { mkdirSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"

const args = process.argv.slice(2)
const PORT = Number(argFlag("--port") ?? 9999)
const DEVICE = argFlag("--device") ?? null
const MAX_OUTPUT_BYTES = 50 * 1024
const EXEC_TIMEOUT_MS = 5 * 60 * 1000

function argFlag(name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}

// The header has always promised "whitelisted toolchain commands"; until now
// nothing enforced it. `MUTATING` below only decides whether to push sources
// back, so any POST to /exec was arbitrary shell execution on the developer's
// PC (CodeQL `js/command-line-injection`). Binding to 127.0.0.1 is not the
// barrier it looks like: `adb reverse` exposes the port to the device on
// purpose, and a web page the developer visits can POST here from their
// browser.
//
// What each guard is worth, stated plainly so nobody mistakes one for the
// other: `refuseCaller` is the boundary — it is what a drive-by page cannot
// get past. `refuseCommand` is defence in depth, and it cannot be more than
// that, because every tool on this list runs project code by design (`cargo
// build` executes build.rs). It stops a caller from naming a *different*
// program; it does not make a permitted one harmless.
const ALLOWED_TOOLS = new Set(["cargo", "rustc", "rustup", "npm", "pnpm", "yarn", "tsc", "bun", "node"])

// Anything that would let a payload chain a second command past the allowed
// leading tool. Quotes and `=` stay legal so `cargo test -- --nocapture` and
// `npm run build --workspace=x` still work.
const SHELL_CONTROL = /[;&|`$><\n\r(){}]/

// Spread into the child env, so a payload could otherwise redirect which
// binary `cargo` resolves to, or inject code into node. PATH is matched by
// prefix on purpose: PATHEXT is the same hijack on Windows. The wrapper and
// runner entries are the cargo-specific equivalents — each names a program
// cargo will execute — and a device payload has no legitimate reason to set
// any of them.
const ENV_DENYLIST =
  /^(PATH|LD_|DYLD_|NODE_OPTIONS$|BASH_ENV$|SHELL$|IFS$|RUSTC$|RUSTC_WRAPPER$|RUSTC_WORKSPACE_WRAPPER$|CARGO_BUILD_RUSTC|CARGO_TARGET_.*_RUNNER$)/i

/** @returns {string | null} the reason to refuse, or null when acceptable. */
function refuseCommand(command, env) {
  if (SHELL_CONTROL.test(command)) return "command contains shell control characters"
  const tool = command.trim().split(/\s+/, 1)[0]
  if (!ALLOWED_TOOLS.has(tool)) return `command is not a whitelisted toolchain tool: ${tool}`
  for (const key of Object.keys(env || {})) if (ENV_DENYLIST.test(key)) return `env key is not permitted: ${key}`
  return null
}

/**
 * A browser cannot be made to send this request.
 *
 * `Origin` is attached to every cross-origin POST, and `Sec-Fetch-Site` to
 * every fetch from a modern browser — so their presence means the caller is a
 * page, not the mobile bash tool. Requiring `application/json` closes the
 * remaining gap: a simple request may only carry text/plain, form or multipart
 * content types, and anything else forces a preflight this server never
 * answers.
 */
function refuseCaller(req) {
  if (req.headers["origin"] || req.headers["sec-fetch-site"] || req.headers["sec-fetch-mode"]) {
    return "browser-originated requests are not accepted"
  }
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
    return "content-type must be application/json"
  }
  return null
}

function adbArgs() {
  return DEVICE ? ["-s", DEVICE] : []
}

function deviceCacheDir(deviceCwd) {
  const hash = createHash("sha256").update(deviceCwd).digest("hex").slice(0, 16)
  // Forward-slashes only: tar on Windows treats `C:\path` as a remote spec
  // and as a positional archive arg with the `-C` flag.
  return join(tmpdir(), "opencode-cargo-proxy", hash).replace(/\\/g, "/")
}

function adbPull(deviceCwd, localDir) {
  // Pull deviceCwd contents into localDir using tar via run-as exec-out
  // (avoids permission issues with /data/data/<pkg>/files paths).
  // deviceCwd is expected to be under /data/data/<pkg>/files/<sub>
  const m = deviceCwd.match(/^\/data\/(?:user\/0|data)\/([^/]+)\/files\/(.+)$/)
  if (!m) return { ok: false, error: `unsupported deviceCwd: ${deviceCwd}` }
  const [, pkg, sub] = m
  rmSync(localDir, { recursive: true, force: true })
  mkdirSync(localDir, { recursive: true })
  const r = spawnSync(
    "adb",
    [...adbArgs(), "exec-out", "run-as", pkg, "tar", "-cf", "-", "-C", "files", sub],
    { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 },
  )
  if (r.status !== 0) return { ok: false, error: `adb pull tar failed: ${r.stderr?.toString()}` }
  // Pipe tar contents into PC tar -x
  const ext = spawnSync("tar", ["-xf", "-", "-C", localDir, "--strip-components=1"], {
    input: r.stdout,
    encoding: "buffer",
  })
  if (ext.status !== 0) return { ok: false, error: `tar extract failed: ${ext.stderr?.toString()}` }
  return { ok: true, pkg, sub }
}

function adbPush(localDir, deviceCwd, pkg) {
  // Push only sources back (Cargo.toml, Cargo.lock, src/, tests/), skip target/, .git/, node_modules/.
  // Tar localDir contents and stream into adb shell run-as `tar -xf -` inside files/.
  const m = deviceCwd.match(/^\/data\/(?:user\/0|data)\/([^/]+)\/files\/(.+)$/)
  if (!m) return { ok: false, error: `unsupported deviceCwd: ${deviceCwd}` }
  const sub = m[2]
  const tarBuild = spawnSync(
    "tar",
    [
      "-cf",
      "-",
      "--exclude=target",
      "--exclude=.git",
      "--exclude=node_modules",
      "--exclude=dist",
      "--exclude=build",
      "-C",
      localDir,
      ".",
    ],
    { encoding: "buffer", maxBuffer: 128 * 1024 * 1024 },
  )
  if (tarBuild.status !== 0) return { ok: false, error: `tar build failed: ${tarBuild.stderr?.toString()}` }
  const push = spawnSync(
    "adb",
    [...adbArgs(), "shell", "run-as", pkg, "sh", "-c", `cd files/${sub} && tar -xf -`],
    { input: tarBuild.stdout, encoding: "buffer" },
  )
  if (push.status !== 0) return { ok: false, error: `adb push tar failed: ${push.stderr?.toString()}` }
  return { ok: true }
}

function truncate(buf) {
  if (!buf) return ""
  const s = buf.toString("utf8")
  if (s.length <= MAX_OUTPUT_BYTES) return s
  const half = Math.floor(MAX_OUTPUT_BYTES / 2)
  return s.slice(0, half) + `\n... [truncated ${s.length - MAX_OUTPUT_BYTES} bytes] ...\n` + s.slice(-half)
}

function execLocally(command, cwd, env) {
  const isWindows = process.platform === "win32"
  const shell = isWindows ? "cmd.exe" : "/bin/sh"
  const shellFlag = isWindows ? "/c" : "-c"
  const r = spawnSync(shell, [shellFlag, command], {
    cwd,
    env: { ...process.env, ...(env || {}) },
    timeout: EXEC_TIMEOUT_MS,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    stdout: truncate(r.stdout),
    stderr: truncate(r.stderr),
    exitCode: r.status ?? -1,
    signal: r.signal ?? null,
  }
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: true, device: DEVICE ?? "default" }))
    return
  }
  if (req.method !== "POST" || req.url !== "/exec") {
    res.writeHead(404)
    res.end()
    return
  }
  const callerRefusal = refuseCaller(req)
  if (callerRefusal) {
    res.writeHead(403, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: callerRefusal }))
    return
  }
  let body = Buffer.alloc(0)
  req.on("data", (c) => (body = Buffer.concat([body, c])))
  req.on("end", () => {
    let payload
    try {
      payload = JSON.parse(body.toString("utf8"))
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "invalid json" }))
      return
    }
    const { deviceCwd, command, env } = payload || {}
    if (typeof deviceCwd !== "string" || typeof command !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "deviceCwd and command required" }))
      return
    }
    const commandRefusal = refuseCommand(command, env)
    if (commandRefusal) {
      process.stderr.write(`[refused] ${commandRefusal}\n`)
      res.writeHead(403, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: commandRefusal }))
      return
    }
    const t0 = Date.now()
    const localDir = deviceCacheDir(deviceCwd)
    process.stderr.write(`[exec] ${command} (cwd=${deviceCwd} → ${localDir})\n`)
    const pull = adbPull(deviceCwd, localDir)
    if (!pull.ok) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ stdout: "", stderr: pull.error, exitCode: -1, durationMs: Date.now() - t0 }))
      return
    }
    const out = execLocally(command, localDir, env)
    process.stderr.write(`[exec] exit=${out.exitCode} duration=${Date.now() - t0}ms\n`)
    // Push sources back only when the command can mutate them. Read-only
    // commands (cargo build/check/test/version, rustc, tsc, ...) leave
    // sources untouched and target/ is excluded from push anyway, so
    // pushing every time produces "Read-only file system" noise on the
    // device and serves no purpose.
    const MUTATING = /^\s*(cargo\s+(init|new|add|remove|generate|update)|npm\s+(init|install|i|add)|pnpm\s+(init|add|install|i)|yarn\s+(init|add|install)|bun\s+(init|add|install|i))\b/
    const skipPush = !MUTATING.test(command)
    const push = skipPush ? { ok: true } : adbPush(localDir, deviceCwd, pull.pkg)
    const pushNote = push.ok ? "" : `\n[cargo-proxy: push-back failed: ${push.error}]`
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(
      JSON.stringify({
        stdout: out.stdout,
        stderr: out.stderr + pushNote,
        exitCode: out.exitCode,
        signal: out.signal,
        durationMs: Date.now() - t0,
      }),
    )
  })
})

server.listen(PORT, "127.0.0.1", () => {
  process.stderr.write(`[cargo-proxy] listening on 127.0.0.1:${PORT}${DEVICE ? ` (device=${DEVICE})` : ""}\n`)
  process.stderr.write(`[cargo-proxy] remember: adb${DEVICE ? ` -s ${DEVICE}` : ""} reverse tcp:${PORT} tcp:${PORT}\n`)
})

function shutdown() {
  process.stderr.write(`[cargo-proxy] shutdown\n`)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2000).unref()
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
