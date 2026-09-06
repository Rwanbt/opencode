/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M2-05 — `control.map` family configuration schema + parser (Plan V2.3.1 §198).
 *
 * ADR-002 (Workflow IR) + ADR-005 (artifact contract) + ADR-003 (expression
 * language). The `control.map` family was added to `NodeFamilySchema` in the
 * M2-05/06 commit (HEAD = 3542002532). M2-05 is the explicit shape of the
 * family's `config` object — input expression, body node id, stable-key
 * spec, optional maxConcurrency — and the parser that enforces it at the
 * family's trust boundary.
 *
 * Replay-safety note (ADR-005): the `key` spec is the durable identity of
 * an item across replays. The runtime is responsible for emitting a
 * `mapItemId` for each item, but the schema is the contract surface that
 * pins the key extraction strategy (`field` vs `hash`) and the
 * cross-field rule that forbids `field` with `hash` and requires it for
 * `field`. This test net locks that surface.
 *
 * Locked invariants (regression net):
 *   (1) `ControlMapConfigSchema` parses a minimal config (input + body
 *       + key: { strategy: "field", field }) and a full config
 *       (input + body + key: { strategy: "hash" } + maxConcurrency).
 *   (2) `MapKeyStrategySchema` lists exactly ["field", "hash"].
 *   (3) `input` and `body` are required non-empty strings; `input` is
 *       bounded at 1024 chars.
 *   (4) `MapKeySpecSchema.refine(...)` enforces:
 *         (a) `strategy: "field"` requires a non-empty `field`;
 *         (b) `strategy: "hash"` forbids `field` (even empty).
 *   (5) `key.field` is bounded at `CONTROL_MAP_KEY_FIELD_MAX_CHARS`.
 *   (6) `maxConcurrency` is an optional positive integer ≤ 64; 0 and 65
 *       are rejected.
 *   (7) `parseControlMapConfig` is a thin, throw-on-failure wrapper
 *       around the schema (parity with M2-01..04 helpers).
 *   (8) `NodeFamilySchema` lists `control.map`; a `NodeSchema` with
 *       `family: "control.map"` is accepted at the IR level (the
 *       family-specific config is opaque to the IR, parsed only at
 *       the family's trust boundary).
 */
import { describe, expect, test } from "bun:test"
import {
  ControlMapConfigSchema,
  MapKeySpecSchema,
  MapKeyStrategySchema,
  parseControlMapConfig,
  NodeSchema,
  CONTROL_MAP_KEY_FIELD_MAX_CHARS,
  NodeFamilySchema,
} from "../src/workflow-ir.ts"

/**
 * A canonical minimal valid config used across the happy-path and
 * round-trip tests. Keeping the fixture here means the helper tests
 * do not depend on any other test file's helpers.
 */
const minimalFieldConfig = {
  input: "input.items",
  body: "n-process",
  key: { strategy: "field" as const, field: "id" },
}

const minimalHashConfig = {
  input: "input.items",
  body: "n-process",
  key: { strategy: "hash" as const },
}

describe("ControlMapConfigSchema — happy path (1, 2, 3)", () => {
  test("(1) ParsesValidMinimalConfig — input + body + key: { strategy: 'field', field: 'id' }", () => {
    const parsed = ControlMapConfigSchema.parse(minimalFieldConfig)
    expect(parsed.input).toBe("input.items")
    expect(parsed.body).toBe("n-process")
    expect(parsed.key.strategy).toBe("field")
    expect(parsed.key.field).toBe("id")
    // maxConcurrency is optional and absent here.
    expect(parsed.maxConcurrency).toBeUndefined()
  })

  test("(2) ParsesValidFullConfig — input + body + key: { strategy: 'hash' } + maxConcurrency: 4", () => {
    const parsed = ControlMapConfigSchema.parse({
      ...minimalHashConfig,
      maxConcurrency: 4,
    })
    expect(parsed.input).toBe("input.items")
    expect(parsed.body).toBe("n-process")
    expect(parsed.key.strategy).toBe("hash")
    expect(parsed.key.field).toBeUndefined()
    expect(parsed.maxConcurrency).toBe(4)
  })

  test("(3) MapKeyStrategySchema_AcceptsBothStrategies — enum lists exactly ['field', 'hash']", () => {
    expect(MapKeyStrategySchema.options).toEqual(["field", "hash"])
  })
})

describe("ControlMapConfigSchema — input / body rejection (4, 5, 6)", () => {
  test("(4) RejectsEmptyInput — `input: ''` is rejected", () => {
    const result = ControlMapConfigSchema.safeParse({
      ...minimalFieldConfig,
      input: "",
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(" | ")
      expect(msg).toMatch(/control\.map/)
      expect(msg).toMatch(/non-empty/)
    }
  })

  test("(5) RejectsEmptyBody — `body: ''` is rejected", () => {
    const result = ControlMapConfigSchema.safeParse({
      ...minimalFieldConfig,
      body: "",
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(" | ")
      expect(msg).toMatch(/control\.map/)
      expect(msg).toMatch(/non-empty/)
    }
  })

  test("(6) RejectsTooLongInput — `input` of 1025 chars is rejected (limit is 1024)", () => {
    const longInput = "x".repeat(1025)
    const result = ControlMapConfigSchema.safeParse({
      ...minimalFieldConfig,
      input: longInput,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(" | ")
      expect(msg).toMatch(/control\.map/)
      expect(msg).toMatch(/1024/)
    }
  })
})

describe("MapKeySpecSchema — key spec rejection (7, 8, 9, 10)", () => {
  test("(7) RejectsFieldStrategyWithoutField — `{ strategy: 'field' }` without `field` is rejected", () => {
    const result = MapKeySpecSchema.safeParse({ strategy: "field" })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(" | ")
      expect(msg).toMatch(/control\.map/)
    }
  })

  test("(8) RejectsHashStrategyWithField — `{ strategy: 'hash', field: 'id' }` is rejected (refine)", () => {
    const result = MapKeySpecSchema.safeParse({ strategy: "hash", field: "id" })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(" | ")
      expect(msg).toMatch(/control\.map/)
    }
  })

  test("(9) RejectsEmptyField — `{ strategy: 'field', field: '' }` is rejected (min(1) + refine)", () => {
    const result = MapKeySpecSchema.safeParse({ strategy: "field", field: "" })
    expect(result.success).toBe(false)
  })

  test("(10) RejectsTooLongField — field of CONTROL_MAP_KEY_FIELD_MAX_CHARS + 1 chars is rejected", () => {
    // Sanity: the constant is exported and equals 256.
    expect(CONTROL_MAP_KEY_FIELD_MAX_CHARS).toBe(256)
    const tooLong = "f".repeat(CONTROL_MAP_KEY_FIELD_MAX_CHARS + 1)
    const result = MapKeySpecSchema.safeParse({ strategy: "field", field: tooLong })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(" | ")
      expect(msg).toMatch(/control\.map/)
    }
  })
})

describe("ControlMapConfigSchema — maxConcurrency rejection (11, 12)", () => {
  test("(11) RejectsZeroMaxConcurrency — `maxConcurrency: 0` is rejected (must be positive)", () => {
    const result = ControlMapConfigSchema.safeParse({
      ...minimalFieldConfig,
      maxConcurrency: 0,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(" | ")
      expect(msg).toMatch(/control\.map/)
    }
  })

  test("(12) RejectsTooLargeMaxConcurrency — `maxConcurrency: 65` is rejected (must be ≤ 64)", () => {
    const result = ControlMapConfigSchema.safeParse({
      ...minimalFieldConfig,
      maxConcurrency: 65,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(" | ")
      expect(msg).toMatch(/control\.map/)
    }
  })
})

describe("parseControlMapConfig — helper (13, 14)", () => {
  test("(13) RoundTripsValid — parse → JSON → re-parse is equal (field + hash variants)", () => {
    const fixtures = [minimalFieldConfig, minimalHashConfig] as const
    for (const original of fixtures) {
      const first = parseControlMapConfig(original)
      const roundTripped = parseControlMapConfig(JSON.parse(JSON.stringify(first)))
      expect(roundTripped).toEqual(first)
      expect(roundTripped.input).toBe(original.input)
      expect(roundTripped.body).toBe(original.body)
      expect(roundTripped.key.strategy).toBe(original.key.strategy)
    }
  })

  test("(14) ThrowsOnInvalid — wrong type for `input` (number) throws ZodError", () => {
    // `input` is a string; a number must surface as a ZodError at the
    // trust boundary, never silently coerced.
    expect(() =>
      parseControlMapConfig({
        input: 42 as unknown as string,
        body: "n-process",
        key: { strategy: "field", field: "id" },
      }),
    ).toThrow()
  })
})

describe("M2-05 — IR-level integration (15, 16)", () => {
  test("(15) NodeFamilySchema_AcceptsControlMap — `control.map` is in the enum", () => {
    expect(NodeFamilySchema.options).toContain("control.map")
  })

  test("(16) ControlMapFamilyParse — a NodeSchema with `family: 'control.map'` is accepted at IR level", () => {
    // The IR keeps `NodeSchema.config` opaque — the family-specific
    // shape is validated only at the family's trust boundary, never at
    // the IR parse step. This test pins that contract: an opaque but
    // well-formed (from the IR's perspective) config record parses.
    const parsed = NodeSchema.parse({
      id: "n-map",
      family: "control.map",
      config: {
        input: "input.items",
        body: "n-process",
        key: { strategy: "field", field: "id" },
        maxConcurrency: 4,
      },
    })
    expect(parsed.family).toBe("control.map")
    expect(parsed.id).toBe("n-map")
    // Family-specific validation lives in parseControlMapConfig; the
    // IR does not enforce it. Sanity: the helper still validates the
    // same config object.
    expect(() => parseControlMapConfig(parsed.config)).not.toThrow()
  })
})
