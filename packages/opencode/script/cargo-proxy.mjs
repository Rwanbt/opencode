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
