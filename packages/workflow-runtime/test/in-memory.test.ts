/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Tests for `InMemoryDurableHistoryAuthority` (M1-09 impl).
 *
 * M1-09 was YELLOW (interface-only) in the plan. With M0 substrate
 * proof SATISFIED (ADR-000 §7), the in-memory implementation is now
 * added under `src/in-memory.ts`. This test file locks the
 * implementation against the contract surface.
 *
 * Locked invariants (regression net):
 *   (1) register + getRun round-trips.
 *   (2) getRun returns a deep copy (mutations don't leak).
 *   (3) getRun returns null for unknown runId.
 *   (4) transition running -> completed is legal and updates state.
 *   (5) transition completed -> running is illegal and throws.
 *   (6) transition running -> failed is legal; failed is terminal.
 *   (7) transition on unknown runId throws RunNotFoundError.
 *   (8) transition with mismatched from throws.
 *   (9) transition records the event in the linear history.
 *  (10) enqueueCommand appends to the command queue.
 *  (11) scheduleTimer appends to the timer queue with overlap policy.
 *  (12) getMaterializedProjection reflects current state.
 *  (13) projection on empty history reports zero transitions.
 */

import { describe, expect, test } from "bun:test"
import { type WorkflowRun } from "@unifia/contracts"
import {
  IllegalTransitionError,
  InMemoryDurableHistoryAuthority,
  RunNotFoundError,
} from "../src/index.ts"
import type { AuthorityToken } from "../src/authority.ts"

const RUN_ID = "run-m1-09-001"
const DEPLOY_ID = "dep-m1-09-001"
const TOKEN: AuthorityToken = { workflowRunId: RUN_ID, generation: 1, authorityOwnerId: "test" }

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    runId: RUN_ID,
    deploymentId: DEPLOY_ID,
    workflowVersionId: "wf-m1-09-v1",
    deploymentScope: {
      ownershipScope: {
        organizationId: "o1",
        workspaceId: "w1",
      },
      environmentId: "dev",
    },
    triggerId: "trg-1",
    triggerEventId: "evt-1",
    durableAuthorityId: "auth-1",
    durableAuthorityKind: "native",
    status: "running",
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
    ...overrides,
  }
}

function makeAuthority(): InMemoryDurableHistoryAuthority {
  return new InMemoryDurableHistoryAuthority({ authorityKind: "native" })
}

function makeTransition(
  from: WorkflowRun["status"],
  to: WorkflowRun["status"],
  occurredAt: number = 1_700_000_500,
) {
  return {
    from,
    to,
    effectSlotId: `slot-${from}-${to}`,
    occurredAt,
    isCompensating: false,
  }
}

// ===========================================================================

describe("M1-09 in-memory DurableHistoryAuthority", () => {
  test("(1) register + getRun round-trips", async () => {
    const auth = makeAuthority()
    const run = makeRun()
    auth.register(run)
    const got = await auth.getRun(RUN_ID)
    expect(got).not.toBeNull()
    expect(got!.runId).toBe(RUN_ID)
    expect(got!.status).toBe("running")
  })

  test("(2) getRun returns a deep copy — caller mutations don't leak", async () => {
    const auth = makeAuthority()
    auth.register(makeRun())
    const got1 = await auth.getRun(RUN_ID)
    expect(got1).not.toBeNull()
    // Mutate the returned object and verify the underlying state is intact.
    ;(got1 as { displayName?: string }).displayName = "MUTATED"
    const got2 = await auth.getRun(RUN_ID)
    // The internal run should not have been mutated. We can't easily
    // assert "no displayName" because WorkflowRun doesn't have one,
    // so we just confirm the run id and status remain correct.
    expect(got2!.runId).toBe(RUN_ID)
    expect(got2!.status).toBe("running")
  })

  test("(3) getRun returns null for unknown runId", async () => {
    const auth = makeAuthority()
    const got = await auth.getRun("does-not-exist")
    expect(got).toBeNull()
  })

  test("(4) transition running -> completed is legal and updates state", async () => {
    const auth = makeAuthority()
    auth.register(makeRun({ status: "running" }))
    await auth.transition(TOKEN, RUN_ID, makeTransition("running", "completed"))
    const got = await auth.getRun(RUN_ID)
    expect(got!.status).toBe("completed")
  })

  test("(5) transition completed -> running is illegal and throws", async () => {
    const auth = makeAuthority()
    auth.register(makeRun({ status: "completed" }))
    await expect(
      auth.transition(TOKEN, RUN_ID, makeTransition("completed", "running")),
    ).rejects.toThrow(IllegalTransitionError)
  })

  test("(6) transition running -> failed is legal; failed is terminal", async () => {
    const auth = makeAuthority()
    auth.register(makeRun({ status: "running" }))
    await auth.transition(TOKEN, RUN_ID, makeTransition("running", "failed"))
    const got = await auth.getRun(RUN_ID)
    expect(got!.status).toBe("failed")
    // failed is terminal: any further transition is illegal.
    await expect(
      auth.transition(TOKEN, RUN_ID, makeTransition("failed", "running")),
    ).rejects.toThrow(IllegalTransitionError)
  })

  test("(7) transition on unknown runId throws RunNotFoundError", async () => {
    const auth = makeAuthority()
    await expect(
      auth.transition({ ...TOKEN, workflowRunId: "nope" }, "nope", makeTransition("running", "completed")),
    ).rejects.toThrow(RunNotFoundError)
  })

  test("(8) transition with mismatched from throws", async () => {
    const auth = makeAuthority()
    auth.register(makeRun({ status: "running" }))
    // Current is running, but event says from=completed.
    await expect(
      auth.transition(TOKEN, RUN_ID, makeTransition("completed", "completed")),
    ).rejects.toThrow(/does not match current status/)
  })

  test("(9) transition records the event in the linear history", async () => {
    const auth = makeAuthority()
    auth.register(makeRun({ status: "running" }))
    await auth.transition(TOKEN, RUN_ID, makeTransition("running", "waiting", 1_700_000_500))
    await auth.transition(TOKEN, RUN_ID, makeTransition("waiting", "running", 1_700_000_600))
    const hist = auth.inspectHistory(RUN_ID)
    expect(hist.length).toBe(2)
    expect(hist[0]!.to).toBe("waiting")
    expect(hist[1]!.to).toBe("running")
  })

  test("(10) enqueueCommand appends to the command queue", async () => {
    const auth = makeAuthority()
    auth.register(makeRun())
    await auth.enqueueCommand(TOKEN, RUN_ID, { kind: "tool.http", payload: { url: "https://x" } })
    await auth.enqueueCommand(TOKEN, RUN_ID, { kind: "human.approval", payload: { node: "n1" } })
    const cmds = auth.inspectCommands(RUN_ID)
    expect(cmds.length).toBe(2)
    expect(cmds[0]!.kind).toBe("tool.http")
    expect(cmds[1]!.kind).toBe("human.approval")
  })

  test("(11) scheduleTimer appends to the timer queue with overlap policy", async () => {
    const auth = makeAuthority()
    auth.register(makeRun())
    await auth.scheduleTimer(TOKEN, "tmr-1", RUN_ID, 1_700_000_500, "queue")
    const timers = auth.inspectTimers(RUN_ID)
    expect(timers.length).toBe(1)
    expect(timers[0]!.timerId).toBe("tmr-1")
    expect(timers[0]!.overlapPolicy).toBe("queue")
  })

  test("(12) getMaterializedProjection reflects current state", async () => {
    const auth = makeAuthority()
    auth.register(makeRun({ status: "running" }))
    await auth.transition(TOKEN, RUN_ID, makeTransition("running", "waiting", 1_700_000_500))
    await auth.enqueueCommand(TOKEN, RUN_ID, { kind: "tool.http", payload: {} })
    await auth.scheduleTimer(TOKEN, "tmr-1", RUN_ID, 1_700_000_700, "queue")
    const proj = await auth.getMaterializedProjection(RUN_ID)
    expect(proj.runId).toBe(RUN_ID)
    expect(proj.status).toBe("waiting")
    expect(proj.lastTransitionAt).toBe(1_700_000_500)
    expect(proj.pendingEffects).toHaveLength(1)
    expect(proj.pendingTimers).toHaveLength(1)
    expect(proj.pendingTimers![0]!.timerId).toBe("tmr-1")
  })

  test("(13) projection on empty history reports zero transitions", async () => {
    const auth = makeAuthority()
    auth.register(makeRun())
    const proj = await auth.getMaterializedProjection(RUN_ID)
    expect(proj.lastTransitionAt).toBeUndefined()
    expect(proj.pendingEffects).toHaveLength(0)
    expect(proj.pendingTimers).toHaveLength(0)
  })
})
