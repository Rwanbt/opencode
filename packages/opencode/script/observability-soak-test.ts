// Phase 4 soak test harness (plan §14/§18: "soak test 24h"). This script
// exists so the 24h run can actually be executed — it cannot be executed BY
// an agent inside one session, since it requires 24 real wall-clock hours of
// a live process. Nothing in this repository can complete that gate; it must
// be run manually (or in a dedicated long-running CI job) before Phase 4 is
// declared production-ready per plan §22.
//
// Usage:
//   bun run script/observability-soak-test.ts --duration-ms=86400000 --rate-per-sec=20
//   bun run script/observability-soak-test.ts --duration-ms=10000 --rate-per-sec=50   # smoke test
//
// What it does: boots one ObservabilityRuntime instance against an isolated
// XDG_*_HOME (never the real user profile — see the top-of-file env
// overrides below, set before ANY relative import so global/index.ts picks
// them up at its own module-load time), then continuously calls
// service.record() at the requested rate with a realistic mix of event
// types (llm started/finished/failed/aborted, tool started/finished/failed),
// logging service.stats() and process.memoryUsage() on an interval so a
// human reviewing the log afterwards can judge whether the queue, circuit
// breaker, or process memory trended toward a problem over the full run.
// Ends with a final flush and `PRAGMA integrity_check`.
import { mkdtempSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const soakHome = mkdtempSync(path.join(os.tmpdir(), "opencode-observability-soak-"))
process.env.XDG_DATA_HOME = path.join(soakHome, "data")
process.env.XDG_CONFIG_HOME = path.join(soakHome, "config")
process.env.XDG_CACHE_HOME = path.join(soakHome, "cache")
process.env.XDG_STATE_HOME = path.join(soakHome, "state")
process.env.OPENCODE_TEST_HOME = soakHome

const { Instance } = await import("../src/project/instance")
const { ObservabilityRuntime } = await import("../src/observability/runtime")
const { createTraceContext } = await import("../src/observability/trace-context")
const { Database, sql } = await import("../src/storage/db")

function parseArg(name: string, fallback: number): number {
  const flag = process.argv.find((arg) => arg.startsWith(`--${name}=`))
  if (!flag) return fallback
  const value = Number(flag.split("=")[1])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const DURATION_MS = parseArg("duration-ms", 24 * 60 * 60 * 1000)
const RATE_PER_SEC = parseArg("rate-per-sec", 20)
const LOG_INTERVAL_MS = parseArg("log-interval-ms", 60_000)
const TICK_MS = Math.max(1, Math.round(1000 / RATE_PER_SEC))

const EVENT_KINDS: Array<{ type: string; status: string }> = [
  { type: "llm.call.started", status: "started" },
  { type: "llm.call.finished", status: "finished" },
  { type: "llm.call.failed", status: "failed" },
  { type: "llm.call.aborted", status: "aborted" },
  { type: "tool.call.started", status: "started" },
  { type: "tool.call.finished", status: "finished" },
  { type: "tool.call.failed", status: "failed" },
]

function syntheticEvent(i: number) {
  const kind = EVENT_KINDS[i % EVENT_KINDS.length]!
  const isLlm = kind.type.startsWith("llm.")
  return {
    type: kind.type as any,
    status: kind.status as any,
    tsMs: Date.now(),
    durationMs: kind.status === "started" ? undefined : 50 + (i % 500),
    redactionStatus: "metadata_only" as const,
    payloadTruncated: false,
    schemaVersion: 1 as const,
    metadata: isLlm
      ? { modelProvider: "anthropic", modelId: "claude-sonnet-5", inputTokens: 100 + (i % 50), outputTokens: 50 + (i % 30) }
      : { toolKind: "read", toolNameHmac: "0".repeat(64) },
    localRedacted: { classes: [] },
    costNanoUsd: isLlm && kind.status === "finished" ? 1000 + (i % 200) : undefined,
  }
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${hours}h${minutes}m${seconds}s`
}

async function main() {
  console.log(`[soak] isolated home: ${soakHome}`)
  console.log(`[soak] duration=${formatDuration(DURATION_MS)} rate=${RATE_PER_SEC}/s tick=${TICK_MS}ms`)

  const startedAt = Date.now()
  const startRssMb = process.memoryUsage().rss / (1024 * 1024)
  let recorded = 0
  let recordErrors = 0
  let lastLogAt = startedAt
  let stop = false

  process.on("SIGINT", () => {
    console.log("\n[soak] SIGINT received, finishing current tick and shutting down cleanly...")
    stop = true
  })

  await Instance.provide({
    directory: soakHome,
    fn: async () => {
      const service = ObservabilityRuntime.service()

      while (!stop && Date.now() - startedAt < DURATION_MS) {
        const result = service.record(createTraceContext(), syntheticEvent(recorded))
        recorded++
        if (!result.ok) recordErrors++

        const now = Date.now()
        if (now - lastLogAt >= LOG_INTERVAL_MS) {
          lastLogAt = now
          const stats = service.stats()
          const rssMb = process.memoryUsage().rss / (1024 * 1024)
          console.log(
            `[soak] t=${formatDuration(now - startedAt)} recorded=${recorded} recordErrors=${recordErrors} ` +
              `rssMb=${rssMb.toFixed(1)} (Δ${(rssMb - startRssMb).toFixed(1)}) ` +
              `queueSize=${stats.queueSize} queueBytes=${stats.queueBytes} circuitOpen=${stats.circuitOpen} ` +
              `inserted=${stats.eventsInserted} droppedQueueFull=${stats.eventsDroppedQueueFull} ` +
              `failedDb=${stats.eventsFailedDb} failedBusy=${stats.eventsFailedBusy} sanitizerFailed=${stats.sanitizerFailed}`,
          )
          if (stats.circuitOpen) {
            console.warn(`[soak] WARNING: circuit breaker is open at t=${formatDuration(now - startedAt)}`)
          }
        }

        await Bun.sleep(TICK_MS)
      }

      console.log("[soak] loop ended, flushing remaining queue...")
      await service.flush(10_000)
      const finalStats = service.stats()
      console.log("[soak] final stats:", finalStats)

      const integrity = Database.use((db) => db.all(sql.raw("PRAGMA integrity_check")))
      console.log("[soak] PRAGMA integrity_check:", integrity)

      const finalRssMb = process.memoryUsage().rss / (1024 * 1024)
      console.log(
        `[soak] done: recorded=${recorded} recordErrors=${recordErrors} ` +
          `rssMb start=${startRssMb.toFixed(1)} end=${finalRssMb.toFixed(1)} delta=${(finalRssMb - startRssMb).toFixed(1)}`,
      )
      if (finalStats.circuitOpen) {
        console.error("[soak] FAIL: circuit breaker still open at end of run")
        process.exitCode = 1
      }
    },
  })

  await Instance.disposeAll().catch(() => {})
}

await main()
