import { Config } from "@/config/config"
import { Database } from "@/storage/db"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { purgeByRetention, purgeExpiredContent } from "./purge"
import { purgeExpiredOptIns } from "./capture-content"
import { ObservabilityRepository } from "./repository"
import { ObservabilityService } from "./service"
import { ExporterRegistry } from "./exporter"
import { shouldExportSpan, toExportProjection } from "./export-projection"
import { exportToAll, type ExportAttemptResult } from "./export-runner"
import { secret as hmacSecret } from "./hmac-secret"

const log = Log.create({ service: "observability" })
const FLUSH_INTERVAL_MS = 250
// At 20 events/s, a 5s cadence sees at most 100 new rows between runs.
// The bounded purge batch therefore catches up without making the capture path
// wait for a large historical delete.
const RETENTION_INTERVAL_MS = 5_000
// Phase 4 (ADR-1026): exporters run on their own timer and mirror events close
// to real time without coupling export work to retention cleanup.
const EXPORT_INTERVAL_MS = 5_000
const EXPORT_BATCH_SIZE = 500

export interface ExportRunSnapshot {
  atMs: number
  results: ExportAttemptResult[]
}

interface Runtime {
  service: ObservabilityService
  flushTimer: ReturnType<typeof setInterval>
  retentionTimer: ReturnType<typeof setInterval>
  exportTimer: ReturnType<typeof setInterval>
  lastExportRun?: ExportRunSnapshot
  runExportOnce: () => Promise<void>
}

function boot(): Runtime {
  const service = new ObservabilityService(ObservabilityRepository)
  // Resolved lazily on the first tick that finds at least one exporter
  // configured — not eagerly at boot — because the choice depends on
  // `backfillOnStart` (config, read async) and because an instance that
  // never configures an exporter should never even decide a cursor value
  // (ADR-1026, invariants 2/3/4: zero cost while exporters is empty).
  // "Backfill" here means "from the first tick exporting actually turns on",
  // which is boot time in the common case but can be later if exporters are
  // added via a live config reload.
  let exportCursorId: number | undefined
  const runtime: Runtime = {
    service,
    flushTimer: undefined as unknown as ReturnType<typeof setInterval>,
    retentionTimer: undefined as unknown as ReturnType<typeof setInterval>,
    exportTimer: undefined as unknown as ReturnType<typeof setInterval>,
    runExportOnce: async () => {},
  }
  const flush = Instance.bind(async () => {
    await service.flush()
  })
  const purge = Instance.bind(async () => {
    const config = await Config.get()
    const result = purgeByRetention(config.experimental?.observability)
    if (result.deletedCount > 0) log.info("purged retained observability events", result)
    if (result.deletedCount > 0) Database.use((db) => db.run("PRAGMA wal_checkpoint(PASSIVE)"))
    // Phase 3 (ADR-1032): opt-in expiry is passive (checked on every
    // resolveContentCaptureLevel() call) but rows/opt-ins are also swept
    // here so an abandoned opt-in with no further traffic still gets
    // cleaned up instead of lingering until the process happens to check it.
    const expiredContent = purgeExpiredContent()
    if (expiredContent > 0) log.info("purged expired observability content", { expiredContent })
    const expiredOptIns = purgeExpiredOptIns()
    if (expiredOptIns > 0) log.info("purged expired observability content opt-ins", { expiredOptIns })
  })
  // Zero-cost when no exporters are configured (the default): returns before
  // touching the repository or building a single ExportProjection, so an
  // idle instance with `exporters` unset never queries the DB on this timer,
  // let alone the network (ADR-1026, invariants 2/3/4).
  const runExport = Instance.bind(async () => {
    const config = await Config.get()
    const obsConfig = config.experimental?.observability
    const exporters = ExporterRegistry.from(obsConfig)
    if (!exporters.length) return
    if (exportCursorId === undefined) {
      exportCursorId = obsConfig?.backfillOnStart ? 0 : ObservabilityRepository.maxId()
    }
    const rows = ObservabilityRepository.since(exportCursorId, EXPORT_BATCH_SIZE)
    if (!rows.length) return
    // Cursor advances once per batch regardless of outcome — after
    // exportWithRetry's bounded retries are exhausted, this batch is given
    // up on (logged) rather than retried forever, so one poison batch can
    // never permanently stall every later event's export.
    exportCursorId = rows[rows.length - 1]!.id
    const exportable = rows.filter(shouldExportSpan)
    if (!exportable.length) return
    const secretBytes = await hmacSecret()
    const projections = exportable.map((row) => toExportProjection(row, secretBytes))
    const results = await exportToAll(exporters, projections)
    runtime.lastExportRun = { atMs: Date.now(), results }
    for (const result of results) {
      if (!result.ok) log.warn("observability exporter failed after retries", { exporter: result.exporter, attempts: result.attempts, error: result.error })
    }
  })
  const flushTimer = setInterval(() => {
    void flush().catch((error) => log.warn("observability flush failed", { error }))
  }, FLUSH_INTERVAL_MS)
  const retentionTimer = setInterval(() => {
    void purge().catch((error) => log.warn("observability retention purge failed", { error }))
  }, RETENTION_INTERVAL_MS)
  const exportTimer = setInterval(() => {
    void runExport().catch((error) => log.warn("observability export tick failed", { error }))
  }, EXPORT_INTERVAL_MS)
  flushTimer.unref?.()
  retentionTimer.unref?.()
  exportTimer.unref?.()
  void purge().catch((error) => log.warn("observability initial retention purge failed", { error }))
  runtime.flushTimer = flushTimer
  runtime.retentionTimer = retentionTimer
  runtime.exportTimer = exportTimer
  runtime.runExportOnce = runExport
  return runtime
}

async function shutdown(runtime: Runtime) {
  clearInterval(runtime.flushTimer)
  clearInterval(runtime.retentionTimer)
  clearInterval(runtime.exportTimer)
  await runtime.service.flush().catch((error) => log.warn("observability shutdown flush failed", { error }))
  Database.use((db) => db.run("PRAGMA wal_checkpoint(TRUNCATE)"))
}

// One ObservabilityService per project instance (Instance.state), never a
// module-level singleton: each directory gets its own queue/circuit breaker
// and is flushed + disposed when the instance is disposed.
const state = Instance.state(boot, shutdown)

export const ObservabilityRuntime = {
  service(): ObservabilityService {
    return state().service
  },
  // Last periodic export tick's outcome (per exporter), if any exporter has
  // ever been configured for this instance. Undefined until the first tick
  // that found at least one row to export.
  exportStats(): ExportRunSnapshot | undefined {
    return state().lastExportRun
  },
  // Manually triggers one export tick immediately, instead of waiting for
  // the 5s timer — used by tests, and available for a future "export now"
  // affordance. Same zero-cost-when-empty and retry/cursor semantics as the
  // periodic tick, since it IS the periodic tick's function.
  runExportOnce(): Promise<void> {
    return state().runExportOnce()
  },
}
