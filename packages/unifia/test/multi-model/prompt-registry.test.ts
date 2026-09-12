/**
 * prompt-registry.test.ts — TEAM-B04
 *
 * Unit tests for multi-model/prompt-registry.ts :
 *   - computePromptContentHash: determinism, key-order independence,
 *     sensitivity to every content field (template/description/version/id)
 *   - register(): mandatory version enforcement, id/version/changeNote
 *     shape validation, zod-schema-shape validation
 *   - register(): version immutability (idempotent identical re-register vs
 *     PromptVersionConflictError on differing content)
 *   - get()/resolveLatest()/listVersions()/getChangelog(): fail-closed on
 *     unknown id/version (never a default/fallback)
 *   - changelog correctness across multiple versions
 *   - validateInput()/validateOutput() against registered zod schemas
 *   - injectable clock determinism
 */

import { describe, expect, test } from "bun:test"
import z from "zod"

import {
  computePromptContentHash,
  createPromptRegistry,
  PromptNotFoundError,
  PromptRegistrationError,
  PromptValidationError,
  PromptVersionConflictError,
  type PromptHashInput,
} from "../../src/multi-model/prompt-registry"

// ---------------------------------------------------------------------------
// computePromptContentHash — determinism
// ---------------------------------------------------------------------------

describe("computePromptContentHash — determinism", () => {
  test("same content twice produces the same hash", () => {
    const input: PromptHashInput = {
      id: "summarize",
      version: "1.0.0",
      template: "Summarize the following text:\n{{text}}",
      description: "Summarization prompt",
    }
    expect(computePromptContentHash(input)).toBe(computePromptContentHash({ ...input }))
  })

  test("hash is independent of the caller's object key insertion order", () => {
    const a: PromptHashInput = {
      id: "summarize",
      version: "1.0.0",
      template: "hello world",
      description: null,
    }
    // Build `b` by assigning fields in the reverse order, proving the hash
    // does not depend on enumeration/insertion order of the input object.
    const b = {} as { -readonly [K in keyof PromptHashInput]: PromptHashInput[K] }
    b.description = null
    b.template = "hello world"
    b.version = "1.0.0"
    b.id = "summarize"

    expect(computePromptContentHash(a)).toBe(computePromptContentHash(b))
  })

  test("different template produces a different hash", () => {
    const base: PromptHashInput = { id: "x", version: "1.0.0", template: "hello", description: null }
    const changed: PromptHashInput = { ...base, template: "hello!" }
    expect(computePromptContentHash(base)).not.toBe(computePromptContentHash(changed))
  })

  test("different id produces a different hash", () => {
    const base: PromptHashInput = { id: "x", version: "1.0.0", template: "hello", description: null }
    const changed: PromptHashInput = { ...base, id: "y" }
    expect(computePromptContentHash(base)).not.toBe(computePromptContentHash(changed))
  })

  test("different version produces a different hash", () => {
    const base: PromptHashInput = { id: "x", version: "1.0.0", template: "hello", description: null }
    const changed: PromptHashInput = { ...base, version: "1.0.1" }
    expect(computePromptContentHash(base)).not.toBe(computePromptContentHash(changed))
  })

  test("different description produces a different hash", () => {
    const base: PromptHashInput = { id: "x", version: "1.0.0", template: "hello", description: null }
    const changed: PromptHashInput = { ...base, description: "now documented" }
    expect(computePromptContentHash(base)).not.toBe(computePromptContentHash(changed))
  })

  test("whitespace changes the hash (content-sensitive, not normalized)", () => {
    const base: PromptHashInput = { id: "x", version: "1.0.0", template: "hello world", description: null }
    const changed: PromptHashInput = { ...base, template: "hello  world" }
    expect(computePromptContentHash(base)).not.toBe(computePromptContentHash(changed))
  })

  test("hash is a 64-char lowercase hex SHA-256 digest", () => {
    const hash = computePromptContentHash({ id: "x", version: "1.0.0", template: "hi", description: null })
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })
})

// ---------------------------------------------------------------------------
// register() — mandatory version + envelope validation
// ---------------------------------------------------------------------------

const InputSchema = z.object({ text: z.string().min(1) })
const OutputSchema = z.object({ summary: z.string().min(1) })

function baseRegistration() {
  return {
    id: "summarize",
    version: "1.0.0",
    template: "Summarize the following text:\n{{text}}",
    description: "Summarization prompt",
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    changeNote: "initial version",
  }
}

describe("register() — mandatory version enforcement", () => {
  test("rejects a registration attempt with no version field at all", () => {
    const registry = createPromptRegistry()
    const { version: _omit, ...withoutVersion } = baseRegistration()
    expect(() => registry.register(withoutVersion as any)).toThrow(PromptRegistrationError)
  })

  test("rejects a registration attempt with version explicitly undefined", () => {
    const registry = createPromptRegistry()
    expect(() => registry.register({ ...baseRegistration(), version: undefined } as any)).toThrow(
      PromptRegistrationError,
    )
  })

  test("rejects a non-semver version string", () => {
    const registry = createPromptRegistry()
    for (const bad of ["1.0", "v1.0.0", "1.0.0-beta", "latest", "", "1.0.0.0"]) {
      expect(() => registry.register({ ...baseRegistration(), version: bad })).toThrow(PromptRegistrationError)
    }
  })

  test("accepts a strict MAJOR.MINOR.PATCH version", () => {
    const registry = createPromptRegistry()
    const record = registry.register(baseRegistration())
    expect(record.version).toBe("1.0.0")
  })
})

describe("register() — envelope + schema-shape validation", () => {
  test("rejects an invalid prompt id (uppercase)", () => {
    const registry = createPromptRegistry()
    expect(() => registry.register({ ...baseRegistration(), id: "Summarize" })).toThrow(PromptRegistrationError)
  })

  test("rejects an empty template", () => {
    const registry = createPromptRegistry()
    expect(() => registry.register({ ...baseRegistration(), template: "" })).toThrow(PromptRegistrationError)
  })

  test("rejects a missing changeNote", () => {
    const registry = createPromptRegistry()
    const { changeNote: _omit, ...withoutChangeNote } = baseRegistration()
    expect(() => registry.register(withoutChangeNote as any)).toThrow(PromptRegistrationError)
  })

  test("rejects an empty changeNote", () => {
    const registry = createPromptRegistry()
    expect(() => registry.register({ ...baseRegistration(), changeNote: "" })).toThrow(PromptRegistrationError)
  })

  test("rejects a non-zod inputSchema", () => {
    const registry = createPromptRegistry()
    expect(() => registry.register({ ...baseRegistration(), inputSchema: { not: "a schema" } as any })).toThrow(
      PromptRegistrationError,
    )
  })

  test("rejects a non-zod outputSchema", () => {
    const registry = createPromptRegistry()
    expect(() => registry.register({ ...baseRegistration(), outputSchema: "nope" as any })).toThrow(
      PromptRegistrationError,
    )
  })

  test("rejects unknown extra fields (strict envelope)", () => {
    const registry = createPromptRegistry()
    expect(() => registry.register({ ...baseRegistration(), extra: "field" } as any)).toThrow(
      PromptRegistrationError,
    )
  })
})

// ---------------------------------------------------------------------------
// register() — version immutability
// ---------------------------------------------------------------------------

describe("register() — version immutability", () => {
  test("re-registering the exact same id+version+content is an idempotent no-op", () => {
    const registry = createPromptRegistry()
    const first = registry.register(baseRegistration())
    const second = registry.register(baseRegistration())
    expect(second.contentHash).toBe(first.contentHash)
    expect(registry.getChangelog("summarize")).toHaveLength(1)
  })

  test("re-registering the same id+version with different content throws PromptVersionConflictError", () => {
    const registry = createPromptRegistry()
    registry.register(baseRegistration())
    expect(() =>
      registry.register({ ...baseRegistration(), template: "Summarize (v2 wording):\n{{text}}" }),
    ).toThrow(PromptVersionConflictError)
    // The conflicting attempt must not have mutated the changelog.
    expect(registry.getChangelog("summarize")).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Fail-closed unknown-prompt behavior
// ---------------------------------------------------------------------------

describe("fail-closed unknown-prompt policy", () => {
  test("get() throws PromptNotFoundError for an unknown id", () => {
    const registry = createPromptRegistry()
    expect(() => registry.get("does-not-exist", "1.0.0")).toThrow(PromptNotFoundError)
  })

  test("get() throws PromptNotFoundError for a known id but unknown version", () => {
    const registry = createPromptRegistry()
    registry.register(baseRegistration())
    expect(() => registry.get("summarize", "9.9.9")).toThrow(PromptNotFoundError)
  })

  test("resolveLatest() throws PromptNotFoundError for an unknown id (no silent default)", () => {
    const registry = createPromptRegistry()
    expect(() => registry.resolveLatest("does-not-exist")).toThrow(PromptNotFoundError)
  })

  test("listVersions() throws PromptNotFoundError for an unknown id", () => {
    const registry = createPromptRegistry()
    expect(() => registry.listVersions("does-not-exist")).toThrow(PromptNotFoundError)
  })

  test("getChangelog() throws PromptNotFoundError for an unknown id", () => {
    const registry = createPromptRegistry()
    expect(() => registry.getChangelog("does-not-exist")).toThrow(PromptNotFoundError)
  })

  test("validateInput()/validateOutput() inherit fail-closed behavior on unknown id", () => {
    const registry = createPromptRegistry()
    expect(() => registry.validateInput("does-not-exist", "1.0.0", { text: "hi" })).toThrow(PromptNotFoundError)
    expect(() => registry.validateOutput("does-not-exist", "1.0.0", { summary: "hi" })).toThrow(PromptNotFoundError)
  })

  test("does not return null/undefined for an unknown prompt — it always throws", () => {
    const registry = createPromptRegistry()
    let threw = false
    try {
      registry.get("nope", "1.0.0")
    } catch (err) {
      threw = true
      expect(err).toBeInstanceOf(PromptNotFoundError)
    }
    expect(threw).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Changelog / versioning behavior
// ---------------------------------------------------------------------------

describe("changelog / versioning behavior", () => {
  test("first registration has previousVersion=null and previousContentHash=null", () => {
    const registry = createPromptRegistry()
    registry.register(baseRegistration())
    const [entry] = registry.getChangelog("summarize")
    expect(entry?.previousVersion).toBeNull()
    expect(entry?.previousContentHash).toBeNull()
    expect(entry?.changeNote).toBe("initial version")
  })

  test("a second version links back to the first via previousVersion/previousContentHash", () => {
    const registry = createPromptRegistry()
    const v1 = registry.register(baseRegistration())
    const v2 = registry.register({
      ...baseRegistration(),
      version: "1.1.0",
      template: "Summarize the following text in one paragraph:\n{{text}}",
      changeNote: "tightened wording to force single-paragraph summaries",
    })

    const changelog = registry.getChangelog("summarize")
    expect(changelog).toHaveLength(2)
    expect(changelog[1]?.previousVersion).toBe("1.0.0")
    expect(changelog[1]?.previousContentHash).toBe(v1.contentHash)
    expect(changelog[1]?.contentHash).toBe(v2.contentHash)
    expect(changelog[1]?.changeNote).toBe("tightened wording to force single-paragraph summaries")
  })

  test("resolveLatest() returns the highest registered semver, not registration order", () => {
    const registry = createPromptRegistry()
    registry.register({ ...baseRegistration(), version: "1.0.0", changeNote: "v1" })
    registry.register({ ...baseRegistration(), version: "2.0.0", changeNote: "v2" })
    registry.register({ ...baseRegistration(), version: "1.5.0", changeNote: "v1.5 registered last" })

    expect(registry.resolveLatest("summarize").version).toBe("2.0.0")
  })

  test("listVersions() returns all versions in ascending semver order", () => {
    const registry = createPromptRegistry()
    registry.register({ ...baseRegistration(), version: "2.0.0", changeNote: "v2" })
    registry.register({ ...baseRegistration(), version: "1.0.0", changeNote: "v1" })
    registry.register({ ...baseRegistration(), version: "1.5.0", changeNote: "v1.5" })

    expect(registry.listVersions("summarize")).toEqual(["1.0.0", "1.5.0", "2.0.0"])
  })

  test("each prompt id has an independent changelog", () => {
    const registry = createPromptRegistry()
    registry.register(baseRegistration())
    registry.register({
      ...baseRegistration(),
      id: "translate",
      changeNote: "initial translate prompt",
    })

    expect(registry.getChangelog("summarize")).toHaveLength(1)
    expect(registry.getChangelog("translate")).toHaveLength(1)
    expect(registry.listVersions("summarize")).toEqual(["1.0.0"])
    expect(registry.listVersions("translate")).toEqual(["1.0.0"])
  })
})

// ---------------------------------------------------------------------------
// validateInput() / validateOutput()
// ---------------------------------------------------------------------------

describe("validateInput() / validateOutput()", () => {
  test("validateInput() returns the parsed value on success", () => {
    const registry = createPromptRegistry()
    registry.register(baseRegistration())
    const result = registry.validateInput<{ text: string }>("summarize", "1.0.0", { text: "hello" })
    expect(result).toEqual({ text: "hello" })
  })

  test("validateInput() throws PromptValidationError with direction=input on schema mismatch", () => {
    const registry = createPromptRegistry()
    registry.register(baseRegistration())
    expect(() => registry.validateInput("summarize", "1.0.0", { text: "" })).toThrow(PromptValidationError)
    expect(() => registry.validateInput("summarize", "1.0.0", { wrongField: 1 })).toThrow(PromptValidationError)
  })

  test("validateOutput() returns the parsed value on success", () => {
    const registry = createPromptRegistry()
    registry.register(baseRegistration())
    const result = registry.validateOutput<{ summary: string }>("summarize", "1.0.0", { summary: "ok" })
    expect(result).toEqual({ summary: "ok" })
  })

  test("validateOutput() throws PromptValidationError with direction=output on schema mismatch", () => {
    const registry = createPromptRegistry()
    registry.register(baseRegistration())
    expect(() => registry.validateOutput("summarize", "1.0.0", { summary: "" })).toThrow(PromptValidationError)
  })
})

// ---------------------------------------------------------------------------
// Injectable clock (deterministic tests)
// ---------------------------------------------------------------------------

describe("injectable clock", () => {
  test("registeredAt uses the injected clock, both on the record and the changelog entry", () => {
    const fixed = new Date("2026-07-25T00:00:00.000Z")
    const registry = createPromptRegistry({ clock: () => fixed })
    const record = registry.register(baseRegistration())
    expect(record.registeredAt).toBe(fixed.toISOString())

    const [entry] = registry.getChangelog("summarize")
    expect(entry?.registeredAt).toBe(fixed.toISOString())
  })
})
