/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M2-02 — `control.switch` family configuration schema + parser (Plan V2.3.1 §198).
 *
 * ADR-002 (Workflow IR) + ADR-003 (expression language). `control.switch` is a
 * new node family added by M2-02 (multi-way branch on a discriminator). The
 * `case-value` `EdgeKind` was added at the same time. M2-02 mirrors the M2-01
 * dual-channel pattern: the family schema is applied at the trust boundary via
 * `parseControlSwitchConfig(node.config)` because the IR keeps `Node.config`
 * opaque.
 *
 * Locked invariants (regression net):
 *   (1) `ControlSwitchConfigSchema` requires a non-empty `discriminator`
 *       bounded at `CONTROL_SWITCH_DISCRIMINATOR_MAX_CHARS` (1024) and
 *       an `cases` array of 1..`CONTROL_SWITCH_MAX_CASES` (64) entries.
 *   (2) Each `SwitchCase` has a non-empty `value` (≤
 *       `CONTROL_SWITCH_CASE_VALUE_MAX_CHARS` = 256) and a non-empty
 *       `target` (node id).
 *   (3) Duplicate `case.value` is rejected via `.refine()` (M2-R04:
 *       unambiguous dispatch table).
 *   (4) `default` is optional (omitted ⇒ switch terminates on no-match).
 *   (5) `parseControlSwitchConfig` is a thin, throw-on-failure wrapper
 *       around the schema (mirror of `parseControlIfConfig`).
 *   (6) `NodeFamilySchema` includes `"control.switch"` and `EdgeKindSchema`
 *       includes `"case-value"`.
 */
import { describe, expect, test } from "bun:test"
import {
  ControlSwitchConfigSchema,
  SwitchCaseSchema,
  parseControlSwitchConfig,
  NodeFamilySchema,
  EdgeKindSchema,
  CONTROL_SWITCH_DISCRIMINATOR_MAX_CHARS,
  CONTROL_SWITCH_CASE_VALUE_MAX_CHARS,
  CONTROL_SWITCH_MAX_CASES,
} from "../src/workflow-ir.ts"

describe("ControlSwitchConfigSchema — happy path (1, 2, 7)", () => {
  test("(1) ParsesValidMinimalConfig — 1 case, no default", () => {
    const parsed = ControlSwitchConfigSchema.parse({
      discriminator: "input.tier",
      cases: [{ value: "gold", target: "n-gold" }],
    })
    expect(parsed.discriminator).toBe("input.tier")
    expect(parsed.cases).toHaveLength(1)
    expect(parsed.cases[0]?.value).toBe("gold")
    expect(parsed.cases[0]?.target).toBe("n-gold")
    expect(parsed.default).toBeUndefined()
  })

  test("(2) ParsesValidFullConfig — 5 cases + default", () => {
    const parsed = ControlSwitchConfigSchema.parse({
      discriminator: "input.region",
      cases: [
        { value: "eu", target: "n-eu" },
        { value: "us", target: "n-us" },
        { value: "apac", target: "n-apac" },
        { value: "latam", target: "n-latam" },
        { value: "mea", target: "n-mea" },
      ],
      default: "n-fallback",
    })
    expect(parsed.cases).toHaveLength(5)
    expect(parsed.default).toBe("n-fallback")
    // Order is preserved.
    expect(parsed.cases.map((c) => c.value)).toEqual([
      "eu",
      "us",
      "apac",
      "latam",
      "mea",
    ])
  })

  test("(7) AcceptsDefaultAbsent — no `default` key parses (omit cleanly)", () => {
    const parsed = ControlSwitchConfigSchema.parse({
      discriminator: "input.x",
      cases: [{ value: "a", target: "n-a" }],
    })
    expect(parsed.default).toBeUndefined()
    // `default` is undefined, not a key carrying null.
    expect("default" in parsed).toBe(false)
  })
})

describe("ControlSwitchConfigSchema — rejection (3, 4, 6, 8, 14, 15)", () => {
  test("(3) RejectsEmptyCases — cases: [] throws", () => {
    expect(() =>
      ControlSwitchConfigSchema.parse({
        discriminator: "input.x",
        cases: [],
      }),
    ).toThrow(/at least 1 case/i)
  })

  test("(4) RejectsEmptyDiscriminator — discriminator: '' throws", () => {
    expect(() =>
      ControlSwitchConfigSchema.parse({
        discriminator: "",
        cases: [{ value: "a", target: "n-a" }],
      }),
    ).toThrow(/discriminator/)
  })

  test("(6) RejectsDuplicateCaseValues — 2 cases with same `value` throws", () => {
    expect(() =>
      ControlSwitchConfigSchema.parse({
        discriminator: "input.x",
        cases: [
          { value: "gold", target: "n-gold" },
          { value: "gold", target: "n-gold-2" },
        ],
      }),
    ).toThrow(/duplicate/i)
  })

  test("(8) RejectsTooManyCases — 65 cases throws (over CONTROL_SWITCH_MAX_CASES)", () => {
    const tooMany = Array.from({ length: CONTROL_SWITCH_MAX_CASES + 1 }, (_, i) => ({
      value: `v${i}`,
      target: `n-${i}`,
    }))
    expect(() =>
      ControlSwitchConfigSchema.parse({
        discriminator: "input.x",
        cases: tooMany,
      }),
    ).toThrow(/at most/i)
  })

  test("(14) RejectsTooLongDiscriminator — discriminator over the max throws", () => {
    const tooLong = "a".repeat(CONTROL_SWITCH_DISCRIMINATOR_MAX_CHARS + 1)
    expect(() =>
      ControlSwitchConfigSchema.parse({
        discriminator: tooLong,
        cases: [{ value: "a", target: "n-a" }],
      }),
    ).toThrow(/discriminator/)
  })

  test("(15) RejectsTooLongCaseValue — case.value over the max throws", () => {
    const tooLong = "a".repeat(CONTROL_SWITCH_CASE_VALUE_MAX_CHARS + 1)
    expect(() =>
      ControlSwitchConfigSchema.parse({
        discriminator: "input.x",
        cases: [{ value: tooLong, target: "n-a" }],
      }),
    ).toThrow(/case\.value/)
  })
})

describe("SwitchCaseSchema — rejection (5, 13)", () => {
  test("(5) RejectsEmptyCaseValue — case with value: '' throws", () => {
    expect(() =>
      SwitchCaseSchema.parse({ value: "", target: "n-a" }),
    ).toThrow(/value/)
  })

  test("(13) RejectsEmptyTarget — case with target: '' throws", () => {
    expect(() =>
      SwitchCaseSchema.parse({ value: "gold", target: "" }),
    ).toThrow(/target/)
  })
})

describe("parseControlSwitchConfig — helper (9, 10)", () => {
  test("(9) RoundTripsValid — parse → JSON → re-parse is equal", () => {
    const original = {
      discriminator: "input.tier",
      cases: [
        { value: "gold", target: "n-gold" },
        { value: "silver", target: "n-silver" },
      ],
      default: "n-fallback",
    }
    const first = parseControlSwitchConfig(original)
    const roundTripped = parseControlSwitchConfig(JSON.parse(JSON.stringify(first)))
    expect(roundTripped).toEqual(first)
    expect(roundTripped.discriminator).toBe("input.tier")
    expect(roundTripped.cases).toHaveLength(2)
    expect(roundTripped.default).toBe("n-fallback")
  })

  test("(10) ThrowsOnInvalid — wrong type for `cases` (string not array) throws ZodError", () => {
    let caught: unknown
    try {
      parseControlSwitchConfig({
        discriminator: "input.x",
        cases: "not-an-array",
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    // The Zod error class is exported as z.ZodError; we accept any Error
    // here because exact class identity is not part of the public contract
    // — what matters is that the helper throws on invalid input.
    expect((caught as Error).name).toMatch(/ZodError/)
  })
})

describe("NodeFamily / EdgeKind — registry acceptance (11, 12)", () => {
  test("(11) NodeFamilySchema_AcceptsControlSwitch — 'control.switch' is in the enum", () => {
    expect(NodeFamilySchema.options).toContain("control.switch")
    // And the value actually parses (defense in depth against an enum
    // mutation that forgets to wire the new family through the parser).
    const result = NodeFamilySchema.safeParse("control.switch")
    expect(result.success).toBe(true)
  })

  test("(12) EdgeKindSchema_AcceptsCaseValue — 'case-value' is in the enum", () => {
    expect(EdgeKindSchema.options).toContain("case-value")
    const result = EdgeKindSchema.safeParse("case-value")
    expect(result.success).toBe(true)
  })
})
