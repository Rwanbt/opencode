/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M2-06 — `control.repeat` family configuration schema + parser
 * (Plan V2.3.1 §198).
 *
 * ADR-002 (Workflow IR) + ADR-003 (expression language). The
 * `control.repeat` node family, the `ControlRepeatConfigSchema`, the
 * `parseControlRepeatConfig` helper, and the `CONTROL_REPEAT_MAX_ITERATIONS`
 * constant were added to the IR by the M2-05/06 schema commit
 * (HEAD = 3542002532). M2-06 is *not* a new family — the family was
 * already wired into `NodeFamilySchema` by that same commit. M2-06 is
 * the test net that locks the contract: the strictly-bounded loop
 * primitive (different from `while`, which is RED / blocked on ADR-000).
 *
 * `control.repeat` is *necessarily bounded*: a non-bounded loop would
 * defeat the contract (the runtime cannot guarantee the workflow
 * terminates without an upper bound). ADR-002 §6 explicitly requires
 * `repeat` to be strictly bounded — use `while` (M2-07, BLOCKED on
 * ADR-000) for condition-driven loops that may have an unbounded best
 * case. M2-TEST validates that a `repeat(maxIterations=MAX)` is
 * parsable and bounded; the test at index (3) below is the
 * `maxIterations = CONTROL_REPEAT_MAX_ITERATIONS` acceptance
 * contract check.
 *
 * Locked invariants (regression net):
 *   (1) `ControlRepeatConfigSchema` requires `maxIterations` as a
 *       positive integer bounded by `CONTROL_REPEAT_MAX_ITERATIONS`
 *       (1_000_000).
 *   (2) `untilCondition` is optional but, when present, must be a
 *       non-empty string ≤ 1024 chars (ADR-003 surface).
 *   (3) `indexVariable` is optional but, when present, must be a
 *       valid identifier (`[a-zA-Z_][a-zA-Z0-9_]*`) — same pattern
 *       as the other expression-language identifiers.
 *   (4) `body` is a required non-empty string (the per-iteration
 *       node id; runtime does the topology check).
 *   (5) `parseControlRepeatConfig` is a thin, throw-on-failure
 *       wrapper around the schema.
 *   (6) `NodeFamilySchema` lists `control.repeat`.
 */
import { describe, expect, test } from "bun:test"
import {
  ControlRepeatConfigSchema,
  parseControlRepeatConfig,
  CONTROL_REPEAT_MAX_ITERATIONS,
  NodeFamilySchema,
  NodeSchema,
} from "../src/workflow-ir.ts"

describe("ControlRepeatConfigSchema — happy path (1, 2, 3)", () => {
  test("(1) ParsesValidMinimalConfig — only `maxIterations` and `body` set", () => {
    const parsed = ControlRepeatConfigSchema.parse({
      maxIterations: 10,
      body: "n0",
    })
    expect(parsed.maxIterations).toBe(10)
    expect(parsed.body).toBe("n0")
    // Optionals are absent.
    expect(parsed.untilCondition).toBeUndefined()
    expect(parsed.indexVariable).toBeUndefined()
  })

  test("(2) ParsesValidFullConfig — all 4 fields set", () => {
    const parsed = ControlRepeatConfigSchema.parse({
      maxIterations: 100,
      body: "n0",
      untilCondition: "i >= 50",
      indexVariable: "i",
    })
    expect(parsed.maxIterations).toBe(100)
    expect(parsed.body).toBe("n0")
    expect(parsed.untilCondition).toBe("i >= 50")
    expect(parsed.indexVariable).toBe("i")
  })

  test("(3) ParsesMaxIterations — maxIterations = CONTROL_REPEAT_MAX_ITERATIONS is accepted", () => {
    // The bound is 1_000_000; M2-TEST pins the runtime side. The
    // schema side is here: the maximum value is parseable so a
    // pathological-but-bounded input does not crash the parser.
    const parsed = ControlRepeatConfigSchema.parse({
      maxIterations: CONTROL_REPEAT_MAX_ITERATIONS,
      body: "n0",
    })
    expect(parsed.maxIterations).toBe(CONTROL_REPEAT_MAX_ITERATIONS)
    expect(parsed.body).toBe("n0")
  })
})

describe("ControlRepeatConfigSchema — rejection, maxIterations (4, 5, 6, 7)", () => {
  test("(4) RejectsMissingMaxIterations — config without `maxIterations` throws", () => {
    expect(() => ControlRepeatConfigSchema.parse({ body: "n0" })).toThrow(/maxIterations/)
  })

  test("(5) RejectsZeroMaxIterations — maxIterations: 0 is rejected (must be ≥ 1)", () => {
    const result = ControlRepeatConfigSchema.safeParse({
      maxIterations: 0,
      body: "n0",
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(" | ")
      expect(msg).toMatch(/control\.repeat/)
    }
  })

  test("(6) RejectsTooLargeMaxIterations — MAX + 1 is rejected", () => {
    const result = ControlRepeatConfigSchema.safeParse({
      maxIterations: CONTROL_REPEAT_MAX_ITERATIONS + 1,
      body: "n0",
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(" | ")
      expect(msg).toMatch(/control\.repeat/)
    }
  })

  test("(7) RejectsNonIntegerMaxIterations — maxIterations: 1.5 is rejected", () => {
    const result = ControlRepeatConfigSchema.safeParse({
      maxIterations: 1.5,
      body: "n0",
    })
    expect(result.success).toBe(false)
  })
})

describe("ControlRepeatConfigSchema — rejection, untilCondition (8, 9)", () => {
  test("(8) RejectsEmptyUntilCondition — untilCondition: '' throws", () => {
    const result = ControlRepeatConfigSchema.safeParse({
      maxIterations: 10,
      body: "n0",
      untilCondition: "",
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(" | ")
      expect(msg).toMatch(/control\.repeat/)
    }
  })

  test("(9) RejectsTooLongUntilCondition — 1025 chars throws", () => {
    const tooLong = "a".repeat(1025)
    const result = ControlRepeatConfigSchema.safeParse({
      maxIterations: 10,
      body: "n0",
      untilCondition: tooLong,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(" | ")
      expect(msg).toMatch(/control\.repeat/)
    }
  })
})

describe("ControlRepeatConfigSchema — indexVariable (10, 11, 12)", () => {
  test("(10) RejectsEmptyIndexVariable — indexVariable: '' throws", () => {
    const result = ControlRepeatConfigSchema.safeParse({
      maxIterations: 10,
      body: "n0",
      indexVariable: "",
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(" | ")
      expect(msg).toMatch(/control\.repeat/)
    }
  })

  test("(11) RejectsInvalidIndexVariablePattern — indexVariable: '1bad' is rejected", () => {
    // Must match /^[a-zA-Z_][a-zA-Z0-9_]*$/ — leading digit is invalid.
    const result = ControlRepeatConfigSchema.safeParse({
      maxIterations: 10,
      body: "n0",
      indexVariable: "1bad",
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(" | ")
      expect(msg).toMatch(/control\.repeat/)
    }
  })

  test("(12) AcceptsValidIndexVariable — 'i', '_idx', 'counter' all parse", () => {
    const validNames = ["i", "_idx", "counter", "Index_2", "_"]
    for (const indexVariable of validNames) {
      const parsed = ControlRepeatConfigSchema.parse({
        maxIterations: 10,
        body: "n0",
        indexVariable,
      })
      expect(parsed.indexVariable).toBe(indexVariable)
    }
  })
})

describe("ControlRepeatConfigSchema — body (13)", () => {
  test("(13) RejectsEmptyBody — body: '' throws", () => {
    const result = ControlRepeatConfigSchema.safeParse({
      maxIterations: 10,
      body: "",
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(" | ")
      expect(msg).toMatch(/control\.repeat/)
    }
  })
})

describe("parseControlRepeatConfig — helper (14, 15)", () => {
  test("(14) RoundTripsValid — parse → JSON → re-parse is equal", () => {
    const original = {
      maxIterations: 50,
      body: "n-iter",
      untilCondition: "i >= 25",
      indexVariable: "i",
    }
    const first = parseControlRepeatConfig(original)
    const roundTripped = parseControlRepeatConfig(JSON.parse(JSON.stringify(first)))
    expect(roundTripped).toEqual(first)
    expect(roundTripped.maxIterations).toBe(50)
    expect(roundTripped.body).toBe("n-iter")
    expect(roundTripped.untilCondition).toBe("i >= 25")
    expect(roundTripped.indexVariable).toBe("i")
  })

  test("(15) ThrowsOnInvalid — wrong type for `maxIterations` (string) throws ZodError", () => {
    expect(() =>
      parseControlRepeatConfig({ maxIterations: "not-a-number", body: "n0" }),
    ).toThrow()
  })
})

describe("M2-06 — IR-level integration (16, 17)", () => {
  test("(16) NodeFamilySchema_AcceptsControlRepeat — 'control.repeat' is in the enum", () => {
    expect(NodeFamilySchema.options).toContain("control.repeat")
  })

  test("(17) ControlRepeatFamilyParse — a `control.repeat` Node is accepted at IR level", () => {
    // The IR keeps `config` opaque. A `control.repeat` node with a
    // *valid* family-specific config is fine. A `control.repeat` node
    // with a *malformed* config (e.g. maxIterations: 0) is also
    // accepted at the IR level — the family validator catches it
    // later. Same pattern as `control.if` (M2-01 invariant 3).
    const result = NodeSchema.safeParse({
      id: "n-repeat",
      family: "control.repeat",
      config: { maxIterations: 10, body: "n0" },
    })
    expect(result.success).toBe(true)

    // And the family-specific schema still catches the bad shape when
    // explicitly applied to the opaque record.
    const opaqueConfig = { maxIterations: 0, body: "n0" }
    expect(() => parseControlRepeatConfig(opaqueConfig)).toThrow(/control\.repeat/)
  })
})
