/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * C-M1-09 — WorkflowRun / DurableHistoryAuthority contracts (structural tests).
 *
 * Plan V2.3.1 §195 (M1 gate) + §41 (DurableHistoryAuthority interface) +
 * §43 (WorkflowRun runtime type). M1 plan §3.9 (C-M1-09).
 * ADR-004 (append-only history) DECIDED + ADR-022 (transition matrix)
 * DECIDED + ADR-020 (Ownership / Deployment scope) DECIDED.
 *
 * This file is the durable regression net for the four new Zod
 * schemas shipped in C-M1-09:
 *
 *   - `WorkflowRunStatusSchema`        (7-value enum, plan §43)
 *   - `DurableAuthorityKindSchema`     (3-value enum, ADR-000)
 *   - `WorkflowRunSchema`              (the 11-field runtime identity)
 *   - `MaterializedRunProjectionSchema` (all-optional read-only view)
 *   - `AtomicTransitionBoundarySchema`  (status + effect-slot, atomic)
 *
 * The 12+ test cases (a-l) are the contract's structural promises;
 * any regression on the regex / enum / optionality rules is caught
 * here before it can leak into a substrate implementation. The
 * throwaway spike `docs/automation-v2/spikes/m1-09-workflow-run-types.ts`
 * is the 5/5 acceptance evidence that pairs with this file.
 */
import { describe, expect, test } from "bun:test"
import {
  AtomicTransitionBoundarySchema,
  DurableAuthorityKindSchema,
  MaterializedRunProjectionSchema,
  WorkflowRunSchema,
  WorkflowRunStatusSchema,
} from "../src/workflow-run.ts"

const VALID_SCOPE = { ownershipScope: { organizationId: "org-1", workspaceId: "ws-1" }, environmentId: "prod" }

const VALID_RUN = {
  runId: "run-001",
  deploymentId: "deploy-001",
  workflowVersionId: "version-001",
  deploymentScope: VALID_SCOPE,
  triggerId: "trigger-001",
  triggerEventId: "event-001",
  durableAuthorityId: "auth-001",
  durableAuthorityKind: "native" as const,
  status: "running" as const,
  createdAt: 1700000000000,
  updatedAt: 1700000000001,
}

describe("WorkflowRunSchema — happy path (a)", () => {
  test("(a) accepts a fully-formed run with native / dbos / temporal kinds", () => {
    for (const kind of ["native", "dbos", "temporal"] as const) {
      const parsed = WorkflowRunSchema.parse({ ...VALID_RUN, durableAuthorityKind: kind })
      expect(parsed.durableAuthorityKind).toBe(kind)
      expect(parsed.runId).toBe("run-001")
      expect(parsed.status).toBe("running")
    }
  })
})

describe("WorkflowRunSchema — substrate boundary rejects restate (b)", () => {
  test("(b) rejects durableAuthorityKind: 'restate' (ADR-000 REQ-6 violation)", () => {
    expect(() =>
      WorkflowRunSchema.parse({ ...VALID_RUN, durableAuthorityKind: "restate" }),
    ).toThrow()
  })
})

describe("WorkflowRunStatusSchema — every documented state parses (c)", () => {
  test("(c) accepts status: 'completed'", () => {
    const parsed = WorkflowRunSchema.parse({ ...VALID_RUN, status: "completed" })
    expect(parsed.status).toBe("completed")
  })
})

describe("WorkflowRunStatusSchema — rejects unknown status (d)", () => {
  test("(d) rejects status: 'invalid' (enum strict)", () => {
    expect(() => WorkflowRunSchema.parse({ ...VALID_RUN, status: "invalid" })).toThrow()
  })
})

describe("MaterializedRunProjectionSchema — read-only, all fields optional (e)", () => {
  test("(e) accepts an empty projection (every field omitted)", () => {
    const parsed = MaterializedRunProjectionSchema.parse({})
    expect(parsed.runId).toBeUndefined()
    expect(parsed.status).toBeUndefined()
    expect(parsed.activeNodeId).toBeUndefined()
    expect(parsed.pendingEffects).toBeUndefined()
    expect(parsed.pendingTimers).toBeUndefined()
    expect(parsed.lastTransitionAt).toBeUndefined()
    expect(parsed.lastError).toBeUndefined()
  })
})

describe("MaterializedRunProjectionSchema — partial projection is valid (f)", () => {
  test("(f) accepts a projection with only runId set (partial replay state)", () => {
    const parsed = MaterializedRunProjectionSchema.parse({ runId: "run-001" })
    expect(parsed.runId).toBe("run-001")
    expect(parsed.status).toBeUndefined()
    expect(parsed.pendingTimers).toBeUndefined()
  })
})

describe("AtomicTransitionBoundarySchema — status + effect slot, atomic (g/h)", () => {
  test("(g) accepts a forward running -> completed transition with a real slot", () => {
    const parsed = AtomicTransitionBoundarySchema.parse({
      from: "running",
      to: "completed",
      effectSlotId: "slot-1",
      occurredAt: 1700000000000,
      isCompensating: false,
    })
    expect(parsed.from).toBe("running")
    expect(parsed.to).toBe("completed")
    expect(parsed.effectSlotId).toBe("slot-1")
    expect(parsed.isCompensating).toBe(false)
  })

  test("(h) accepts a completed -> running boundary (substrate-level replay rebind)", () => {
    // The schema is intentionally permissive on the *shape* of a
    // transition; the legality matrix is owned by ADR-022 §4 in
    // `@unifia/workflow-runtime` and is not duplicated here. What the
    // schema MUST guarantee is that the structural fields (from, to,
    // slot, occurredAt, isCompensating) are present together.
    const parsed = AtomicTransitionBoundarySchema.parse({
      from: "completed",
      to: "running",
      effectSlotId: "slot-replay",
      occurredAt: 1700000000050,
      isCompensating: false,
    })
    expect(parsed.from).toBe("completed")
    expect(parsed.to).toBe("running")
    expect(parsed.isCompensating).toBe(false)
  })
})

describe("WorkflowRunSchema — string fields are non-empty (i)", () => {
  test("(i) rejects empty runId (min(1))", () => {
    expect(() => WorkflowRunSchema.parse({ ...VALID_RUN, runId: "" })).toThrow(/runId/)
  })
})

describe("WorkflowRunSchema — string fields reject whitespace-only (j)", () => {
  test("(j) rejects whitespace-only durableAuthorityId (M1-04 regex pattern)", () => {
    expect(() => WorkflowRunSchema.parse({ ...VALID_RUN, durableAuthorityId: "  " })).toThrow(
      /durableAuthorityId/,
    )
  })
})

describe("DurableAuthorityKindSchema — substrate enum (k)", () => {
  test("(k) accepts 'native' and rejects empty string", () => {
    expect(DurableAuthorityKindSchema.parse("native")).toBe("native")
    expect(() => DurableAuthorityKindSchema.parse("")).toThrow()
  })
})

describe("WorkflowRunStatusSchema — exactly 7 documented values (l)", () => {
  test("(l) the schema exposes 7 options matching plan §43", () => {
    expect(WorkflowRunStatusSchema.options.length).toBe(7)
    expect(new Set(WorkflowRunStatusSchema.options)).toEqual(
      new Set([
        "running",
        "waiting",
        "completed",
        "failed",
        "cancelled",
        "cancelled_with_active_effect",
        "cancelled_with_unknown_external_state",
      ]),
    )
  })
})

describe("AtomicTransitionBoundarySchema — isCompensating defaults to false (bonus)", () => {
  test("isCompensating: undefined is coerced to false (default)", () => {
    const parsed = AtomicTransitionBoundarySchema.parse({
      from: "running",
      to: "completed",
      effectSlotId: "slot-1",
      occurredAt: 1,
    })
    expect(parsed.isCompensating).toBe(false)
  })
})

describe("MaterializedRunProjectionSchema — pendingTimers fireAt is non-negative (bonus)", () => {
  test("pendingTimers rejects negative fireAt", () => {
    expect(() =>
      MaterializedRunProjectionSchema.parse({
        pendingTimers: [{ timerId: "t-1", fireAt: -1 }],
      }),
    ).toThrow()
  })
})
