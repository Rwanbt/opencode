import { describe, expect, test } from "bun:test"
import { createTeamSync, RESUME_STALE_AFTER_MS, type TeamSyncDependencies } from "./team-sync"

// Coverage for the TEAM-M04 background/resume and connectivity criteria.
//
// The clock and the network are injected, so these assert the policy's answers
// instead of suspending a phone for thirty seconds.

function harness(overrides: Partial<TeamSyncDependencies> = {}) {
  let clock = 1_000
  let refreshes = 0
  let release: (() => void) | undefined

  const sync = createTeamSync({
    isOnline: () => true,
    now: () => clock,
    refresh: async () => {
      refreshes += 1
      if (release) await new Promise<void>((resolve) => (release = resolve))
    },
    ...overrides,
  })

  return {
    sync,
    advance: (ms: number) => {
      clock += ms
    },
    get refreshes() {
      return refreshes
    },
    holdNextRefresh: () => {
      release = () => {}
    },
  }
}

describe("onResume — fresh enough is left alone", () => {
  test("the first resume refreshes: nothing is held yet", async () => {
    const h = harness()

    expect(await h.sync.onResume()).toBe("refreshed")
    expect(h.refreshes).toBe(1)
  })

  test("a resume moments later does not refetch", async () => {
    // An app that refetches on every task switch drains a battery the user can
    // feel, from a screen they are not looking at.
    const h = harness()
    await h.sync.onResume()
    h.advance(2_000)

    expect(await h.sync.onResume()).toBe("fresh")
    expect(h.refreshes).toBe(1)
  })

  test("a resume after a long suspend refreshes", async () => {
    // Yesterday's runs shown as current is worse than a spinner.
    const h = harness()
    await h.sync.onResume()
    h.advance(RESUME_STALE_AFTER_MS + 1)

    expect(await h.sync.onResume()).toBe("refreshed")
    expect(h.refreshes).toBe(2)
  })

  test("the staleness window is configurable and respected", async () => {
    const h = harness({ staleAfterMs: 5_000 })
    await h.sync.onResume()
    h.advance(4_999)
    expect(await h.sync.onResume()).toBe("fresh")

    h.advance(2)
    expect(await h.sync.onResume()).toBe("refreshed")
  })
})

describe("onResume — offline is remembered, not attempted", () => {
  test("resuming with no network does not fetch", async () => {
    // A request with no network fails, and that failure would spend a recovery
    // attempt on a condition the client already knows about.
    const h = harness({ isOnline: () => false })

    expect(await h.sync.onResume()).toBe("offline")
    expect(h.refreshes).toBe(0)
  })

  test("resuming offline marks a refresh as owed", async () => {
    const h = harness({ isOnline: () => false })
    await h.sync.onResume()

    expect(h.sync.pendingRefresh()).toBe(true)
  })

  test("losing connectivity marks a refresh as owed", async () => {
    const h = harness()
    await h.sync.onResume()
    expect(h.sync.pendingRefresh()).toBe(false)

    h.sync.onDisconnect()

    expect(h.sync.pendingRefresh()).toBe(true)
  })
})

describe("onReconnect — coming back always refetches", () => {
  test("refetches even when the last refresh was recent", async () => {
    // Being offline is precisely the case where what is held may have been
    // superseded without the device hearing about it.
    const h = harness()
    await h.sync.onResume()
    h.advance(100)

    expect(await h.sync.onReconnect()).toBe("refreshed")
    expect(h.refreshes).toBe(2)
  })

  test("clears the owed refresh", async () => {
    const h = harness()
    h.sync.onDisconnect()
    expect(h.sync.pendingRefresh()).toBe(true)

    await h.sync.onReconnect()

    expect(h.sync.pendingRefresh()).toBe(false)
  })

  test("a reconnect event that is not actually online does nothing", async () => {
    const h = harness({ isOnline: () => false })

    expect(await h.sync.onReconnect()).toBe("offline")
    expect(h.refreshes).toBe(0)
  })
})

describe("concurrency — one user action, one request", () => {
  test("a resume that also restores the network fetches once, not twice", async () => {
    // Android delivers resume and connectivity-restored as separate events for
    // what the user experienced as unlocking their phone.
    let resolveRefresh: (() => void) | undefined
    let refreshes = 0
    const sync = createTeamSync({
      isOnline: () => true,
      now: () => 1_000,
      refresh: () =>
        new Promise<void>((resolve) => {
          refreshes += 1
          resolveRefresh = resolve
        }),
    })

    const first = sync.onResume()
    const second = sync.onReconnect()
    resolveRefresh?.()
    const outcomes = await Promise.all([first, second])

    expect(refreshes).toBe(1)
    expect(outcomes).toContain("refreshed")
    expect(outcomes).toContain("coalesced")
  })

  test("a failed refresh does not leave the sync permanently blocked", async () => {
    // Without the finally, one rejection would make every later trigger
    // coalesce into a promise that is already dead.
    let attempt = 0
    const sync = createTeamSync({
      isOnline: () => true,
      now: () => 1_000,
      refresh: async () => {
        attempt += 1
        if (attempt === 1) throw new Error("network dropped mid-request")
      },
    })

    await expect(sync.onResume()).rejects.toThrow("network dropped mid-request")
    expect(await sync.onReconnect()).toBe("refreshed")
    expect(attempt).toBe(2)
  })
})
