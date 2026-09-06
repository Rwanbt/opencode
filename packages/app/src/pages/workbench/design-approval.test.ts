/* SPDX-License-Identifier: MIT */
/**
 * P1-B — an expired approval has a way out, and the broker hears about it.
 *
 * The shipped surface rendered a full-screen modal on expiry with every
 * control behind `!expired`, so the user was left looking at a warning and
 * nothing to click. `runCancelApproval` refused while expired, and
 * `onCleanup` only cancelled `requesting | resolving | retrying` — so the
 * approval the broker was holding stayed pending until its TTL ran out,
 * invisible, and the next export raced it. The reducer sealed it: the
 * `request-start` arm did not accept `approval-required`, so the
 * "re-request" that `canStartApproval` advertised could never fire.
 *
 * The old suite could not see any of this. It read `design-surface.tsx` as
 * text and matched regexes against it, because that module imports Solid's
 * client-only runtime and `bun:test` cannot load it. A regex confirms a
 * string is present; it cannot tell you the button is unreachable or the
 * request was never withdrawn.
 *
 * So the machine and its four broker operations now live in
 * `design-approval.ts` with the client injected, and these tests drive
 * them for real against a fake broker that records every call.
 */

import { describe, expect, test } from "bun:test"
import {
  canStartApproval,
  createApprovalOperations,
  isApprovalModalVisible,
  reduceApprovalState,
  type ApprovalClient,
  type ApprovalEvent,
  type ApprovalOutcome,
  type ApprovalState,
} from "./design-approval"

const PENDING: ApprovalState = {
  kind: "approval-required",
  approvalId: "apr_1",
  capability: "artifact.export",
  resource: "art_1",
  expiresAt: 1_000,
  expired: false,
}
const EXPIRED: ApprovalState = { ...PENDING, expired: true }

function drive(from: ApprovalState, events: ApprovalEvent[]): ApprovalState {
  return events.reduce(reduceApprovalState, from)
}

/** A broker that records what it was asked to do. */
function fakeBroker(
  overrides: Partial<ApprovalClient> = {},
): ApprovalClient & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async resolveApproval(id, decision) {
      calls.push(`resolve:${id}:${decision}`)
      return overrides.resolveApproval
        ? overrides.resolveApproval(id, decision)
        : { decision: { kind: decision } }
    },
    async cancelApproval(id) {
      calls.push(`cancel:${id}`)
      return overrides.cancelApproval ? overrides.cancelApproval(id) : undefined
    },
  }
}

/** A harness holding the machine the way the surface's signal does. */
function harness(initial: ApprovalState, client: ApprovalClient | undefined) {
  let state = initial
  const outcomes: ApprovalOutcome[] = []
  let restarts = 0
  let timersCleared = 0
  const ops = createApprovalOperations({
    client: () => client,
    state: () => state,
    dispatch: (event) => {
      state = reduceApprovalState(state, event)
    },
    clearTimer: () => {
      timersCleared += 1
    },
    restart: async () => {
      restarts += 1
    },
    report: (outcome) => outcomes.push(outcome),
  })
  return {
    ops,
    outcomes,
    get state() {
      return state
    },
    get restarts() {
      return restarts
    },
    get timersCleared() {
      return timersCleared
    },
  }
}

describe("the reducer's expiry escape", () => {
  test("an expired approval can start a fresh request", () => {
    // The bug: `canStartApproval(EXPIRED)` was true while the reducer's
    // `request-start` arm returned the state unchanged.
    expect(canStartApproval(EXPIRED)).toBe(true)
    expect(drive(EXPIRED, [{ type: "request-start" }])).toEqual({ kind: "requesting" })
  })

  test("a live approval still refuses a restart, so a double click is a no-op", () => {
    expect(canStartApproval(PENDING)).toBe(false)
    expect(drive(PENDING, [{ type: "request-start" }])).toEqual(PENDING)
  })

  test("cancel is reachable from an expired approval; allow and deny are not", () => {
    expect(drive(EXPIRED, [{ type: "cancel-start" }])).toEqual({ kind: "resolving" })
    expect(drive(EXPIRED, [{ type: "resolve-start" }])).toEqual(EXPIRED)
    expect(drive(PENDING, [{ type: "resolve-start" }])).toEqual({ kind: "resolving" })
  })

  test("the modal stays up while expired — that is the whole point of the flag", () => {
    expect(isApprovalModalVisible(EXPIRED)).toBe(true)
  })

  test("expiry is idempotent and terminal states ignore it", () => {
    expect(drive(EXPIRED, [{ type: "expire" }])).toEqual(EXPIRED)
    expect(drive({ kind: "succeeded" }, [{ type: "expire" }])).toEqual({ kind: "succeeded" })
  })
})

describe("expiration → re-request", () => {
  test("releases the stale approval on the broker, then re-issues", async () => {
    const broker = fakeBroker()
    const h = harness(EXPIRED, broker)

    await h.ops.rerequest()

    // The stale request is withdrawn before a new one goes out — without
    // this the broker holds an approval nobody will decide and the fresh
    // attempt races it.
    expect(broker.calls).toEqual(["cancel:apr_1"])
    expect(h.restarts).toBe(1)
    expect(h.timersCleared).toBe(1)
  })

  test("re-issues even when the broker refuses to cancel an already-expired id", async () => {
    const broker = fakeBroker({
      cancelApproval: async () => {
        throw new Error("approval already expired")
      },
    })
    const h = harness(EXPIRED, broker)

    await h.ops.rerequest()

    expect(broker.calls).toEqual(["cancel:apr_1"])
    // There was nothing left to release; the fresh request is what matters.
    expect(h.restarts).toBe(1)
  })

  test("does nothing on an approval that has not expired", async () => {
    const broker = fakeBroker()
    const h = harness(PENDING, broker)

    await h.ops.rerequest()

    expect(broker.calls).toEqual([])
    expect(h.restarts).toBe(0)
  })

  test("does nothing while disconnected", async () => {
    const h = harness(EXPIRED, undefined)
    await h.ops.rerequest()
    expect(h.restarts).toBe(0)
    expect(h.state).toEqual(EXPIRED)
  })
})

describe("expiration → cancellation", () => {
  test("withdraws the pending request and settles the machine", async () => {
    const broker = fakeBroker()
    const h = harness(EXPIRED, broker)

    await h.ops.cancel()

    expect(broker.calls).toEqual(["cancel:apr_1"])
    expect(h.state).toEqual({ kind: "cancelled" })
    expect(h.outcomes).toEqual([{ exportState: "idle", message: "Export annulé" }])
  })

  test("still settles when the broker refuses, instead of trapping the user in `resolving`", async () => {
    const broker = fakeBroker({
      cancelApproval: async () => {
        throw new Error("approval already expired")
      },
    })
    const h = harness(EXPIRED, broker)

    await h.ops.cancel()

    expect(h.state).toEqual({ kind: "cancelled" })
    // The user is told why, but is not left behind a modal with no controls.
    expect(h.outcomes[0]?.exportState).toBe("idle")
    expect(h.outcomes[0]?.message).toContain("already expired")
  })

  test("cancels a live approval too", async () => {
    const broker = fakeBroker()
    const h = harness(PENDING, broker)

    await h.ops.cancel()

    expect(broker.calls).toEqual(["cancel:apr_1"])
    expect(h.state).toEqual({ kind: "cancelled" })
  })
})

describe("allow / deny", () => {
  test("an allowed approval retries the operation", async () => {
    const broker = fakeBroker()
    const h = harness(PENDING, broker)

    await h.ops.resolve("allow")

    expect(broker.calls).toEqual(["resolve:apr_1:allow"])
    expect(h.restarts).toBe(1)
  })

  test("a denied approval cancels and reports, without retrying", async () => {
    const broker = fakeBroker({
      resolveApproval: async () => ({ decision: { kind: "deny" } }),
    })
    const h = harness(PENDING, broker)

    await h.ops.resolve("deny")

    expect(h.restarts).toBe(0)
    expect(h.state).toEqual({ kind: "cancelled" })
    expect(h.outcomes[0]?.message).toContain("annulé")
  })

  test("a broker error surfaces as a failure rather than a stuck `resolving`", async () => {
    const broker = fakeBroker({
      resolveApproval: async () => {
        throw new Error("broker unreachable")
      },
    })
    const h = harness(PENDING, broker)

    await h.ops.resolve("allow")

    expect(h.state).toEqual({ kind: "failed", error: "broker unreachable" })
    expect(h.outcomes[0]).toEqual({ exportState: "error", message: "broker unreachable" })
  })
})

describe("navigating away", () => {
  test("withdraws an approval the broker is still holding", async () => {
    const broker = fakeBroker()
    const h = harness(PENDING, broker)

    h.ops.detach()
    await Promise.resolve()

    // The old cleanup skipped `approval-required` entirely, which is how
    // the request came to sit there until its TTL ran out.
    expect(broker.calls).toEqual(["cancel:apr_1"])
    expect(h.state).toEqual({ kind: "cancelled" })
  })

  test("withdraws an expired approval too", async () => {
    const broker = fakeBroker()
    const h = harness(EXPIRED, broker)

    h.ops.detach()
    await Promise.resolve()

    expect(broker.calls).toEqual(["cancel:apr_1"])
  })

  test("cancels an in-flight request without calling the broker", async () => {
    const broker = fakeBroker()
    const h = harness({ kind: "requesting" }, broker)

    h.ops.detach()

    // Nothing was gated yet, so there is no approval id to withdraw.
    expect(broker.calls).toEqual([])
    expect(h.state).toEqual({ kind: "cancelled" })
  })

  test("leaves a settled machine alone", () => {
    const broker = fakeBroker()
    const h = harness({ kind: "succeeded" }, broker)

    h.ops.detach()

    expect(broker.calls).toEqual([])
    expect(h.state).toEqual({ kind: "succeeded" })
  })
})
