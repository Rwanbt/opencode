import { describe, expect, test } from "bun:test"
import { createEmbeddedServerRecovery } from "./embedded-server-recovery"

describe("EmbeddedServerRecovery", () => {
  test("EmbeddedServerRecovery_TransientFailure_DoesNotRestart", async () => {
    const results = [false, true]
    let restartCount = 0
    const poll = createEmbeddedServerRecovery({
      checkHealth: async () => results.shift() ?? true,
      restart: async () => restartCount++,
    })

    await poll()
    await poll()

    expect(restartCount).toBe(0)
  })

  test("EmbeddedServerRecovery_ConsecutiveFailures_RestartsOnce", async () => {
    let restartCount = 0
    const poll = createEmbeddedServerRecovery({
      checkHealth: async () => false,
      restart: async () => restartCount++,
    })

    await poll()
    await poll()

    expect(restartCount).toBe(1)
  })

  test("EmbeddedServerRecovery_ConcurrentPolls_DoesNotStartParallelRestarts", async () => {
    let releaseRestart!: () => void
    const restartBlocked = new Promise<void>((resolve) => (releaseRestart = resolve))
    let restartCount = 0
    const poll = createEmbeddedServerRecovery({
      failureThreshold: 1,
      checkHealth: async () => false,
      restart: async () => {
        restartCount += 1
        await restartBlocked
      },
    })

    const first = poll()
    await Promise.resolve()
    await poll()
    releaseRestart()
    await first

    expect(restartCount).toBe(1)
  })
})

