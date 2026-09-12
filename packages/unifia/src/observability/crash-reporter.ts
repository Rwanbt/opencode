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
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { Global } from "../global"
import { Log } from "../util/log"
import { Installation } from "../installation"

const log = Log.create({ service: "crash-reporter" })

const MAX_REPORTS = 50
// FORK (SIDECAR-STARTUP-HANG): bounds how many stale reports a single
// startup purges. A runaway crash loop can accumulate millions of reports
// (observed in production: 10M+ files in <datadir>/crashes) — unlinking
// all of them synchronously would itself turn every subsequent startup
// into a multi-minute stall. Trim gradually across restarts instead.
const MAX_PURGE_PER_RUN = 1000

function retainOldest(heap: string[], value: string, limit: number): void {
  if (heap.length < limit) {
    heap.push(value)
    siftOldestUp(heap, heap.length - 1)
    return
  }
  if (value >= heap[0]!) return
  heap[0] = value
  siftOldestDown(heap, 0)
}

function siftOldestUp(heap: string[], start: number): void {
  let index = start
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2)
    if (heap[parent]! >= heap[index]!) return
    ;[heap[parent], heap[index]] = [heap[index]!, heap[parent]!]
    index = parent
  }
}

function siftOldestDown(heap: string[], start: number): void {
  let index = start
  while (true) {
    const left = index * 2 + 1
    if (left >= heap.length) return
    const right = left + 1
    const largest = right < heap.length && heap[right]! > heap[left]! ? right : left
    if (heap[index]! >= heap[largest]!) return
    ;[heap[index], heap[largest]] = [heap[largest]!, heap[index]!]
    index = largest
  }
}
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

    void purgeOld()

    process.on("uncaughtException", (err) => {
      writeReport("uncaughtException", err)
    })
    process.on("unhandledRejection", (reason) => {
      writeReport("unhandledRejection", reason)
    })
  }

  /**
   * Delete old reports keeping only `MAX_REPORTS` most recent.
   *
   * FORK (SIDECAR-STARTUP-HANG): filenames are `${isoTimestamp}_${kind}.json`
   * (see writeReport) — ISO 8601 sorts lexicographically in chronological
   * order, so a plain string sort gives recency without a statSync() per file.
   *
   * WHY streamed instead of `readdirSync().filter().sort()`: readdirSync
   * materialises every entry at once. Measured on a degraded directory of
   * 1_744_670 reports, that cost ~422 MB of resident memory on every startup
   * (A/B: 2374 MB vs 1952 MB private bytes) and ran synchronously before the
   * app could do anything else. `opendirSync` walks with a fixed buffer, and we
   * retain at most `MAX_PURGE_PER_RUN` names, so memory is O(K) not O(n)
   * regardless of how far the directory has drifted.
   *
   * Exposed for tests.
   */
  export async function purgeOld(): Promise<void> {
    let dir: fs.Dir
    try {
      dir = await fs.promises.opendir(crashDir())
    } catch {
      return
    }

    const oldest: string[] = []
    let total = 0
    let scanned = 0
    try {
      for await (const entry of dir) {
        if (!entry.name.endsWith(".json")) continue
        total++
        retainOldest(oldest, entry.name, MAX_PURGE_PER_RUN)
        scanned++
        if (scanned % 2048 === 0) await new Promise<void>((resolve) => setImmediate(resolve))
      }
    } catch {
      // Delete only names collected before the directory became unreadable.
    }

    const excess = Math.max(0, total - MAX_REPORTS)
    for (const name of oldest.sort().slice(0, Math.min(excess, MAX_PURGE_PER_RUN))) {
      try {
        await fs.promises.unlink(path.join(crashDir(), name))
      } catch {}
    }
  }

  /**
   * A closed stdout/stderr pipe is a normal termination condition, not a defect
   * worth archiving. Reporting it is actively harmful: with `--print-logs` the
   * logger writes to stderr, so archiving an EPIPE re-enters the logger, which
   * raises EPIPE again — a self-feeding loop. On 2026-07-28 that loop wrote
   * 1_744_670 reports from a Tauri sidecar whose parent had gone away, and the
   * resulting directory cost ~422 MB of RSS on every later startup (see
   * `purgeOld()`).
   *
   * Exposed for tests.
   */
  export function isBrokenPipe(err: unknown): boolean {
    const code = (err as { code?: unknown } | null)?.code
    return code === "EPIPE" || code === "ERR_STREAM_DESTROYED"
  }

  function writeReport(kind: Report["kind"], err: unknown) {
    if (isBrokenPipe(err)) return

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
