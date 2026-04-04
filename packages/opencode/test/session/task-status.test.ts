import { describe, expect, test } from "bun:test"
import z from "zod"

// Test SessionStatus type validation and state machine logic
// Uses the Zod schema directly - no DB or service dependencies

// Replicated from status.ts for pure testing
const TaskStatus = z.enum([
  "idle",
  "busy",
  "retry",
  "queued",
  "blocked",
  "awaiting_input",
  "completed",
  "failed",
  "cancelled",
])

const Info = z.union([
  z.object({ type: z.literal("idle") }),
  z.object({ type: z.literal("retry"), attempt: z.number(), message: z.string(), next: z.number() }),
  z.object({ type: z.literal("busy") }),
  z.object({ type: z.literal("queued") }),
  z.object({ type: z.literal("blocked"), reason: z.string().optional() }),
  z.object({ type: z.literal("awaiting_input"), question: z.string().optional() }),
  z.object({ type: z.literal("completed"), result: z.string().optional() }),
  z.object({ type: z.literal("failed"), error: z.string().optional() }),
  z.object({ type: z.literal("cancelled") }),
])

// Persistent states (from status.ts)
const PERSISTENT_STATES = new Set(["queued", "blocked", "awaiting_input", "completed", "failed", "cancelled"])

// Resumable states (from task routes)
const RESUMABLE_STATES = new Set(["completed", "failed", "blocked", "awaiting_input", "cancelled", "idle"])

// Cancellable states (from dialog-subagent.tsx)
function isCancellable(statusType: string): boolean {
  return statusType !== "idle" && statusType !== "completed" && statusType !== "cancelled" && statusType !== "failed"
}

// Active states for sidebar (from tasks.tsx)
const ACTIVE_STATES = new Set(["queued", "busy", "blocked", "awaiting_input", "retry"])

describe("task status types", () => {
  describe("schema validation", () => {
    test("all 9 status types parse correctly", () => {
      for (const type of TaskStatus.options) {
        expect(TaskStatus.parse(type)).toBe(type)
      }
    })

    test("invalid status type fails", () => {
      expect(() => TaskStatus.parse("running")).toThrow()
      expect(() => TaskStatus.parse("pending")).toThrow()
      expect(() => TaskStatus.parse("")).toThrow()
    })

    test("idle info parses", () => {
      const result = Info.parse({ type: "idle" })
      expect(result.type).toBe("idle")
    })

    test("retry info requires all fields", () => {
      expect(() => Info.parse({ type: "retry" })).toThrow()
      const result = Info.parse({ type: "retry", attempt: 1, message: "rate limit", next: 5000 })
      expect(result.type).toBe("retry")
    })

    test("completed info with optional result", () => {
      expect(Info.parse({ type: "completed" }).type).toBe("completed")
      const withResult = Info.parse({ type: "completed", result: "done" })
      expect(withResult).toEqual({ type: "completed", result: "done" })
    })

    test("failed info with optional error", () => {
      expect(Info.parse({ type: "failed" }).type).toBe("failed")
      const withError = Info.parse({ type: "failed", error: "timeout" })
      expect(withError).toEqual({ type: "failed", error: "timeout" })
    })

    test("blocked info with optional reason", () => {
      expect(Info.parse({ type: "blocked" }).type).toBe("blocked")
      const withReason = Info.parse({ type: "blocked", reason: "waiting for approval" })
      expect(withReason).toEqual({ type: "blocked", reason: "waiting for approval" })
    })
  })

  describe("persistence rules", () => {
    test("transient states are NOT persisted", () => {
      expect(PERSISTENT_STATES.has("idle")).toBe(false)
      expect(PERSISTENT_STATES.has("busy")).toBe(false)
      expect(PERSISTENT_STATES.has("retry")).toBe(false)
    })

    test("terminal/blocking states ARE persisted", () => {
      expect(PERSISTENT_STATES.has("queued")).toBe(true)
      expect(PERSISTENT_STATES.has("completed")).toBe(true)
      expect(PERSISTENT_STATES.has("failed")).toBe(true)
      expect(PERSISTENT_STATES.has("cancelled")).toBe(true)
      expect(PERSISTENT_STATES.has("blocked")).toBe(true)
      expect(PERSISTENT_STATES.has("awaiting_input")).toBe(true)
    })
  })

  describe("resumable states", () => {
    test("completed tasks can be resumed", () => {
      expect(RESUMABLE_STATES.has("completed")).toBe(true)
    })

    test("failed tasks can be resumed", () => {
      expect(RESUMABLE_STATES.has("failed")).toBe(true)
    })

    test("cancelled tasks can be resumed", () => {
      expect(RESUMABLE_STATES.has("cancelled")).toBe(true)
    })

    test("busy tasks CANNOT be resumed", () => {
      expect(RESUMABLE_STATES.has("busy")).toBe(false)
    })

    test("queued tasks CANNOT be resumed (should be cancelled first)", () => {
      expect(RESUMABLE_STATES.has("queued")).toBe(false)
    })
  })

  describe("cancellable states", () => {
    test("busy tasks can be cancelled", () => {
      expect(isCancellable("busy")).toBe(true)
    })

    test("queued tasks can be cancelled", () => {
      expect(isCancellable("queued")).toBe(true)
    })

    test("blocked tasks can be cancelled", () => {
      expect(isCancellable("blocked")).toBe(true)
    })

    test("completed tasks CANNOT be cancelled", () => {
      expect(isCancellable("completed")).toBe(false)
    })

    test("already cancelled tasks CANNOT be cancelled again", () => {
      expect(isCancellable("cancelled")).toBe(false)
    })

    test("failed tasks CANNOT be cancelled", () => {
      expect(isCancellable("failed")).toBe(false)
    })

    test("idle tasks CANNOT be cancelled", () => {
      expect(isCancellable("idle")).toBe(false)
    })
  })

  describe("active states (sidebar display)", () => {
    test("active states are shown in sidebar", () => {
      expect(ACTIVE_STATES.has("queued")).toBe(true)
      expect(ACTIVE_STATES.has("busy")).toBe(true)
      expect(ACTIVE_STATES.has("blocked")).toBe(true)
      expect(ACTIVE_STATES.has("awaiting_input")).toBe(true)
      expect(ACTIVE_STATES.has("retry")).toBe(true)
    })

    test("terminal states are NOT shown in sidebar", () => {
      expect(ACTIVE_STATES.has("idle")).toBe(false)
      expect(ACTIVE_STATES.has("completed")).toBe(false)
      expect(ACTIVE_STATES.has("failed")).toBe(false)
      expect(ACTIVE_STATES.has("cancelled")).toBe(false)
    })
  })

  describe("state machine transitions", () => {
    // Valid transitions based on the codebase
    const validTransitions: Record<string, string[]> = {
      idle: ["busy", "queued"],
      queued: ["busy", "cancelled"],
      busy: ["completed", "failed", "cancelled", "retry", "blocked", "awaiting_input", "idle"],
      retry: ["busy", "failed", "cancelled"],
      blocked: ["busy", "cancelled", "failed"],
      awaiting_input: ["busy", "cancelled", "failed"],
      completed: ["busy"], // can be resumed
      failed: ["busy"], // can be resumed
      cancelled: ["busy"], // can be resumed
    }

    test("all states have defined transitions", () => {
      for (const status of TaskStatus.options) {
        expect(validTransitions).toHaveProperty(status)
        expect(validTransitions[status].length).toBeGreaterThan(0)
      }
    })

    test("terminal states can only transition to busy (via resume)", () => {
      for (const terminal of ["completed", "failed", "cancelled"]) {
        expect(validTransitions[terminal]).toEqual(["busy"])
      }
    })
  })
})
