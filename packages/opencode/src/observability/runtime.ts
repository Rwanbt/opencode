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
import { secret as hmacSecret } from "./hmac-secret"

const log = Log.create({ service: "observability" })
const FLUSH_INTERVAL_MS = 250
const RETENTION_INTERVAL_MS = 60 * 60 * 1000
// Phase 4 (ADR-1026): separate, shorter interval than retention — exporters
// are meant to mirror events out close to real time, not once an hour.
const EXPORT_INTERVAL_MS = 5_000
const EXPORT_BATCH_SIZE = 500

interface Runtime {
  service: ObservabilityService
  flushTimer: ReturnType<typeof setInterval>
  retentionTimer: ReturnType<typeof setInterval>
  exportTimer: ReturnType<typeof setInterval>
}

function boot(): Runtime {
  const service = new ObservabilityService(ObservabilityRepository)
  // In-memory only, seeded to "now" at boot (ADR-1026: no historical
  // backfill — a freshly-configured exporter only ever sees events inserted
  // after this instance started, never the pre-existing backlog). Lost on
  // restart same as every other in-memory counter in this module (service.ts
  // stats() has the same limitation, documented in the plan).
  let exportCursorId = ObservabilityRepository.maxId()
  const flush = Instance.bind(async () => {
    await service.flush()
  })
  const purge = Instance.bind(async () => {
    const config = await Config.get()
    const result = purgeByRetention(config.experimental?.observability)
    if (result.deletedCount > 0) log.info("purged retained observability events", result)
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
    const exporters = ExporterRegistry.from(config.experimental?.observability)
    if (!exporters.length) return
    const rows = ObservabilityRepository.since(exportCursorId, EXPORT_BATCH_SIZE)
    if (!rows.length) return
    exportCursorId = rows[rows.length - 1]!.id
    const exportable = rows.filter(shouldExportSpan)
    if (!exportable.length) return
    const secretBytes = await hmacSecret()
    const projections = exportable.map((row) => toExportProjection(row, secretBytes))
    for (const exporter of exporters) {
      try {
        await exporter.export(projections)
      } catch (error) {
        // One exporter's failure never blocks another's, and never
        // re-queues — a dropped export batch is a known Phase 4 limitation
        // (no retry), same posture as the rest of this module toward
        // observability-path failures never affecting the product session.
        log.warn("observability exporter failed", { exporter: exporter.name, error })
      }
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
  return { service, flushTimer, retentionTimer, exportTimer }
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
}
