import { afterEach, describe, expect, test } from "bun:test"
import { DebateLive, executeWithLiveTracking } from "../../src/tool/debate"
import { Bus } from "../../src/bus"
import * as Events from "../../src/collective/events"
import { Collective } from "../../src/collective/types"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

function withInstance(directory: string, fn: () => Promise<void>) {
  return Instance.provide({ directory, fn })
}

function makeConfig(): Collective.DebateConfig {
  return {
    question: "test question",
    tier: "quick",
    redTeam: "auto",
    enableMeta: true,
    enableCanary: false,
    enableShadowBaseline: true,
    noMemory: false,
    maxRounds: 2,
  }
}

function makeReport(id: Collective.DebateID): Collective.DebateReport {
  return {
    id,
    prompt: "test question",
    timestamp: new Date().toISOString(),
    tier: "quick",
    providers: ["a/model-a", "b/model-b"],
    failedProviders: [],
    roles: {},
    cost: 0.01,
    durationMs: 100,
    consensus: [],
    blindSpots: [],
    unresolvedConflicts: [],
    traceability: [],
    tokenUsage: { total: 0, byPhase: {}, byProvider: {} },
    markdown: "# report",
  }
}

describe("DebateLive.createTracker", () => {
  test("applies started -> completed transition and reports final status", () => {
    const flushes: DebateLive.Snapshot[] = []
    const tracker = DebateLive.createTracker((snapshot) => flushes.push(snapshot))

    tracker.enqueue({ kind: "phase", phase: "phase1_diverge" })
    tracker.enqueue({ kind: "started", provider: "a/model-a", role: "critic", phase: "phase1_diverge" })
    tracker.enqueue({ kind: "completed", provider: "a/model-a", tokens: 42, durationMs: 10, phase: "phase1_diverge" })

    const snapshot = tracker.snapshot()
    expect(snapshot.phase).toBe("phase1_diverge")
    expect(snapshot.participants["a/model-a"]).toEqual({
      role: "critic",
      currentPhase: "phase1_diverge",
      status: "done",
      tokens: 42,
      durationMs: 10,
    })
    // Each enqueue synchronously drains its own event and flushes once.
    expect(flushes.length).toBe(3)
  })

  test("preserves role across started -> failed even though failed events don't carry a role", () => {
    const tracker = DebateLive.createTracker(() => {})
    tracker.enqueue({ kind: "started", provider: "a/model-a", role: "advocate", phase: "phase1_diverge" })
    tracker.enqueue({ kind: "failed", provider: "a/model-a", error: "boom", phase: "phase1_diverge" })

    const snapshot = tracker.snapshot()
    expect(snapshot.participants["a/model-a"].role).toBe("advocate")
    expect(snapshot.participants["a/model-a"].status).toBe("failed")
    expect(snapshot.participants["a/model-a"].error).toBe("boom")
  })

  test("processes events strictly in enqueue order, even when several are queued before draining starts", () => {
    // Simulate several events arriving "simultaneously" by enqueueing them
    // all before any flush is observed — this is the scenario the internal
    // FIFO queue exists to protect against (see tool/debate.ts comment).
    const order: string[] = []
    let reentered = false
    const tracker = DebateLive.createTracker(() => {
      // If a flush handler enqueues more events, they must NOT be applied
      // out of order relative to events already queued at call time.
      if (!reentered) {
        reentered = true
        tracker.enqueue({ kind: "started", provider: "c/model-c", role: undefined, phase: "phase1_diverge" })
      }
    })

    tracker.enqueue({ kind: "started", provider: "a/model-a", role: undefined, phase: "phase1_diverge" })
    order.push(...Object.keys(tracker.snapshot().participants))
    tracker.enqueue({ kind: "started", provider: "b/model-b", role: undefined, phase: "phase1_diverge" })
    order.push(...Object.keys(tracker.snapshot().participants))

    const finalParticipants = Object.keys(tracker.snapshot().participants)
    expect(finalParticipants).toContain("a/model-a")
    expect(finalParticipants).toContain("b/model-b")
    expect(finalParticipants).toContain("c/model-c")
    // a/model-a must be visible before b/model-b was enqueued (FIFO, no loss).
    expect(order[0]).toEqual("a/model-a")
  })

  test("no events lost across a burst of started/completed/failed for multiple providers", () => {
    const tracker = DebateLive.createTracker(() => {})
    tracker.enqueue({ kind: "started", provider: "a/model-a", role: undefined, phase: "phase1_diverge" })
    tracker.enqueue({ kind: "started", provider: "b/model-b", role: undefined, phase: "phase1_diverge" })
    tracker.enqueue({ kind: "completed", provider: "a/model-a", tokens: 5, durationMs: 1, phase: "phase1_diverge" })
    tracker.enqueue({ kind: "failed", provider: "b/model-b", error: "timeout", phase: "phase1_diverge" })

    const snapshot = tracker.snapshot()
    expect(snapshot.participants["a/model-a"].status).toBe("done")
    expect(snapshot.participants["b/model-b"].status).toBe("failed")
    expect(snapshot.participants["b/model-b"].error).toBe("timeout")
  })
})

describe("DebateLive.describeFailure", () => {
  test("includes phase and participant statuses instead of a bare failed flag", () => {
    const snapshot: DebateLive.Snapshot = {
      phase: "phase2_extract",
      participants: {
        "a/model-a": { currentPhase: "phase1_diverge", status: "done", tokens: 10, durationMs: 5 },
        "b/model-b": { currentPhase: "phase2_extract", status: "failed", error: "rate limited" },
      },
    }

    const message = DebateLive.describeFailure(snapshot, new Error("budget exceeded"))
    expect(message).toContain("phase2_extract")
    expect(message).toContain("a/model-a: done")
    expect(message).toContain("b/model-b: failed (rate limited)")
    expect(message).toContain("budget exceeded")
  })

  test("handles no participant activity recorded", () => {
    const snapshot: DebateLive.Snapshot = { phase: "pending", participants: {} }
    const message = DebateLive.describeFailure(snapshot, new Error("insufficient providers"))
    expect(message).toContain("no participant activity recorded")
    expect(message).toContain("insufficient providers")
  })

  test("stringifies non-Error causes", () => {
    const snapshot: DebateLive.Snapshot = { phase: "pending", participants: {} }
    const message = DebateLive.describeFailure(snapshot, "raw string failure")
    expect(message).toContain("raw string failure")
  })
})

describe("DebateLive.subscribe (debateID filtering)", () => {
  afterEach(() => Instance.disposeAll())

  test("only updates the tracker for the matching debateID", async () => {
    await using tmp = await tmpdir()
    const flushes: DebateLive.Snapshot[] = []

    await withInstance(tmp.path, async () => {
      const debateA = Collective.DebateID.make()
      const debateB = Collective.DebateID.make()
      let current: Collective.DebateID | undefined = debateA

      const tracker = DebateLive.createTracker((snapshot) => flushes.push(snapshot))
      const unsubscribe = DebateLive.subscribe(() => current, tracker)

      await Bus.publish(Events.ProviderStarted, {
        debateID: debateA,
        provider: "a/model-a",
        phase: "phase1_diverge",
      })
      await Bus.publish(Events.ProviderStarted, {
        debateID: debateB,
        provider: "b/model-b",
        phase: "phase1_diverge",
      })
      await Bun.sleep(20)

      const snapshot = tracker.snapshot()
      expect(Object.keys(snapshot.participants)).toEqual(["a/model-a"])

      unsubscribe()
    })
  })

  test("unsubscribe stops delivery for the previously matching debate", async () => {
    await using tmp = await tmpdir()

    await withInstance(tmp.path, async () => {
      const debateID = Collective.DebateID.make()
      const tracker = DebateLive.createTracker(() => {})
      const unsubscribe = DebateLive.subscribe(() => debateID, tracker)

      await Bus.publish(Events.ProviderStarted, { debateID, provider: "a/model-a", phase: "phase1_diverge" })
      await Bun.sleep(20)
      expect(Object.keys(tracker.snapshot().participants)).toEqual(["a/model-a"])

      unsubscribe()

      await Bus.publish(Events.ProviderCompleted, {
        debateID,
        provider: "a/model-a",
        tokens: 99,
        durationMs: 5,
        phase: "phase1_diverge",
      })
      await Bun.sleep(20)

      // Still "running" (no completed applied) proves the subscription was torn down.
      expect(tracker.snapshot().participants["a/model-a"].status).toBe("running")
    })
  })
})

describe("executeWithLiveTracking", () => {
  afterEach(() => Instance.disposeAll())

  test("success path: reports final metadata and unsubscribes (no further ctx.metadata after completion)", async () => {
    await using tmp = await tmpdir()

    await withInstance(tmp.path, async () => {
      const debateID = Collective.DebateID.make()
      const metadataCalls: Array<Record<string, unknown> | undefined> = []
      const ctx = { metadata: (input: { metadata?: Record<string, unknown> }) => metadataCalls.push(input.metadata) }

      const result = await executeWithLiveTracking(makeConfig(), ctx, async (_config, onDebateID) => {
        onDebateID(debateID)
        await Bus.publish(Events.ProviderStarted, { debateID, provider: "a/model-a", phase: "phase1_diverge" })
        await Bun.sleep(20)
        await Bus.publish(Events.ProviderCompleted, {
          debateID,
          provider: "a/model-a",
          tokens: 10,
          durationMs: 5,
          phase: "phase1_diverge",
        })
        await Bun.sleep(20)
        return makeReport(debateID)
      })

      expect((result.metadata as any).participants["a/model-a"].status).toBe("done")
      const callsAfterCompletion = metadataCalls.length

      // Publishing more events for the same debateID after completion must be a no-op:
      // proves the finally-block unsubscribed the Bus listeners.
      await Bus.publish(Events.ProviderStarted, { debateID, provider: "b/model-b", phase: "phase1_diverge" })
      await Bun.sleep(20)
      expect(metadataCalls.length).toBe(callsAfterCompletion)
    })
  })

  test("catch path: preserves live snapshot in the thrown error and still unsubscribes", async () => {
    await using tmp = await tmpdir()

    await withInstance(tmp.path, async () => {
      const debateID = Collective.DebateID.make()
      const ctx = { metadata: () => {} }

      let caught: Error | undefined
      try {
        await executeWithLiveTracking(makeConfig(), ctx, async (_config, onDebateID) => {
          onDebateID(debateID)
          await Bus.publish(Events.DebatePhaseChanged, { debateID, phase: "phase1_diverge" })
          await Bus.publish(Events.ProviderStarted, { debateID, provider: "a/model-a", phase: "phase1_diverge" })
          await Bus.publish(Events.ProviderFailed, {
            debateID,
            provider: "a/model-a",
            error: "provider timeout",
            phase: "phase1_diverge",
          })
          await Bun.sleep(20)
          throw new Error("Only 0 model(s) responded. Need at least 2.")
        })
      } catch (error) {
        caught = error as Error
      }

      expect(caught).toBeDefined()
      expect(caught!.message).toContain("phase1_diverge")
      expect(caught!.message).toContain("a/model-a: failed (provider timeout)")
      expect(caught!.message).toContain("Only 0 model(s) responded")
    })
  })

  test("unhandled exception path (non-Error throw) still unsubscribes via finally", async () => {
    await using tmp = await tmpdir()

    await withInstance(tmp.path, async () => {
      const debateID = Collective.DebateID.make()
      const metadataCalls: unknown[] = []
      const ctx = { metadata: (input: unknown) => metadataCalls.push(input) }

      let caught: unknown
      try {
        await executeWithLiveTracking(makeConfig(), ctx, async (_config, onDebateID) => {
          onDebateID(debateID)
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw "unexpected crash"
        })
      } catch (error) {
        caught = error
      }

      expect(caught).toBeInstanceOf(Error)
      expect((caught as Error).message).toContain("unexpected crash")

      const callsAfterCrash = metadataCalls.length
      await Bus.publish(Events.ProviderStarted, { debateID, provider: "a/model-a", phase: "phase1_diverge" })
      await Bun.sleep(20)
      // No live tracker survives past the catch/finally, so this must not throw
      // and must not trigger any further ctx.metadata call.
      expect(metadataCalls.length).toBe(callsAfterCrash)
    })
  })

  test("passes a working onDebateID callback through to run(), invoked exactly once", async () => {
    await using tmp = await tmpdir()

    await withInstance(tmp.path, async () => {
      const debateID = Collective.DebateID.make()
      const ctx = { metadata: () => {} }
      const callbackInvocations: Collective.DebateID[] = []

      await executeWithLiveTracking(makeConfig(), ctx, async (_config, onDebateID) => {
        onDebateID(debateID)
        callbackInvocations.push(debateID)
        return makeReport(debateID)
      })

      expect(callbackInvocations).toEqual([debateID])
    })
  })
})
