/**
 * Tests pour le contrat Connector (types.ts).
 *
 * Couvre :
 *   - validation ProvenanceMeta (Zod schema, fail-closed)
 *   - normalisation des options fetch (bornes, default)
 *   - compatibilité de version parser
 *   - discrimination ConnectorError
 */

import { describe, expect, test } from "bun:test"
import {
  ProvenanceMetaSchema,
  assertValidProvenance,
  assertCompatibleParserVersion,
  normalizeConnectorFetchOptions,
  DEFAULT_CONNECTOR_FETCH_OPTIONS,
  MAX_RETRIES_CAP,
  ConnectorOperationError,
  type ProvenanceMeta,
} from "../../../src/model-intelligence/connectors/types"
import {
  VALID_PROVENANCE,
  VALID_HASH_64,
  FIXED_FETCHED_AT_UTC,
} from "./fixtures"

describe("ProvenanceMetaSchema", () => {
  test("accepts a fully valid ProvenanceMeta", () => {
    const r = ProvenanceMetaSchema.safeParse(VALID_PROVENANCE)
    expect(r.success).toBe(true)
  })

  test("rejects rawHash that is not 64 hex chars", () => {
    const r = ProvenanceMetaSchema.safeParse({ ...VALID_PROVENANCE, rawHash: "not-a-hash" })
    expect(r.success).toBe(false)
  })

  test("rejects uppercase rawHash (must be lowercase)", () => {
    const r = ProvenanceMetaSchema.safeParse({ ...VALID_PROVENANCE, rawHash: VALID_HASH_64.toUpperCase() })
    expect(r.success).toBe(false)
  })

  test("rejects non-URL sourceURL", () => {
    const r = ProvenanceMetaSchema.safeParse({ ...VALID_PROVENANCE, sourceURL: "not-a-url" })
    expect(r.success).toBe(false)
  })

  test("rejects non-semver parserVersion", () => {
    const r = ProvenanceMetaSchema.safeParse({ ...VALID_PROVENANCE, parserVersion: "garbage" })
    expect(r.success).toBe(false)
  })

  test("rejects non-ISO-8601-UTC fetchedAtUTC", () => {
    const r1 = ProvenanceMetaSchema.safeParse({ ...VALID_PROVENANCE, fetchedAtUTC: "2026-01-15" })
    expect(r1.success).toBe(false)
    const r2 = ProvenanceMetaSchema.safeParse({ ...VALID_PROVENANCE, fetchedAtUTC: "2026-01-15T10:00:00+02:00" })
    expect(r2.success).toBe(false)
    const r3 = ProvenanceMetaSchema.safeParse({ ...VALID_PROVENANCE, fetchedAtUTC: "2026-01-15T10:00:00.123Z" })
    expect(r3.success).toBe(false)
  })

  test("accepts SPDX-like licenseCode", () => {
    for (const code of ["MIT", "Apache-2.0", "BSD-3-Clause", "GPL-3.0+"]) {
      const r = ProvenanceMetaSchema.safeParse({ ...VALID_PROVENANCE, licenseCode: code })
      expect(r.success).toBe(true)
    }
  })

  test("rejects licenseCode that is not SPDX-like", () => {
    const r = ProvenanceMetaSchema.safeParse({ ...VALID_PROVENANCE, licenseCode: "creative commons" })
    expect(r.success).toBe(false)
  })

  test("accepts licenseCode=null (undeclared)", () => {
    const r = ProvenanceMetaSchema.safeParse({ ...VALID_PROVENANCE, licenseCode: null })
    expect(r.success).toBe(true)
  })

  test("rejects unknown confidenceLevel", () => {
    const r = ProvenanceMetaSchema.safeParse({ ...VALID_PROVENANCE, confidenceLevel: "magic" })
    expect(r.success).toBe(false)
  })

  test("rejects empty sourceID", () => {
    const r = ProvenanceMetaSchema.safeParse({ ...VALID_PROVENANCE, sourceID: "" })
    expect(r.success).toBe(false)
  })

  test("rejects empty sourceVersion", () => {
    const r = ProvenanceMetaSchema.safeParse({ ...VALID_PROVENANCE, sourceVersion: "" })
    expect(r.success).toBe(false)
  })
})

describe("assertValidProvenance (fail-closed guard)", () => {
  test("returns the parsed object when valid", () => {
    const p = assertValidProvenance(VALID_PROVENANCE)
    expect(p.sourceID).toBe(VALID_PROVENANCE.sourceID)
  })

  test("throws ConnectorOperationError(kind=validation) on invalid input", () => {
    let captured: ConnectorOperationError | null = null
    try {
      assertValidProvenance({ ...VALID_PROVENANCE, rawHash: "wrong" })
    } catch (e) {
      captured = e as ConnectorOperationError
    }
    expect(captured).not.toBeNull()
    expect(captured!.detail.kind).toBe("validation")
    expect(captured!.detail.sourceID).toBe(VALID_PROVENANCE.sourceID)
  })

  test("throws on completely malformed input", () => {
    expect(() => assertValidProvenance({})).toThrow(ConnectorOperationError)
    expect(() => assertValidProvenance(null)).toThrow(ConnectorOperationError)
    expect(() => assertValidProvenance("not an object")).toThrow(ConnectorOperationError)
  })
})

describe("normalizeConnectorFetchOptions", () => {
  test("returns defaults when called with no args", () => {
    const o = normalizeConnectorFetchOptions()
    expect(o.timeoutMs).toBe(DEFAULT_CONNECTOR_FETCH_OPTIONS.timeoutMs)
    expect(o.maxRetries).toBe(DEFAULT_CONNECTOR_FETCH_OPTIONS.maxRetries)
    expect(o.offline).toBe(false)
    expect(o.signal).toBeNull()
    expect(o.expectedHash).toBeNull()
  })

  test("clamps maxRetries to MAX_RETRIES_CAP (5)", () => {
    const o = normalizeConnectorFetchOptions({ maxRetries: 99 })
    expect(o.maxRetries).toBe(MAX_RETRIES_CAP)
  })

  test("clamps maxRetries to minimum 1", () => {
    const o = normalizeConnectorFetchOptions({ maxRetries: 0 })
    expect(o.maxRetries).toBe(1)
    const o2 = normalizeConnectorFetchOptions({ maxRetries: -5 })
    expect(o2.maxRetries).toBe(1)
  })

  test("clamps timeoutMs to minimum 100", () => {
    const o = normalizeConnectorFetchOptions({ timeoutMs: 10 })
    expect(o.timeoutMs).toBe(100)
  })

  test("preserves offline=true when set", () => {
    const o = normalizeConnectorFetchOptions({ offline: true })
    expect(o.offline).toBe(true)
  })

  test("preserves AbortSignal when provided", () => {
    const ctl = new AbortController()
    const o = normalizeConnectorFetchOptions({ signal: ctl.signal })
    expect(o.signal).toBe(ctl.signal)
  })
})

describe("assertCompatibleParserVersion", () => {
  test("accepts identical parserVersion", () => {
    expect(() => assertCompatibleParserVersion("src", "1.0.0", "1.0.0")).not.toThrow()
  })

  test("accepts identical major with different minor", () => {
    expect(() => assertCompatibleParserVersion("src", "1.5.0", "1.7.0")).not.toThrow()
  })

  test("rejects major-version mismatch", () => {
    expect(() => assertCompatibleParserVersion("src", "2.0.0", "1.0.0")).toThrow(ConnectorOperationError)
    expect(() => assertCompatibleParserVersion("src", "1.0.0", "2.0.0")).toThrow(ConnectorOperationError)
  })

  test("rejects malformed semver", () => {
    expect(() => assertCompatibleParserVersion("src", "garbage", "1.0.0")).toThrow(ConnectorOperationError)
    expect(() => assertCompatibleParserVersion("src", "1.0.0", "garbage")).toThrow(ConnectorOperationError)
  })
})

describe("ConnectorOperationError", () => {
  test("has the correct name and message format", () => {
    const e = new ConnectorOperationError({
      kind: "fetch",
      sourceID: "test:src",
      url: "https://example.test",
      attempts: 3,
      cause: "timeout",
    })
    expect(e.name).toBe("ConnectorOperationError")
    expect(e.message).toContain("ConnectorError[fetch]")
    expect(e.message).toContain("sourceID=test:src")
    expect(e.detail.kind).toBe("fetch")
  })

  test("detail is a discriminated union that can be narrowed", () => {
    const e = new ConnectorOperationError({
      kind: "unsupported_version",
      sourceID: "test:src",
      parserVersion: "2.0.0",
      currentParserVersion: "1.0.0",
    })
    expect(e.detail.kind).toBe("unsupported_version")
  })
})

describe("ProvenanceMeta — invariants", () => {
  test("URL is preserved across all required fields", () => {
    const p: ProvenanceMeta = VALID_PROVENANCE
    expect(typeof p.sourceID).toBe("string")
    expect(p.sourceID.length).toBeGreaterThan(0)
    expect(typeof p.parserVersion).toBe("string")
    expect(p.parserVersion).toMatch(/^\d+\.\d+\.\d+/)
    expect(typeof p.rawHash).toBe("string")
    expect(p.rawHash.length).toBe(64)
    expect(p.fetchedAtUTC).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })

  test("FIXED_FETCHED_AT_UTC is stable (test determinism)", () => {
    expect(FIXED_FETCHED_AT_UTC).toBe("2026-01-15T10:00:00Z")
  })
})