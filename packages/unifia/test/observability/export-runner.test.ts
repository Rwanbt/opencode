import { describe, expect, test } from "bun:test"
import { exportToAll, exportWithRetry } from "../../src/observability/export-runner"
import type { Exporter } from "../../src/observability/exporter"
import type { ExportProjection } from "../../src/observability/export-projection"

const noopSleep = async () => {}

const sampleProjection: ExportProjection = {
  eventId: "evt",
  traceId: "trace",
  spanId: "span",
  type: "llm.call.finished",
  status: "finished",
  tsMs: Date.now(),
  redactionStatus: "metadata_only",
  redactedClasses: [],
}

function flakyExporter(name: string, failuresBeforeSuccess: number): Exporter {
  let calls = 0
  return {
    name,
    async export() {
      calls++
      if (calls <= failuresBeforeSuccess) throw new Error(`transient failure ${calls}`)
    },
  }
}

function alwaysFailingExporter(name: string): Exporter {
  return {
    name,
    async export() {
      throw new Error("permanent failure")
    },
  }
}

describe("exportWithRetry (Phase 4)", () => {
  test("succeeds on the first attempt without sleeping", async () => {
    const exporter = flakyExporter("ok", 0)
    const result = await exportWithRetry(exporter, [sampleProjection], { sleep: noopSleep })
    expect(result).toEqual({ exporter: "ok", ok: true, attempts: 1 })
  })

  test("retries transient failures and eventually succeeds", async () => {
    const exporter = flakyExporter("flaky", 2)
    const sleeps: number[] = []
    const result = await exportWithRetry(exporter, [sampleProjection], {
      sleep: async (ms) => void sleeps.push(ms),
      backoffMs: [10, 20, 30],
    })
    expect(result).toEqual({ exporter: "flaky", ok: true, attempts: 3 })
    expect(sleeps).toEqual([10, 20])
  })

  test("gives up after exhausting all retries and reports the last error", async () => {
    const exporter = alwaysFailingExporter("broken")
    const result = await exportWithRetry(exporter, [sampleProjection], {
      sleep: noopSleep,
      backoffMs: [10, 20, 30],
    })
    expect(result.ok).toBe(false)
    expect(result.exporter).toBe("broken")
    expect(result.attempts).toBe(4) // 3 backoff slots => 4 total attempts
    expect(result.error).toContain("permanent failure")
  })

  test("never throws — a permanently failing exporter resolves, not rejects", async () => {
    const exporter = alwaysFailingExporter("broken")
    await expect(exportWithRetry(exporter, [sampleProjection], { sleep: noopSleep, backoffMs: [1] })).resolves.toMatchObject({ ok: false })
  })
})

describe("exportToAll (Phase 4)", () => {
  test("runs every exporter independently — one exporter's failure does not affect another's success", async () => {
    const good = flakyExporter("good", 0)
    const bad = alwaysFailingExporter("bad")
    const results = await exportToAll([good, bad], [sampleProjection], { sleep: noopSleep, backoffMs: [1] })
    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ exporter: "good", ok: true })
    expect(results[1]).toMatchObject({ exporter: "bad", ok: false })
  })

  test("empty exporter list returns an empty result list without calling anything", async () => {
    const results = await exportToAll([], [sampleProjection])
    expect(results).toEqual([])
  })
})
