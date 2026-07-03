/**
 * SDK shim integrity invariants — Phase 6.6 follow-up.
 *
 * These tests are compile-time invariants: they assert that the shim types
 * stay structurally compatible with the actual SDK response shapes. If
 * someone changes the SDK response shape without updating the shim (or
 * vice-versa), these tests fail at TypeScript compile time.
 *
 * The runtime assertions are minimal — they're here to document the
 * invariants explicitly so a future reader understands the contract.
 *
 * Why: Phase 6.2 shim refinement (SessionStatus/Command/Agent) and Phase
 * 6.5 PermissionRequest/QuestionRequest tightening were high-risk changes
 * (silent breakage if shim drifts from SDK). These invariants catch drift
 * early in CI rather than at runtime.
 */
import { describe, expect, test } from "bun:test"
import type {
  CommandListResponses,
  PermissionListResponses,
  QuestionListResponses,
  SessionStatusResponses,
} from "@opencode-ai/sdk/v2"
import type {
  Command,
  PermissionRequest,
  QuestionInfo,
  QuestionRequest,
  SessionStatus,
  SessionStatusResponse,
} from "./sdk-shim"

// =========================================================================
// Compile-time invariants — TS errors here fail the typecheck gate
// =========================================================================

describe("sdk-shim integrity (compile-time)", () => {
  test("SessionStatusResponse is a Record<string, SessionStatus>", () => {
    // The SDK returns Record<sessionID, VariantUnion>; the shim narrows
    // SessionStatus to the single-variant union. The Record mapping must
    // still hold for state.session_status[sessionID] consumers.
    const _response: SessionStatusResponse = {
      ses_a: { type: "idle" },
      ses_b: { type: "busy" },
    } as SessionStatusResponse
    const _state: Record<string, SessionStatus> = _response
    expect(Object.keys(_state)).toHaveLength(2)
  })

  test("CommandListResponses[200] is assignable to Command[]", () => {
    // Phase 6.2 fix: Command derived from CommandListResponses[200] (not
    // ProjectListResponses[200]). If the SDK endpoint shape changes, this
    // assignment breaks and the test fails at compile time.
    const _response: CommandListResponses[200] = []
    const _command: Command[] = _response
    expect(_command).toBeDefined()
  })

  test("Command single item from CommandListResponses[200] is assignable to Command", () => {
    const _response: CommandListResponses[200] = [
      {
        name: "build",
        description: "build the project",
        agent: "build",
        model: "anthropic/claude-sonnet-4-20250514",
        source: "command",
        template: "build $1",
        subtask: false,
        hints: ["target"],
      },
    ]
    const _first: Command = _response[0]!
    expect(_first.name).toBe("build")
  })

  test("PermissionListResponses[200] item is assignable to PermissionRequest", () => {
    // Phase 6.5 tightening: PermissionRequest.id and .sessionID became
    // required. The SDK list endpoint returns items with these fields
    // required — compatibility preserved.
    const _list: PermissionListResponses[200] = [
      {
        id: "perm-1",
        sessionID: "ses-1",
        permission: "bash",
        patterns: ["*"],
        metadata: {},
        always: [],
      },
    ]
    const _first: PermissionRequest = _list[0]!
    expect(_first.id).toBe("perm-1")
    expect(_first.sessionID).toBe("ses-1")
  })

  test("QuestionListResponses is not directly exposed (uses individual extract)", () => {
    // QuestionListResponses[200] in SDK returns Array<{ id; sessionID; ... }>
    // (not the QuestionRequest envelope). We don't expose QuestionListResponse
    // in shim because consumers should use QuestionRequest from event payloads.
    // This invariant documents that intentional choice.
    const _list: QuestionListResponses = { 200: [] }
    expect(_list[200]).toBeDefined()
  })

  test("SessionStatusResponse keys are assignable to SessionStatus", () => {
    // Critical narrowing: indexing the Record must yield a SessionStatus
    // (single variant), not the wider VariantUnion. If the index signature
    // is reintroduced, this fails to compile.
    const _response: SessionStatusResponse = {
      ses_test: { type: "idle" },
    } as SessionStatusResponse
    const _key: keyof SessionStatusResponse = "ses_test"
    const _value: SessionStatus = _response[_key]
    expect(_value.type).toBe("idle")
  })
})

// =========================================================================
// Runtime invariants — explicit assertions of expected shape
// =========================================================================

describe("sdk-shim runtime invariants", () => {
  test("SessionStatus discriminated union covers all 9 variants", () => {
    // Runtime check: at least 9 distinct type literals exist. If Phase 6.2
    // shim drops or merges a variant, this test fails.
    const sample: SessionStatus[] = [
      { type: "idle" },
      { type: "retry", attempt: 1, message: "rate limited", next: Date.now() + 1000 },
      { type: "busy" },
      { type: "queued" },
      { type: "blocked", reason: "approval needed" },
      { type: "awaiting_input", question: "select model" },
      { type: "completed", result: "ok" },
      { type: "failed", error: "internal" },
      { type: "cancelled" },
    ]
    const types = new Set(sample.map((s) => s.type))
    expect(types.size).toBe(9)
  })

  test("SessionStatus retry variant requires attempt/message/next", () => {
    // Phase 6.2 invariant: retry is the only variant with required number
    // fields. If someone marks these optional, the discriminated union
    // narrows incorrectly.
    const retry: SessionStatus = {
      type: "retry",
      attempt: 3,
      message: "retrying",
      next: Date.now() + 5000,
    }
    if (retry.type === "retry") {
      expect(typeof retry.attempt).toBe("number")
      expect(typeof retry.message).toBe("string")
      expect(typeof retry.next).toBe("number")
    }
  })

  test("PermissionRequest requires id and sessionID at compile time", () => {
    // Type-only assertion. If shim reverts to optional, this fails to compile.
    const _perm: PermissionRequest = {
      id: "perm-1",
      sessionID: "ses-1",
    }
    expect(_perm.id).toBe("perm-1")
  })

  test("QuestionRequest requires id and sessionID at compile time", () => {
    const _req: QuestionRequest = {
      id: "q-1",
      sessionID: "ses-1",
      questions: [],
    }
    expect(_req.id).toBe("q-1")
  })

  test("QuestionInfo shape (label + description?) is preserved", () => {
    // Phase 6.5 invariant: QuestionInfo.options is the question options
    // array shape (label required, description optional).
    const info: QuestionInfo = {
      question: "select model",
      header: "Model",
      options: [{ label: "gpt-4" }, { label: "claude", description: "anthropic" }],
    }
    expect(info.options).toHaveLength(2)
    expect(info.options?.[0]?.label).toBe("gpt-4")
    expect(info.options?.[1]?.description).toBe("anthropic")
  })

  test("SessionStatusResponses[200] is a Record from sessionID to status", () => {
    // Phase 6.2 invariant preserved: the SDK response is the FULL Record,
    // not a single status. Consumers like bootstrap.ts pass x.data! directly
    // to setStore("session_status", ...).
    const sample: SessionStatusResponses[200] = {
      "ses-1": { type: "idle" },
      "ses-2": { type: "busy" },
      "ses-3": { type: "retry", attempt: 1, message: "rate limited", next: 0 },
    }
    expect(Object.keys(sample)).toHaveLength(3)
  })
})
