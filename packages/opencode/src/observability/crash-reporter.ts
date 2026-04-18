/**
 * Local-first crash reporter.
 *
 * Traps `uncaughtException` and `unhandledRejection` and writes a structured
 * JSON report to `<datadir>/crashes/<iso>.json`. Upload to a remote endpoint
 * is strictly opt-in via `experimental.crash.upload_endpoint`. The default
 * behaviour is "file only, no network".
 *
 * Rotation: keeps at most `MAX_REPORTS` files on disk. On init we purge the
 * oldest extras before doing anything else so a crash loop can't fill the
 * disk.
 *
 * Design notes:
 *   - We intentionally do NOT depend on `Config.get()` here: crash handlers
 *     must survive *any* runtime breakage, including a broken config. The
 *     upload endpoint is therefore resolved lazily inside a try/catch and
 *     failures are swallowed. An opt-in upload that silently no-ops is the
 *     correct failure mode.
 *   - Writes are sync so we can write during an `uncaughtException` before
 *     the process exits. `fs.writeFileSync` is safe inside the handler.
 *   - We preserve the existing `Log.Default.error(...)` call sites in
 *     `src/index.ts` — this reporter is additive.
 */
import fs from "fs"
import path from "path"
import os from "os"
import { Global } from "../global"
import { Log } from "../util/log"
import { Installation } from "../installation"

const log = Log.create({ service: "crash-reporter" })

const MAX_REPORTS = 50

export namespace CrashReporter {
  let installed = false

  export interface Report {
    timestamp: string
    kind: "uncaughtException" | "unhandledRejection"
    version: string
    platform: NodeJS.Platform
    arch: string
    nodeVersion: string
    bunVersion?: string
    pid: number
    message: string
    stack?: string
    cause?: string
    name?: string
    argv: string[]
  }

  function crashDir(): string {
    return path.join(Global.Path.data, "crashes")
  }

  /** Ensure directory exists and purge older-than-MAX_REPORTS files. */
  export function init() {
    if (installed) return
    installed = true

    try {
      fs.mkdirSync(crashDir(), { recursive: true })
    } catch {
      // If we can't create the directory, there's nowhere to write reports.
      // Keep handlers installed anyway so they at least log.
    }

    purgeOld()

    process.on("uncaughtException", (err) => {
      writeReport("uncaughtException", err)
    })
    process.on("unhandledRejection", (reason) => {
      writeReport("unhandledRejection", reason)
    })
  }

  /** Delete old reports keeping only `MAX_REPORTS` most recent. */
  function purgeOld() {
    try {
      const dir = crashDir()
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.m - a.m)
      for (const { f } of files.slice(MAX_REPORTS)) {
        try {
          fs.unlinkSync(path.join(dir, f))
        } catch {}
      }
    } catch {}
  }

  function writeReport(kind: Report["kind"], err: unknown) {
    const now = new Date()
    const iso = now.toISOString().replace(/[:.]/g, "-")
    const filename = `${iso}_${kind}.json`

    const report: Report = {
      timestamp: now.toISOString(),
      kind,
      version: Installation.VERSION,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      bunVersion: typeof (globalThis as any).Bun !== "undefined" ? (globalThis as any).Bun.version : undefined,
      pid: process.pid,
      message: toMessage(err),
      stack: toStack(err),
      cause: toCause(err),
      name: err instanceof Error ? err.name : undefined,
      argv: process.argv.slice(2),
    }

    try {
      fs.writeFileSync(path.join(crashDir(), filename), JSON.stringify(report, null, 2), { mode: 0o600 })
    } catch (e) {
      // Last-resort: log to stderr. Don't throw from a crash handler.
      try {
        log.error("failed to write crash report", { e: String(e) })
      } catch {}
    }

    // Opt-in upload — fire-and-forget, never blocks exit.
    void tryUpload(report).catch(() => {})
  }

  async function tryUpload(report: Report) {
    let endpoint: string | undefined
    try {
      // Lazy dynamic import: don't want config loading failures to break the
      // handler chain. This is a best-effort path.
      const { Config } = await import("../config/config")
      const cfg = await Config.get()
      endpoint = (cfg as any)?.experimental?.crash?.upload_endpoint
    } catch {
      return
    }
    if (!endpoint || typeof endpoint !== "string") return

    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(report),
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      // Never surface upload errors — local report is the source of truth.
    }
  }

  function toMessage(err: unknown): string {
    if (err instanceof Error) return err.message
    if (typeof err === "string") return err
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }

  function toStack(err: unknown): string | undefined {
    if (err instanceof Error && err.stack) return err.stack
    return undefined
  }

  function toCause(err: unknown): string | undefined {
    if (err instanceof Error && err.cause !== undefined) {
      try {
        return String(err.cause)
      } catch {
        return undefined
      }
    }
    return undefined
  }

  /** Exposed for tests / doctor command. */
  export function listReports(): string[] {
    try {
      return fs
        .readdirSync(crashDir())
        .filter((f) => f.endsWith(".json"))
        .sort()
    } catch {
      return []
    }
  }
}

// Silence unused-import in some build modes
void os
