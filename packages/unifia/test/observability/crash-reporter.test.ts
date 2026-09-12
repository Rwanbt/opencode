// Regression coverage for the crash-reporter (2026-07-29).
//
// Context: a Tauri sidecar running with `--print-logs` lost its parent pipe.
// Every log write then raised EPIPE -> uncaughtException -> writeReport(), and
// writeReport()'s own logging re-entered the same broken stream. The loop wrote
// 1_744_670 reports into <datadir>/crashes in a single day.
//
// The leftover directory then degraded every later startup: purgeOld() used
// readdirSync().filter().sort(), materialising all 1.74M names at once. Measured
// A/B on the real directory: 2374 MB private bytes with it, 1952 MB without —
// ~422 MB of resident memory burned before the app did anything, which pushed a
// TUI session into a native OOM kill (no crash report written, because the
// process never got to run a JS handler).
//
// These tests pin both halves: the loop's trigger, and the bounded purge.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { CrashReporter } from "../../src/observability/crash-reporter"
import { Global } from "../../src/global"

const dir = path.join(Global.Path.data, "crashes")

function reset() {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
}

/** Same shape writeReport() produces: `${iso}_${kind}.json`, ISO-sortable. */
function seed(count: number, startMinute = 0) {
  for (let i = 0; i < count; i++) {
    const stamp = new Date(Date.UTC(2026, 6, 28, 0, startMinute + i)).toISOString().replace(/[:.]/g, "-")
    fs.writeFileSync(path.join(dir, `${stamp}_uncaughtException.json`), "{}")
  }
}

beforeEach(reset)
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("CrashReporter.isBrokenPipe", () => {
  test("EPIPE is not archived — it is the loop trigger", () => {
    const err = Object.assign(new Error("EPIPE: broken pipe, write"), { code: "EPIPE" })
    expect(CrashReporter.isBrokenPipe(err)).toBe(true)
  })

  test("ERR_STREAM_DESTROYED is treated the same way", () => {
    const err = Object.assign(new Error("write after end"), { code: "ERR_STREAM_DESTROYED" })
    expect(CrashReporter.isBrokenPipe(err)).toBe(true)
  })

  test("a real defect is still archived", () => {
    expect(CrashReporter.isBrokenPipe(new TypeError("x is not a function"))).toBe(false)
    expect(CrashReporter.isBrokenPipe(Object.assign(new Error("nope"), { code: "ENOENT" }))).toBe(false)
  })

  test("null and non-error values do not throw", () => {
    expect(CrashReporter.isBrokenPipe(null)).toBe(false)
    expect(CrashReporter.isBrokenPipe(undefined)).toBe(false)
    expect(CrashReporter.isBrokenPipe("EPIPE")).toBe(false)
  })
})

describe("CrashReporter.purgeOld", () => {
  test("keeps the directory untouched when under the retention cap", async () => {
    seed(10)
    await CrashReporter.purgeOld()
    expect(CrashReporter.listReports().length).toBe(10)
  })

  test("deletes oldest-first, keeping the most recent reports", async () => {
    seed(60)
    const before = CrashReporter.listReports()
    await CrashReporter.purgeOld()
    const after = CrashReporter.listReports()

    expect(after.length).toBe(50)
    // ISO names sort chronologically: the survivors must be the newest tail.
    expect(after).toEqual(before.slice(10))
  })

  test("ignores non-report files", async () => {
    seed(55)
    fs.writeFileSync(path.join(dir, "notes.txt"), "keep me")
    await CrashReporter.purgeOld()

    expect(CrashReporter.listReports().length).toBe(50)
    expect(fs.existsSync(path.join(dir, "notes.txt"))).toBe(true)
  })

  test("a missing directory is a no-op, not a throw", async () => {
    fs.rmSync(dir, { recursive: true, force: true })
    await expect(CrashReporter.purgeOld()).resolves.toBeUndefined()
  })

  test("caps deletions per run so a degraded directory drains gradually", async () => {
    // 1050 reports = 50 to keep + 1000 deletable, exactly MAX_PURGE_PER_RUN.
    seed(1080)
    await CrashReporter.purgeOld()
    // 1080 - 50 = 1030 excess, but only 1000 may go in one run.
    expect(CrashReporter.listReports().length).toBe(80)

    await CrashReporter.purgeOld()
    expect(CrashReporter.listReports().length).toBe(50)
  })
})
