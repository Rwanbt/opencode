import { Config } from "@/config/config"
import { Database } from "@/storage/db"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { purgeByRetention, purgeExpiredContent } from "./purge"
import { purgeExpiredOptIns } from "./capture-content"
import { ObservabilityRepository } from "./repository"
import { ObservabilityService } from "./service"

const log = Log.create({ service: "observability" })
const FLUSH_INTERVAL_MS = 250
const RETENTION_INTERVAL_MS = 60 * 60 * 1000

interface Runtime {
  service: ObservabilityService
  flushTimer: ReturnType<typeof setInterval>
  retentionTimer: ReturnType<typeof setInterval>
}

function boot(): Runtime {
  const service = new ObservabilityService(ObservabilityRepository)
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
  const flushTimer = setInterval(() => {
    void flush().catch((error) => log.warn("observability flush failed", { error }))
  }, FLUSH_INTERVAL_MS)
  const retentionTimer = setInterval(() => {
    void purge().catch((error) => log.warn("observability retention purge failed", { error }))
  }, RETENTION_INTERVAL_MS)
  flushTimer.unref?.()
  retentionTimer.unref?.()
  void purge().catch((error) => log.warn("observability initial retention purge failed", { error }))
  return { service, flushTimer, retentionTimer }
}

async function shutdown(runtime: Runtime) {
  clearInterval(runtime.flushTimer)
  clearInterval(runtime.retentionTimer)
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
