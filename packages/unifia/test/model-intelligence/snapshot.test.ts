import { describe, expect, test } from "bun:test"
import { Registry, isoUtcNow, type Registry as RegistryT } from "../../src/model-intelligence/schema"
import {
  serialize,
  loadSnapshot,
  loadSnapshotWithHash,
  hashSnapshot,
  toCanonicalJSON,
} from "../../src/model-intelligence/snapshot"
import { SCHEMA_VERSION } from "../../src/model-intelligence/schema-version"

const baseUTC = "2026-07-21T00:00:00Z"
const validHash = "a".repeat(64)

function makeMinimalRegistry(): RegistryT {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAtUTC: baseUTC,
    generatorVersion: "test/1.0.0",
    registryID: validHash,
    sources: [
      {
        id: "test",
        url: "https://test.example.com",
        type: "catalog",
        licenseCode: "MIT",
        licenseFileURL: null,
        copyrightNotice: "Copyright (c) 2025",
        parserVersion: "1.0.0",
        confidenceLevel: "official",
        rollbackPolicy: "fallback_to_cache",
        policyDocRef: null,
        deprecated: false,
        deprecationReason: null,
      },
    ],
    providers: [],
    models: [],
    aliases: [],
    health: {
      snapshotAtUTC: baseUTC,
      totalProviders: 0,
      totalModels: 0,
      activeModels: 0,
      deprecatedModels: 0,
      missingPricingModels: 0,
      aliasesResolved: 0,
    },
    provenance: [],
  }
}

describe("snapshot round-trip", () => {
  test("serialize + JSON parse round-trips", () => {
    const reg = makeMinimalRegistry()
    const snap = serialize(reg, "test/1.0.0")
    const json = JSON.stringify(snap, null, 2)
    const parsed = JSON.parse(json) as typeof snap
    expect(parsed.schemaVersion).toBe(reg.schemaVersion)
    expect(parsed.registryID).toBe(reg.registryID)
  })

  test("toCanonicalJSON is byte-stable for same input", () => {
    const reg = makeMinimalRegistry()
    const snap = serialize(reg, "test/1.0.0")
    const a = toCanonicalJSON(snap)
    const b = toCanonicalJSON(snap)
    expect(a).toBe(b)
  })

  test("hashSnapshot is deterministic for same content", () => {
    const reg = makeMinimalRegistry()
    const snap = serialize(reg, "test/1.0.0")
    const h1 = hashSnapshot(snap)
    const h2 = hashSnapshot(snap)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[a-f0-9]{64}$/)
  })

  test("loadSnapshot validates registry shape", () => {
    const reg = makeMinimalRegistry()
    const snap = serialize(reg, "test/1.0.0")
    const json = toCanonicalJSON(snap)
    const loaded = loadSnapshot(json)
    expect(loaded.snapshot.schemaVersion).toBe(SCHEMA_VERSION)
  })

  test("loadSnapshot rejects N-2 schema version", () => {
    const reg = makeMinimalRegistry()
    const snap = serialize(reg, "test/1.0.0")
    const json = JSON.stringify({ ...snap, schemaVersion: "0.5.0" })
    expect(() => loadSnapshot(json)).toThrow()
  })

  test("loadSnapshotWithHash verifies hash before loading", () => {
    const reg = makeMinimalRegistry()
    const snap = serialize(reg, "test/1.0.0")
    const json = toCanonicalJSON(snap)
    const expectedHash = hashSnapshot(snap)
    expect(() => loadSnapshotWithHash(json, expectedHash)).not.toThrow()
  })

  test("loadSnapshotWithHash rejects wrong hash", () => {
    const reg = makeMinimalRegistry()
    const snap = serialize(reg, "test/1.0.0")
    const json = toCanonicalJSON(snap)
    const wrongHash = "f".repeat(64)
    expect(() => loadSnapshotWithHash(json, wrongHash)).toThrow()
  })

  test("loadSnapshot rejects corrupted JSON", () => {
    expect(() => loadSnapshot("not json")).toThrow()
  })

  test("loadSnapshot rejects snapshot missing schemaVersion", () => {
    expect(() => loadSnapshot('{"snapshot":{},"registryID":"' + validHash + '"}')).toThrow()
  })
})