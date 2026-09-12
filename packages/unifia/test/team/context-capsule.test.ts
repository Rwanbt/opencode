import { describe, expect, test } from "bun:test"
import { ContextCapsuleBuilder, type ContextCapsuleInput } from "../../src/team/context-capsule"

const SHA = "a".repeat(64)
function input(overrides: Partial<ContextCapsuleInput> = {}): ContextCapsuleInput {
  return {
    objective: "Build a bounded worker capsule",
    acceptance: ["stable hash", "bounded payload"],
    decisions: ["keep contracts verbatim"],
    invariants: ["never include credentials"],
    baseSha: "bc41e1760689602cf299d556d9d183724670c980",
    allowedReferences: [{ path: "src/a.ts", sha256: SHA }],
    predecessorOutputs: [{ path: "handoff.json", sha256: SHA }],
    toolGrants: ["read", "search"],
    budget: { outputTokens: 2000, inputTokens: 10000 },
    rollback: ["revoke lease", "restore checkpoint"],
    handoffs: [{ id: "H01", summary: "read-only runtime complete", remaining: ["none"], risks: [] }],
    artifacts: [{ path: "reports/h01.json", sha256: SHA }],
    ...overrides,
  }
}

describe("ContextCapsuleBuilder", () => {
  test("builds a bounded versioned capsule with a deterministic hash", () => {
    const builder = new ContextCapsuleBuilder()
    const first = builder.build(input())
    const second = builder.build(input({ allowedReferences: [{ path: "src/a.ts", sha256: SHA }], toolGrants: ["search", "read"] }))

    expect(first.status).toBe("BUILT")
    expect(first.capsule?.schemaVersion).toBe("1.0.0")
    expect(first.capsule?.decisions).toEqual(["keep contracts verbatim"])
    expect(first.capsule?.lossChecklist.preservedVerbatim).toContain("decisions")
    expect(first.sha256).toBe(second.sha256)
    expect(first.serialized).toBe(second.serialized)
    expect(first.byteLength).toBeLessThanOrEqual(50 * 1024)
    expect(first.estimatedTokens).toBeLessThanOrEqual(20_000)
  })

  test("summarizes handoffs and references large artifacts by hash", () => {
    const result = new ContextCapsuleBuilder().build(input({
      handoffs: [{ id: "H01", summary: "x".repeat(100), remaining: ["y".repeat(100)], risks: ["z".repeat(100)] }],
    }), { handoffSummaryChars: 32 })

    expect(result.status).toBe("BUILT")
    expect(result.capsule?.handoffs[0]?.length).toBe(32)
    expect(result.capsule?.artifacts).toEqual([{ path: "reports/h01.json", sha256: SHA }])
    expect(result.capsule?.lossChecklist.summarized).toEqual(["handoffs"])
    expect(result.capsule?.lossChecklist.referencedByHash).toContain("artifacts")
  })

  test("reroutes when the required capsule cannot fit the model window", () => {
    const result = new ContextCapsuleBuilder().build(input({ decisions: ["contract ".repeat(1000)] }), { maxBytes: 256, maxTokens: 64 })

    expect(result.status).toBe("REROUTE_REQUIRED")
    expect(result.capsule).toBeUndefined()
    expect(result.reasons.length).toBeGreaterThan(0)
    expect(result.reasons.join(" ")).toContain("limit")
  })

  test("rejects malformed artifact references before serialization", () => {
    expect(() => new ContextCapsuleBuilder().build(input({ artifacts: [{ path: "secret.txt", sha256: "not-a-hash" }] }))).toThrow("lowercase SHA-256")
  })
  test("rejects malformed textual sections and budgets", () => {
    expect(() => new ContextCapsuleBuilder().build(input({ decisions: ["" as never] }))).toThrow("non-empty strings")
    expect(() => new ContextCapsuleBuilder().build(input({ budget: null as never }))).toThrow("budget must be an object")
  })

})
