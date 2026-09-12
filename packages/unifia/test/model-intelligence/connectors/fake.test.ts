/**
 * Tests pour FakeConnector (registry.ts).
 *
 * Couvre :
 *   - mode nominal (ok) : discover/pricing/capabilities/status
 *   - modes d'échec : fail-fetch / fail-parse / fail-validation / fail-version
 *   - déterminisme : même fetchedAtUTC quand deterministic=true
 *   - offline : utilisable sans réseau
 *   - provenance obligatoire sur chaque résultat
 *   - license/copyright présents (A05 F-A05-1..6)
 *   - pas de mutation d'état partagé (pure)
 */

import { describe, expect, test } from "bun:test"
import {
  FakeConnector,
  ConnectorOperationError,
} from "../../../src/model-intelligence/connectors/registry"
import { sha256Hex } from "./fixtures"

describe("FakeConnector — mode nominal (ok)", () => {
  const fc = new FakeConnector()

  test("discover() returns 1 provider, 1 model, 1 alias with provenance", async () => {
    const r = await fc.discover()
    expect(r.providers.length).toBe(1)
    expect(r.models.length).toBe(1)
    expect(r.aliases.length).toBe(1)
    expect(r.provenance).toBeDefined()
    expect(r.warnings).toEqual([])
  })

  test("discover() provenance has license/copyright/licenseFileURL", async () => {
    const r = await fc.discover()
    expect(r.provenance.licenseCode).toBe("MIT")
    expect(r.provenance.copyrightNotice).not.toBeNull()
    expect(r.provenance.licenseFileURL).not.toBeNull()
  })

  test("pricing() returns 1 entry with USD pricing", async () => {
    const r = await fc.pricing()
    expect(r.pricing.length).toBe(1)
    expect(r.pricing[0].currency).toBe("USD")
    expect(r.pricing[0].unit).toBe("per_1m_tokens")
    expect(r.pricing[0].input).toBeGreaterThanOrEqual(0)
    expect(r.pricing[0].output).toBeGreaterThanOrEqual(0)
  })

  test("capabilities() returns 1 entry with shape compatible with ModelCapabilities", async () => {
    const r = await fc.capabilities()
    expect(r.capabilities.length).toBe(1)
    const cap = r.capabilities[0].capabilities
    expect(typeof cap.structuredOutput).toBe("boolean")
    expect(typeof cap.toolCalls).toBe("boolean")
    expect(r.capabilities[0].modalities.input).toContain("text")
  })

  test("status() returns 1 entry with status=active and not removed", async () => {
    const r = await fc.status()
    expect(r.status.length).toBe(1)
    expect(r.status[0].status).toBe("active")
    expect(r.status[0].deprecated).toBe(false)
    expect(r.status[0].removed).toBe(false)
    expect(r.status[0].renamedTo).toBeNull()
  })

  test("sourceURL is pinned (constant, never computed at runtime)", () => {
    expect(fc.sourceURL).toBe("https://example.test/api.json")
    expect(new FakeConnector().sourceURL).toBe(fc.sourceURL)
  })

  test("rawHash is SHA-256 hex (64 chars)", async () => {
    const r = await fc.discover()
    expect(r.provenance.rawHash).toMatch(/^[a-f0-9]{64}$/)
    expect(r.provenance.rawHash.length).toBe(64)
  })
})

describe("FakeConnector — déterminisme", () => {
  test("with deterministic=true, fetchedAtUTC is fixed", async () => {
    const fc = new FakeConnector({ deterministic: true })
    const r1 = await fc.discover()
    const r2 = await fc.discover()
    expect(r1.provenance.fetchedAtUTC).toBe("2025-01-01T00:00:00Z")
    expect(r1.provenance.fetchedAtUTC).toBe(r2.provenance.fetchedAtUTC)
  })

  test("with fetchedAtUTC override, that value is used", async () => {
    const fixed = "2030-12-31T23:59:59Z"
    const fc = new FakeConnector({ fetchedAtUTC: fixed })
    const r = await fc.discover()
    expect(r.provenance.fetchedAtUTC).toBe(fixed)
  })

  test("with deterministic=false, two calls in same second produce same fetchedAtUTC", async () => {
    const fc = new FakeConnector()
    const r1 = await fc.discover()
    const r2 = await fc.discover()
    // isoUtcNow() tronque les millisecondes — deux appels dans la même
    // seconde produisent le même timestamp. C'est le comportement
    // attendu et cohérent avec C01.
    expect(r1.provenance.fetchedAtUTC).toBe(r2.provenance.fetchedAtUTC)
  })

  test("rawHash is reproducible for the same raw content", async () => {
    const fc1 = new FakeConnector()
    const fc2 = new FakeConnector()
    const r1 = await fc1.discover()
    const r2 = await fc2.discover()
    expect(r1.provenance.rawHash).toBe(r2.provenance.rawHash)
    // sanity check : the hash is the SHA-256 of the canonical raw
    const expected = sha256Hex(JSON.stringify({ fixture: "fake", providers: ["fake-provider"], models: ["fake-model"] }))
    expect(r1.provenance.rawHash).toBe(expected)
  })
})

describe("FakeConnector — offline", () => {
  test("runs without any network (no fetch call performed)", async () => {
    const fc = new FakeConnector()
    // The connector never reads network — passing offline:true is a no-op
    // but should not break anything.
    const r = await fc.discover({ offline: true })
    expect(r.providers.length).toBe(1)
  })

  test("offline=true is forwarded but does not change semantics", async () => {
    const fc = new FakeConnector()
    const r1 = await fc.discover({ offline: true })
    const r2 = await fc.discover({ offline: false })
    expect(r1.provenance.sourceID).toBe(r2.provenance.sourceID)
    expect(r1.providers.length).toBe(r2.providers.length)
  })
})

describe("FakeConnector — modes d'échec", () => {
  test("fail-fetch raises ConnectorError(kind=fetch)", async () => {
    const fc = new FakeConnector({ mode: "fail-fetch" })
    let captured: ConnectorOperationError | null = null
    try {
      await fc.discover()
    } catch (e) {
      captured = e as ConnectorOperationError
    }
    expect(captured).not.toBeNull()
    expect(captured!.detail.kind).toBe("fetch")
    expect(captured!.detail.sourceID).toBe("fake")
  })

  test("fail-parse raises ConnectorError(kind=parse)", async () => {
    const fc = new FakeConnector({ mode: "fail-parse" })
    let captured: ConnectorOperationError | null = null
    try {
      await fc.pricing()
    } catch (e) {
      captured = e as ConnectorOperationError
    }
    expect(captured).not.toBeNull()
    expect(captured!.detail.kind).toBe("parse")
  })

  test("fail-validation raises ConnectorError(kind=validation)", async () => {
    const fc = new FakeConnector({ mode: "fail-validation" })
    let captured: ConnectorOperationError | null = null
    try {
      await fc.capabilities()
    } catch (e) {
      captured = e as ConnectorOperationError
    }
    expect(captured).not.toBeNull()
    expect(captured!.detail.kind).toBe("validation")
  })

  test("fail-version raises ConnectorError(kind=unsupported_version)", async () => {
    const fc = new FakeConnector({ mode: "fail-version" })
    let captured: ConnectorOperationError | null = null
    try {
      await fc.status()
    } catch (e) {
      captured = e as ConnectorOperationError
    }
    expect(captured).not.toBeNull()
    expect(captured!.detail.kind).toBe("unsupported_version")
  })

  test("fail-fetch propagates through every operation", async () => {
    const fc = new FakeConnector({ mode: "fail-fetch" })
    for (const op of [fc.discover(), fc.pricing(), fc.capabilities(), fc.status()]) {
      let threw = false
      try {
        await op
      } catch (e) {
        threw = true
        expect((e as ConnectorOperationError).detail.kind).toBe("fetch")
      }
      expect(threw).toBe(true)
    }
  })
})

describe("FakeConnector — invariants de pureté", () => {
  test("discover() does not mutate state across calls", async () => {
    const fc = new FakeConnector({ deterministic: true })
    const r1 = await fc.discover()
    const r2 = await fc.discover()
    expect(r1).not.toBe(r2) // different objects
    expect(r1.provenance.sourceID).toBe(r2.provenance.sourceID)
    expect(r1.providers[0].id).toBe(r2.providers[0].id)
  })

  test("does not log any secret-like content in error messages", async () => {
    const fc = new FakeConnector({ mode: "fail-fetch" })
    let captured: ConnectorOperationError | null = null
    try {
      await fc.discover()
    } catch (e) {
      captured = e as ConnectorOperationError
    }
    // ensure no API key / token / bearer string in the message
    expect(captured!.message).not.toMatch(/api[_-]?key/i)
    expect(captured!.message).not.toMatch(/bearer/i)
    expect(captured!.message).not.toMatch(/token/i)
  })
})