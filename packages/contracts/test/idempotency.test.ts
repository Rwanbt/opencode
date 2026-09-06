/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M3-03 — `IdempotencyClass` + `EffectNodeConfigSchema` (Plan V2.3.1 §200,
 * ADR-007).
 *
 * M3-03 is the third card in the M3 Effect / Timer / Cancellation round.
 * It declares the *idempotency class* of a side effect at the IR level
 * (NONE / PROVIDER / USER / BUSINESS) and ties that class to the
 * presence/absence of an `idempotencyKey`. The runtime uses the class to
 * decide whether auto-retry (M3-04) is safe, whether reconciliation
 * (M3-05) needs a probe, and whether UNKNOWN_EXTERNAL_STATE (M3-06) can
 * route to RECONCILE_REPLAY (it can, iff `idempotency != NONE`).
 *
 * Locked invariants (regression net):
 *   (1) `IdempotencyClassSchema` accepts the 4 documented literals and
 *       rejects any other string (no `MAYBE`, no `none` lowercase).
 *   (2) `EffectNodeConfigSchema` parses the 4 valid combinations of
 *       `{ idempotency, idempotencyKey }`:
 *         - `{ idempotency: "NONE" }`    — key forbidden.
 *         - `{ idempotency: "BUSINESS" }` — key forbidden.
 *         - `{ idempotency: "PROVIDER", idempotencyKey: "..." }` — key required.
 *         - `{ idempotency: "USER",     idempotencyKey: "..." }` — key required.
 *   (3) The `refine` rejects every cross combination:
 *         - `NONE` with key, `BUSINESS` with key, `PROVIDER` without
 *           key, `USER` without key.
 *   (4) The shared shape carries an optional `description` capped at 280
 *       chars (parity with `CONTROL_*_DESCRIPTION_MAX_CHARS`).
 *   (5) `idempotencyKey` length is bounded at 256 chars
 *       (`EFFECT_IDEMPOTENCY_KEY_MAX_CHARS`); empty string is rejected.
 *   (6) `parseEffectNodeConfig` is a thin, throw-on-failure wrapper that
 *       round-trips valid inputs and throws on invalid ones.
 *   (7) The IR remains *unaffected* — `NodeSchema` still accepts a
 *       `tool.http` node with an empty `config` record. The new shape
 *       lives in the family's own validator, just like the M2 `control.*`
 *       family schemas.
 */
import { describe, expect, test } from "bun:test"
import {
  IdempotencyClassSchema,
  EffectNodeConfigSchema,
  parseEffectNodeConfig,
  NodeSchema,
  NodeFamilySchema,
  EFFECT_IDEMPOTENCY_KEY_MAX_CHARS,
  EFFECT_DESCRIPTION_MAX_CHARS,
} from "../src/workflow-ir.ts"

describe("IdempotencyClassSchema — happy path (1)", () => {
  test("(1) AcceptsAllFourValues — NONE, PROVIDER, USER, BUSINESS all parse", () => {
    expect(IdempotencyClassSchema.parse("NONE").valueOf()).toBe(
      "NONE" as unknown as string,
    )
    expect(IdempotencyClassSchema.parse("PROVIDER").valueOf()).toBe(
      "PROVIDER" as unknown as string,
    )
    expect(IdempotencyClassSchema.parse("USER").valueOf()).toBe(
      "USER" as unknown as string,
    )
    expect(IdempotencyClassSchema.parse("BUSINESS").valueOf()).toBe(
      "BUSINESS" as unknown as string,
    )
  })

  test("(1+) SchemaExposesFourOptions — NodeFamilySchema and IdempotencyClassSchema are distinct", () => {
    // Sanity: IdempotencyClassSchema is a 4-value enum, not the 11-value
    // NodeFamilySchema. The new contract surface must not collide with
    // the IR's family enum.
    expect(IdempotencyClassSchema.options).toHaveLength(4)
    expect(NodeFamilySchema.options.length).toBeGreaterThanOrEqual(11)
  })
})

describe("IdempotencyClassSchema — rejection (2)", () => {
  test("(2) RejectsUnknownLiteral — 'MAYBE' is not a valid class", () => {
    expect(() => IdempotencyClassSchema.parse("MAYBE")).toThrow()
  })

  test("(2+) RejectsLowerCase — 'none' is not a valid class (case-sensitive enum)", () => {
    expect(() => IdempotencyClassSchema.parse("none")).toThrow()
    expect(() => IdempotencyClassSchema.parse("provider")).toThrow()
  })

  test("(2++) RejectsEmpty — '' is not a valid class", () => {
    expect(() => IdempotencyClassSchema.parse("")).toThrow()
  })
})

describe("EffectNodeConfigSchema — happy path (2)", () => {
  test("(2a) ParsesNone — { idempotency: 'NONE' } parses, no key required", () => {
    const parsed = EffectNodeConfigSchema.parse({ idempotency: "NONE" })
    expect(parsed.idempotency).toBe("NONE")
    expect(parsed.idempotencyKey).toBeUndefined()
    expect(parsed.description).toBeUndefined()
  })

  test("(2b) ParsesBusiness — { idempotency: 'BUSINESS' } parses without key", () => {
    const parsed = EffectNodeConfigSchema.parse({ idempotency: "BUSINESS" })
    expect(parsed.idempotency).toBe("BUSINESS")
    expect(parsed.idempotencyKey).toBeUndefined()
  })

  test("(2c) ParsesProviderWithKey — { idempotency: 'PROVIDER', idempotencyKey: 'k-1' } parses", () => {
    const parsed = EffectNodeConfigSchema.parse({
      idempotency: "PROVIDER",
      idempotencyKey: "k-1",
    })
    expect(parsed.idempotency).toBe("PROVIDER")
    expect(parsed.idempotencyKey).toBe("k-1")
  })

  test("(2d) ParsesUserWithKey — { idempotency: 'USER', idempotencyKey: 'user-key-123' } parses", () => {
    const parsed = EffectNodeConfigSchema.parse({
      idempotency: "USER",
      idempotencyKey: "user-key-123",
    })
    expect(parsed.idempotency).toBe("USER")
    expect(parsed.idempotencyKey).toBe("user-key-123")
  })

  test("(2e) ParsesWithDescription — optional description accepted for all 4 classes", () => {
    const base = { description: "sends a Slack message" }
    expect(
      EffectNodeConfigSchema.parse({ ...base, idempotency: "NONE" }).description,
    ).toBe("sends a Slack message")
    expect(
      EffectNodeConfigSchema.parse({ ...base, idempotency: "BUSINESS" }).description,
    ).toBe("sends a Slack message")
    expect(
      EffectNodeConfigSchema.parse({
        ...base,
        idempotency: "PROVIDER",
        idempotencyKey: "k-1",
      }).description,
    ).toBe("sends a Slack message")
    expect(
      EffectNodeConfigSchema.parse({
        ...base,
        idempotency: "USER",
        idempotencyKey: "k-2",
      }).description,
    ).toBe("sends a Slack message")
  })
})

describe("EffectNodeConfigSchema — refine rejections (3)", () => {
  test("(3a) RejectsNoneWithKey — refine rejects 'NONE' + idempotencyKey", () => {
    expect(() =>
      EffectNodeConfigSchema.parse({ idempotency: "NONE", idempotencyKey: "k-1" }),
    ).toThrow(/idempotencyKey/)
  })

  test("(3b) RejectsBusinessWithKey — refine rejects 'BUSINESS' + idempotencyKey", () => {
    expect(() =>
      EffectNodeConfigSchema.parse({ idempotency: "BUSINESS", idempotencyKey: "k-1" }),
    ).toThrow(/idempotencyKey/)
  })

  test("(3c) RejectsProviderWithoutKey — refine rejects 'PROVIDER' without key", () => {
    expect(() =>
      EffectNodeConfigSchema.parse({ idempotency: "PROVIDER" }),
    ).toThrow(/idempotencyKey/)
  })

  test("(3d) RejectsUserWithoutKey — refine rejects 'USER' without key", () => {
    expect(() => EffectNodeConfigSchema.parse({ idempotency: "USER" })).toThrow(
      /idempotencyKey/,
    )
  })
})

describe("EffectNodeConfigSchema — string length and missing fields (4, 5)", () => {
  test("(4a) RejectsTooLongKey — 257-char key is rejected", () => {
    const tooLong = "a".repeat(EFFECT_IDEMPOTENCY_KEY_MAX_CHARS + 1)
    expect(() =>
      EffectNodeConfigSchema.parse({
        idempotency: "PROVIDER",
        idempotencyKey: tooLong,
      }),
    ).toThrow(/idempotencyKey/)
  })

  test("(4a+) AcceptsBoundaryKey — exactly 256-char key is accepted", () => {
    const boundary = "a".repeat(EFFECT_IDEMPOTENCY_KEY_MAX_CHARS)
    const parsed = EffectNodeConfigSchema.parse({
      idempotency: "USER",
      idempotencyKey: boundary,
    })
    expect(parsed.idempotencyKey).toBe(boundary)
  })

  test("(4b) RejectsEmptyKey — idempotencyKey: '' is rejected by .min(1)", () => {
    expect(() =>
      EffectNodeConfigSchema.parse({
        idempotency: "PROVIDER",
        idempotencyKey: "",
      }),
    ).toThrow(/idempotencyKey/)
  })

  test("(5) RejectsTooLongDescription — 281-char description is rejected", () => {
    const tooLong = "a".repeat(EFFECT_DESCRIPTION_MAX_CHARS + 1)
    expect(() =>
      EffectNodeConfigSchema.parse({ idempotency: "NONE", description: tooLong }),
    ).toThrow(/description/)
  })

  test("(5+) RejectsMissingIdempotency — schema requires `idempotency`", () => {
    expect(() => EffectNodeConfigSchema.parse({})).toThrow(/idempotency/)
  })
})

describe("parseEffectNodeConfig — helper (6)", () => {
  test("(6a) RoundTripsValid — parse → JSON → re-parse is equal", () => {
    const original = {
      idempotency: "PROVIDER" as const,
      idempotencyKey: "k-roundtrip",
      description: "HTTP POST with provider-side dedup",
    }
    const first = parseEffectNodeConfig(original)
    const roundTripped = parseEffectNodeConfig(JSON.parse(JSON.stringify(first)))
    expect(roundTripped).toEqual(first)
    expect(roundTripped.idempotency).toBe("PROVIDER")
    expect(roundTripped.idempotencyKey).toBe("k-roundtrip")
    expect(roundTripped.description).toBe("HTTP POST with provider-side dedup")
  })

  test("(6b) ThrowsOnInvalid — wrong type for `idempotency` (number) throws", () => {
    expect(() =>
      parseEffectNodeConfig({ idempotency: 42 as unknown as string }),
    ).toThrow()
  })

  test("(6c) ThrowsOnRefineViolation — 'PROVIDER' without key throws via helper", () => {
    expect(() => parseEffectNodeConfig({ idempotency: "PROVIDER" })).toThrow(
      /idempotencyKey/,
    )
  })
})

describe("M3-03 — non-regression on the IR (7)", () => {
  test("(7) EffectFamilyParse — a `tool.http` Node is accepted at IR level with empty config", () => {
    // The IR keeps `config` opaque. A `tool.http` node with an empty
    // `config` is fine at the IR parse step. The family's own validator
    // (`parseEffectNodeConfig`) catches the missing `idempotency` later,
    // at the trust boundary. This is the same pattern M2-01..06 used for
    // `control.*` families.
    const result = NodeSchema.safeParse({
      id: "n-http",
      family: "tool.http",
      config: {},
    })
    expect(result.success).toBe(true)
  })

  test("(7+) EffectFamilyParseWithAdHocKeys — `tool.http` with random config keys is also fine at IR level", () => {
    // The IR does not pre-empt effector shape: a `tool.http` with
    // `idempotency: 'PROVIDER'` and `idempotencyKey: 'k-1'` parses at the
    // IR level. The IR's job is to pin `config: record(string, unknown)`.
    const result = NodeSchema.safeParse({
      id: "n-http",
      family: "tool.http",
      config: { idempotency: "PROVIDER", idempotencyKey: "k-1" },
    })
    expect(result.success).toBe(true)
  })

  test("(7++) ControlFamilyParseUnchanged — `control.if` with empty config is still rejected (M2-01 invariant holds)", () => {
    // M3-03 must not regress M2-01: a `control.if` node with an empty
    // config is still accepted at the IR level (config is opaque), and
    // the family-specific schema (M2-01's `parseControlIfConfig`) still
    // rejects it at the family's trust boundary. The new
    // `EffectNodeConfigSchema` lives on a different family and must not
    // interfere.
    const nodeResult = NodeSchema.safeParse({
      id: "n-if",
      family: "control.if",
      config: {},
    })
    expect(nodeResult.success).toBe(true)

    // M2-01's own validator still catches the missing `condition`. We
    // assert this here as a regression net: if M3-03's `.refine` ever
    // starts cross-checking unrelated fields, this would flip.
    // (We import lazily to keep the test self-contained; if the import
    // path changes, the test fails loudly — which is the correct
    // behavior: M2-01's invariant is the contract under test.)
    const { ControlIfConfigSchema } = require("../src/workflow-ir.ts") as {
      ControlIfConfigSchema: { parse: (c: unknown) => unknown }
    }
    expect(() => ControlIfConfigSchema.parse({})).toThrow(/condition/)
  })
})
