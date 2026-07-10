export const EMBEDDED_SERVER_HEALTH_POLL_MS = 10_000
export const EMBEDDED_SERVER_FAILURE_THRESHOLD = 2

export interface EmbeddedServerRecoveryDependencies {
  checkHealth: () => Promise<boolean>
  restart: () => Promise<unknown>
  failureThreshold?: number
}

export function createEmbeddedServerRecovery(dependencies: EmbeddedServerRecoveryDependencies) {
  let consecutiveFailures = 0
  let restartInFlight = false

  return async function poll() {
    if (restartInFlight) return
    if (await dependencies.checkHealth()) {
      consecutiveFailures = 0
      return
    }

    consecutiveFailures += 1
    if (consecutiveFailures < (dependencies.failureThreshold ?? EMBEDDED_SERVER_FAILURE_THRESHOLD)) return

    restartInFlight = true
    try {
      await dependencies.restart()
      consecutiveFailures = 0
    } finally {
      restartInFlight = false
    }
  }
}
