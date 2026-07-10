import { Instance } from "@/project/instance"
import { ObservabilityRepository } from "./repository"
import { ObservabilityService } from "./service"

const FLUSH_INTERVAL_MS = 250

interface Runtime {
  service: ObservabilityService
  timer: ReturnType<typeof setInterval>
}

function boot(): Runtime {
  const service = new ObservabilityService(ObservabilityRepository)
  const timer = setInterval(() => {
    void service.flush().catch(() => {})
  }, FLUSH_INTERVAL_MS)
  timer.unref?.()
  return { service, timer }
}

async function shutdown(runtime: Runtime) {
  clearInterval(runtime.timer)
  await runtime.service.flush().catch(() => {})
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
