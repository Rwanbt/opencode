/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M3-10 — Cancellation contracts (Plan V2.3.1 §200, ADR-008, ADR-022).
 *
 * Cancellation is a **durable** signal: a request survives an
 * orchestrator crash. The state machine is
 * RUNNING → CANCELLING → CANCELLED | FAILED_TO_CANCEL. The
 * `compensate` handler cross-refs M3-07 `CompensationBinding` —
 * the contract documents the requirement but does not enforce it
 * (cross-file cross-ref; the runtime enforces it). M3-10 is
 * **contract only** (ADR-000 blocks runtime propagation).
 */
import { describe, expect, test } from "bun:test"
import { ZodError } from "zod"
import {
  CancellationTokenSchema,
  asCancellationToken,
  CancellationStateSchema,
  CancellationRequestSchema,
  parseCancellationRequest,
  CancellationHandlerSchema,
  parseCancellationHandler,
  NodeCancellationConfigSchema,
  parseNodeCancellationConfig,
  CANCELLATION_TOKEN_MAX_CHARS,
  CANCELLATION_NOTE_MAX_CHARS,
  CANCELLATION_CLEANUP_DEFAULT_MS,
  CANCELLATION_CLEANUP_MAX_MS,
  NODE_CANCELLATION_DESCRIPTION_MAX_CHARS,
} from "../src/cancellation.ts"

/* ---- CancellationToken (1-3) ---- */

describe("CancellationTokenSchema (1-3)", () => {
  test("(1) CancellationTokenSchema_AcceptsOpaqueString — 'opaque-1', 'abc', UUID all parse", () => {
    const a = CancellationTokenSchema.parse("opaque-1")
    const b = CancellationTokenSchema.parse("abc")
    const uuid = CancellationTokenSchema.parse(
      "0190b8c0-1234-7abc-9def-0123456789ab",
    )
    expect(typeof a).toBe("string")
    expect(typeof b).toBe("string")
    expect(typeof uuid).toBe("string")
    const branded = asCancellationToken("branded-1")
    expect(branded as unknown as string).toBe("branded-1")
  })

  test("(2) CancellationTokenSchema_RejectsEmptyString — '' is rejected", () => {
    expect(() => CancellationTokenSchema.parse("")).toThrow()
  })

  test("(3) CancellationTokenSchema_RejectsTooLongString — 257 chars rejected", () => {
    const tooLong = "a".repeat(CANCELLATION_TOKEN_MAX_CHARS + 1)
    expect(() => CancellationTokenSchema.parse(tooLong)).toThrow()
  })

  test("(1+) CancellationTokenSchema_AcceptsBoundaryLength — exactly 256 chars parses", () => {
    const boundary = "a".repeat(CANCELLATION_TOKEN_MAX_CHARS)
    expect(CancellationTokenSchema.parse(boundary) as unknown as string).toBe(
      boundary,
    )
  })
})

/* ---- CancellationState (4-5) ---- */

describe("CancellationStateSchema (4-5)", () => {
  test("(4) CancellationStateSchema_AcceptsAllFour — RUNNING, CANCELLING, CANCELLED, FAILED_TO_CANCEL parse", () => {
    expect(CancellationStateSchema.parse("RUNNING")).toBe("RUNNING")
    expect(CancellationStateSchema.parse("CANCELLING")).toBe("CANCELLING")
    expect(CancellationStateSchema.parse("CANCELLED")).toBe("CANCELLED")
    expect(CancellationStateSchema.parse("FAILED_TO_CANCEL")).toBe(
      "FAILED_TO_CANCEL",
    )
  })

  test("(5) CancellationStateSchema_RejectsUnknown — 'MAYBE' is not a state", () => {
    expect(() => CancellationStateSchema.parse("MAYBE")).toThrow()
    // Case-sensitive: lowercase rejected.
    expect(() => CancellationStateSchema.parse("running")).toThrow()
    // Empty string rejected.
    expect(() => CancellationStateSchema.parse("")).toThrow()
  })
})

/* ---- CancellationRequest (6-9) ---- */

describe("CancellationRequestSchema (6-9)", () => {
  test("(6) CancellationRequestSchema_ParsesValid — token + run + ts + reason all parse", () => {
    const parsed = CancellationRequestSchema.parse({
      token: "tok-1",
      workflowRunId: "run-1",
      requestedAt: 1_700_000_000_000,
      reason: "user",
    })
    expect(parsed.token as unknown as string).toBe("tok-1")
    expect(parsed.workflowRunId).toBe("run-1")
    expect(parsed.requestedAt).toBe(1_700_000_000_000)
    expect(parsed.reason).toBe("user")
    expect(parsed.note).toBeUndefined()
  })

  test("(7) CancellationRequestSchema_RejectsMissingToken — token is required", () => {
    expect(() =>
      CancellationRequestSchema.parse({
        workflowRunId: "run-1",
        requestedAt: 1,
        reason: "user",
      }),
    ).toThrow()
  })

  test("(8) CancellationRequestSchema_RejectsNegativeRequestedAt — requestedAt: -1 is rejected", () => {
    expect(() =>
      CancellationRequestSchema.parse({
        token: "tok-1",
        workflowRunId: "run-1",
        requestedAt: -1,
        reason: "user",
      }),
    ).toThrow()
  })

  test("(9) CancellationRequestSchema_AcceptsOptionalNote — note parses when ≤ 280 chars", () => {
    const parsed = CancellationRequestSchema.parse({
      token: "tok-1",
      workflowRunId: "run-1",
      requestedAt: 1_700_000_000_000,
      reason: "system",
      note: "deadline exceeded",
    })
    expect(parsed.note).toBe("deadline exceeded")
    // Boundary at 280 chars accepted, 281 rejected.
    const boundary = "a".repeat(CANCELLATION_NOTE_MAX_CHARS)
    expect(
      CancellationRequestSchema.parse({
        token: "tok-1",
        workflowRunId: "run-1",
        requestedAt: 1,
        reason: "timeout",
        note: boundary,
      }).note,
    ).toBe(boundary)
    expect(() =>
      CancellationRequestSchema.parse({
        token: "tok-1",
        workflowRunId: "run-1",
        requestedAt: 1,
        reason: "user",
        note: "a".repeat(CANCELLATION_NOTE_MAX_CHARS + 1),
      }),
    ).toThrow()
  })

  test("(9+) parseCancellationRequest_RoundTripsValid — parse → JSON → re-parse is equal", () => {
    const original = {
      token: "tok-rt",
      workflowRunId: "run-rt",
      requestedAt: 1_700_000_000_000,
      reason: "parent" as const,
      note: "parent workflow aborted",
    }
    const parsed = parseCancellationRequest(original)
    const reParsed = parseCancellationRequest(JSON.parse(JSON.stringify(parsed)))
    expect(reParsed).toEqual(parsed)
  })
})

/* ---- CancellationHandler (10-15) ---- */

describe("CancellationHandlerSchema (10-15)", () => {
  test("(10) CancellationHandlerSchema_ParsesIgnore — { kind: 'ignore' } parses", () => {
    const parsed = CancellationHandlerSchema.parse({ kind: "ignore" })
    expect(parsed.kind).toBe("ignore")
  })

  test("(11) CancellationHandlerSchema_ParsesCleanup — { kind: 'cleanup', maxCleanupMs: 5000 } parses; default 30000", () => {
    const explicit = CancellationHandlerSchema.parse({
      kind: "cleanup",
      maxCleanupMs: 5000,
    })
    expect(explicit.kind).toBe("cleanup")
    if (explicit.kind === "cleanup") {
      expect(explicit.maxCleanupMs).toBe(5000)
    }
    // Default kicks in when maxCleanupMs is omitted.
    const defaulted = CancellationHandlerSchema.parse({ kind: "cleanup" })
    if (defaulted.kind === "cleanup") {
      expect(defaulted.maxCleanupMs).toBe(CANCELLATION_CLEANUP_DEFAULT_MS)
    }
  })

  test("(12) CancellationHandlerSchema_ParsesFail — { kind: 'fail' } parses", () => {
    expect(CancellationHandlerSchema.parse({ kind: "fail" }).kind).toBe("fail")
  })

  test("(13) CancellationHandlerSchema_ParsesCompensate — { kind: 'compensate' } parses (M3-07 cross-ref)", () => {
    // Cross-ref documented: the compensate handler requires a
    // CompensationBinding (M3-07) at runtime; the contract does
    // not enforce the cross-file constraint. Pin the surface so
    // a regression is caught.
    expect(
      CancellationHandlerSchema.parse({ kind: "compensate" }).kind,
    ).toBe("compensate")
  })

  test("(13+) parseCancellationHandler_RoundTripsAllFour — all 4 kinds round-trip through JSON", () => {
    for (const original of [
      { kind: "ignore" as const },
      { kind: "cleanup" as const, maxCleanupMs: 1000 },
      { kind: "fail" as const },
      { kind: "compensate" as const },
    ]) {
      const parsed = parseCancellationHandler(original)
      const reParsed = parseCancellationHandler(
        JSON.parse(JSON.stringify(parsed)),
      )
      expect(reParsed).toEqual(parsed)
    }
  })

  test("(14) CancellationHandlerSchema_RejectsTooLargeMaxCleanupMs — 60001 rejected", () => {
    expect(() =>
      CancellationHandlerSchema.parse({
        kind: "cleanup",
        maxCleanupMs: CANCELLATION_CLEANUP_MAX_MS + 1,
      }),
    ).toThrow()
  })

  test("(15) CancellationHandlerSchema_RejectsNegativeMaxCleanupMs — -1 rejected", () => {
    expect(() =>
      CancellationHandlerSchema.parse({
        kind: "cleanup",
        maxCleanupMs: -1,
      }),
    ).toThrow()
  })

  test("(15+) CancellationHandlerSchema_RejectsUnknownKind — 'abort' / missing kind rejected", () => {
    expect(() => CancellationHandlerSchema.parse({ kind: "abort" })).toThrow()
    expect(() => CancellationHandlerSchema.parse({})).toThrow()
  })
})

/* ---- NodeCancellationConfig (16-18) ---- */

describe("NodeCancellationConfigSchema (16-18)", () => {
  test("(16) NodeCancellationConfig_ParsesValid — { handler: { kind: 'fail' } } parses", () => {
    const parsed = NodeCancellationConfigSchema.parse({
      handler: { kind: "fail" },
    })
    expect(parsed.handler.kind).toBe("fail")
    expect(parsed.description).toBeUndefined()
  })

  test("(17) NodeCancellationConfig_RoundTripsValid — all 4 handler kinds round-trip", () => {
    for (const handler of [
      { kind: "ignore" as const },
      { kind: "cleanup" as const, maxCleanupMs: 5000 },
      { kind: "fail" as const },
      { kind: "compensate" as const },
    ]) {
      const original = { handler, description: "test" }
      const parsed = NodeCancellationConfigSchema.parse(original)
      const reParsed = NodeCancellationConfigSchema.parse(
        JSON.parse(JSON.stringify(parsed)),
      )
      expect(reParsed).toEqual(parsed)
    }
  })

  test("(17+) NodeCancellationConfig_AcceptsBoundaryDescription — exactly 280 chars parses", () => {
    const description = "a".repeat(NODE_CANCELLATION_DESCRIPTION_MAX_CHARS)
    expect(
      NodeCancellationConfigSchema.parse({
        handler: { kind: "fail" },
        description,
      }).description,
    ).toBe(description)
  })

  test("(18) NodeCancellationConfig_ThrowsOnInvalidHandler — wrong shape throws ZodError", () => {
    // Missing `kind`.
    expect(() => NodeCancellationConfigSchema.parse({ handler: {} })).toThrow(
      ZodError,
    )
    // Unknown `kind`.
    expect(() =>
      NodeCancellationConfigSchema.parse({ handler: { kind: "abort" } }),
    ).toThrow(ZodError)
    // Cleanup with out-of-range maxCleanupMs.
    expect(() =>
      NodeCancellationConfigSchema.parse({
        handler: { kind: "cleanup", maxCleanupMs: -1 },
      }),
    ).toThrow(ZodError)
    // Description > 280 chars rejected.
    expect(() =>
      NodeCancellationConfigSchema.parse({
        handler: { kind: "fail" },
        description: "a".repeat(NODE_CANCELLATION_DESCRIPTION_MAX_CHARS + 1),
      }),
    ).toThrow()
  })

  test("(18+) parseNodeCancellationConfig_ThrowsOnInvalidHandler — helper throws on bad input", () => {
    expect(() => parseNodeCancellationConfig({ handler: {} })).toThrow(ZodError)
  })
})
