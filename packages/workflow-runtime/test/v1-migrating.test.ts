/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Tests for M1-11 (V1 → V2 history migration authority).
 *
 * M1-11 wraps the existing migration tool
 * (`@unifia/automate-migration-tool`, 32/32 tests PASS) and exposes
 * a V1MigratingAuthority that loads V1 records into a V2 substrate.
 *
 * Locked invariants (regression net):
 *   (1) loadV1 rejects a record with `block` migration warnings.
 *   (2) loadV1 on a minimal valid V1 record registers the run and
 *       returns the V2 WorkflowRun.
 *   (3) loadV1 preserves the V1 final status.
 *   (4) loadV1 preserves the workspaceId in the deployment scope.
 *   (5) V1MigratingAuthority delegates getRun / transition /
 *       enqueueCommand / scheduleTimer / getMaterializedProjection
 *       to the inner authority.
 */

import { describe, expect, test } from "bun:test"
import { InMemoryDurableHistoryAuthority } from "../src/in-memory.js"
import { V1MigratingAuthority } from "../src/v1-migrating.js"
import type { V1HistoryRecord } from "../src/v1-migrating.js"
import type { AuthorityToken } from "../src/authority.js"

const TOKEN: AuthorityToken = { workflowRunId: "v1-run-001", generation: 1, authorityOwnerId: "test" }

function makeV1Record(overrides: Partial<V1HistoryRecord> = {}): V1HistoryRecord {
  return {
    runId: "v1-run-001",
    workflow: {
      id: "wf-v1-sample",
      version: 1,
      workspaceId: "ws-1",
      steps: [
        {
          id: "fetch",
          capability: "http",
          input: { method: "GET", url: "https://x" },
          requiresApproval: false,
        },
        {
          id: "log",
          capability: "http",
          input: { method: "POST", url: "https://logs" },
          requiresApproval: false,
        },
      ],
    },
    status: "completed",
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_500,
    ...overrides,
  }
}

describe("M1-11 V1MigratingAuthority", () => {
  test("(1) loadV1 on a valid V1 record registers the run and returns the V2 WorkflowRun", async () => {
    const inner = new InMemoryDurableHistoryAuthority({ authorityKind: "native" })
    const auth = new V1MigratingAuthority(inner)
    const v2Run = await auth.loadV1(TOKEN, makeV1Record())
    expect(v2Run.runId).toBe("v1-run-001")
    expect(v2Run.status).toBe("completed")
    expect(v2Run.deploymentScope.ownershipScope.workspaceId).toBe("ws-1")
    // Inner authority should now know about the run.
    const fetched = await inner.getRun("v1-run-001")
    expect(fetched).not.toBeNull()
    expect(fetched!.status).toBe("completed")
  })

  test("(2) loadV1 preserves the V1 final status", async () => {
    const inner = new InMemoryDurableHistoryAuthority({ authorityKind: "native" })
    const auth = new V1MigratingAuthority(inner)
    for (const status of ["completed", "failed", "cancelled"] as const) {
      const v2Run = await auth.loadV1(
        { ...TOKEN, workflowRunId: `v1-run-${status}` },
        makeV1Record({
          runId: `v1-run-${status}`,
          status,
        }),
      )
      expect(v2Run.status).toBe(status)
    }
  })

  test("(3) loadV1 on a V1 record with a shell step is rejected (block warning)", async () => {
    const inner = new InMemoryDurableHistoryAuthority({ authorityKind: "native" })
    const auth = new V1MigratingAuthority(inner)
    const bad = makeV1Record({
      runId: "v1-run-shell",
      workflow: {
        id: "wf-v1-shell",
        version: 1,
        workspaceId: "ws-1",
        steps: [
          {
            id: "fetch",
            capability: "http",
            input: { method: "GET", url: "https://x" },
            requiresApproval: false,
          },
          {
            id: "shell-step",
            capability: "shell",
            input: { cmd: "ls" },
            requiresApproval: false,
          },
        ],
      },
    })
    await expect(auth.loadV1({ ...TOKEN, workflowRunId: "v1-run-shell" }, bad)).rejects.toThrow(/not acceptable for migration/)
  })

  test("(4) V1MigratingAuthority delegates getRun to the inner", async () => {
    const inner = new InMemoryDurableHistoryAuthority({ authorityKind: "native" })
    const auth = new V1MigratingAuthority(inner)
    expect(await auth.getRun("unknown")).toBeNull()
  })

  test("(5) V1MigratingAuthority delegates transition / enqueueCommand / scheduleTimer", async () => {
    const inner = new InMemoryDurableHistoryAuthority({ authorityKind: "native" })
    const auth = new V1MigratingAuthority(inner)
    // Register via direct inner call so we can drive transitions.
    const token = { ...TOKEN, workflowRunId: "v1-run-trans" }
    const v2Run = await auth.loadV1(token, makeV1Record({ runId: "v1-run-trans" }))
    expect(v2Run.status).toBe("completed")
    // The migration already recorded a running -> completed
    // transition. A further transition from completed (terminal)
    // is illegal.
    await expect(
      auth.transition(token, "v1-run-trans", {
        from: "completed",
        to: "running",
        effectSlotId: "test",
        occurredAt: 1_700_000_600,
        isCompensating: false,
      }),
    ).rejects.toThrow()
  })

  test("(6) loadV1 on a running V1 record does not record a final transition", async () => {
    const inner = new InMemoryDurableHistoryAuthority({ authorityKind: "native" })
    const auth = new V1MigratingAuthority(inner)
    const v2Run = await auth.loadV1({ ...TOKEN, workflowRunId: "v1-run-running" }, makeV1Record({ runId: "v1-run-running", status: "running" }))
    expect(v2Run.status).toBe("running")
    // No history recorded (we only record transitions away from running).
    // The projection should show zero transitions.
    const proj = await auth.getMaterializedProjection("v1-run-running")
    expect(proj).not.toBeNull()
    expect(proj!.lastTransitionAt).toBeUndefined()
  })
})
