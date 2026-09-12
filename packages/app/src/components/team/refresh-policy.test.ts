import { describe, expect, test } from "bun:test"
import {
  DEFAULT_MAX_DELAY_MS,
  planRecovery,
  retryDelayMs,
  shouldEmit,
  shouldRetry,
} from "./refresh-policy"

// Coverage for the TEAM-M03 throttle and error-recovery criteria.
//
// Written against decisions rather than timers: a test that waits for a real
// 30-second backoff is a test nobody runs, and one that mocks the clock proves
// the mock works. These assert the answers the policy gives.

describe("shouldEmit — a throttle holds, it does not drop", () => {
  test("the first update is always applied", () => {
    // Nothing has been shown yet, so holding would leave the surface empty for
    // a whole interval on first load.
    expect(shouldEmit({ lastEmitAt: undefined, now: 0 })).toBe(true)
  })

  test("an update inside the window is held", () => {
    expect(shouldEmit({ lastEmitAt: 1_000, now: 1_100, intervalMs: 500 })).toBe(false)
  })

  test("an update at exactly the interval is applied", () => {
    // The boundary belongs to "emit": rounding it the other way makes the
    // effective interval one tick longer than the one that was configured.
    expect(shouldEmit({ lastEmitAt: 1_000, now: 1_500, intervalMs: 500 })).toBe(true)
  })

  test("an update past the window is applied", () => {
    expect(shouldEmit({ lastEmitAt: 1_000, now: 9_000, intervalMs: 500 })).toBe(true)
  })
})

describe("retryDelayMs — backoff has a ceiling", () => {
  test("the first retry is the base delay", () => {
    expect(retryDelayMs(1, { baseMs: 500 })).toBe(500)
  })

  test("each attempt doubles", () => {
    expect(retryDelayMs(2, { baseMs: 500 })).toBe(1_000)
    expect(retryDelayMs(3, { baseMs: 500 })).toBe(2_000)
    expect(retryDelayMs(4, { baseMs: 500 })).toBe(4_000)
  })

  test("the ceiling holds however long the outage lasts", () => {
    // Without it, attempt 20 asks for 4.5 days. With it, a long outage costs a
    // request every 30 seconds.
    expect(retryDelayMs(20, { baseMs: 500 })).toBe(DEFAULT_MAX_DELAY_MS)
    expect(retryDelayMs(50)).toBe(DEFAULT_MAX_DELAY_MS)
  })

  test("attempt zero waits not at all", () => {
    expect(retryDelayMs(0)).toBe(0)
  })
})

describe("shouldRetry — only conditions that can pass", () => {
  test("offline is retried: the network comes back", () => {
    expect(shouldRetry({ reachability: "offline", attempt: 1 })).toBe(true)
  })

  test("unavailable is retried: the registry finishes loading", () => {
    expect(shouldRetry({ reachability: "unavailable", attempt: 1 })).toBe(true)
  })

  test("a plain error is never retried", () => {
    // A 400 answers the same way however many times it is asked. Retrying it
    // converts a client bug into sustained load that cannot succeed.
    expect(shouldRetry({ reachability: "error", attempt: 1 })).toBe(false)
    expect(shouldRetry({ reachability: "error", attempt: 0 })).toBe(false)
  })

  test("success is not retried", () => {
    expect(shouldRetry({ reachability: "ok", attempt: 0 })).toBe(false)
  })

  test("attempts are capped", () => {
    expect(shouldRetry({ reachability: "offline", attempt: 4, maxAttempts: 5 })).toBe(true)
    expect(shouldRetry({ reachability: "offline", attempt: 5, maxAttempts: 5 })).toBe(false)
  })
})

describe("planRecovery — giving up is a state, not silence", () => {
  test("a recoverable failure plans the next attempt", () => {
    const plan = planRecovery({ reachability: "offline", attempt: 0, baseMs: 500 })

    expect(plan.retry).toBe(true)
    expect(plan.delayMs).toBe(500)
    expect(plan.exhausted).toBe(false)
  })

  test("delays grow across attempts", () => {
    expect(planRecovery({ reachability: "offline", attempt: 2, baseMs: 500 }).delayMs).toBe(2_000)
  })

  test("running out of attempts is reported as exhausted, not as success", () => {
    // Folding this into `retry: false` alone leaves a screen that quietly
    // stops updating with nothing saying why.
    const plan = planRecovery({ reachability: "offline", attempt: 5, maxAttempts: 5 })

    expect(plan.retry).toBe(false)
    expect(plan.exhausted).toBe(true)
    expect(plan.delayMs).toBe(0)
  })

  test("an unrecoverable error is not 'exhausted' — it was never retryable", () => {
    // The distinction matters on screen: "we gave up after 5 tries" invites a
    // retry, "this request is wrong" does not.
    const plan = planRecovery({ reachability: "error", attempt: 0 })

    expect(plan.retry).toBe(false)
    expect(plan.exhausted).toBe(false)
  })

  test("success is neither retrying nor exhausted", () => {
    const plan = planRecovery({ reachability: "ok", attempt: 3 })

    expect(plan.retry).toBe(false)
    expect(plan.exhausted).toBe(false)
  })
})
