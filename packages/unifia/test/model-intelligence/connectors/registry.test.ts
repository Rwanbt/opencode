/**
 * Tests pour ConnectorRegistry (registry.ts).
 *
 * Couvre :
 *   - allowlist : seul "fake" est autorisé en mode strict ;
 *                 test:* autorisé uniquement si allowTestPrefix=true.
 *   - register / unregister / get / list / ids
 *   - cache : population sur succès, invalidation explicite et globale
 *   - last-valid snapshot : enregistré sur succès, restaurable sur échec
 *   - provenance validation fail-closed (assertValidProvenance)
 *   - version parser mismatch
 *   - unauthorized connector (id inconnu ou hors allowlist)
 *   - toC01ParsedSource (pont vers ingestion C01)
 */

import { describe, expect, test } from "bun:test"
import {
  ConnectorRegistry,
  FakeConnector,
  isAllowedConnectorID,
  toC01ParsedSource,
  ConnectorOperationError,
} from "../../../src/model-intelligence/connectors/registry"
import {
  type Connector,
  type DiscoverResult,
  type PricingResult,
  type CapabilitiesResult,
  type StatusResult,
  type ProvenanceMeta,
} from "../../../src/model-intelligence/connectors/types"
import { VALID_PROVENANCE, VALID_PROVIDER, VALID_MODEL, VALID_ALIAS } from "./fixtures"

// =====================================================================
// Helpers
// =====================================================================

function makeMinimalDiscover(prov: ProvenanceMeta = VALID_PROVENANCE): DiscoverResult {
  return {
    providers: [VALID_PROVIDER as never],
    models: [VALID_MODEL as never],
    aliases: [VALID_ALIAS as never],
    warnings: [],
    provenance: prov,
  }
}

function makeBadProvenance(): ProvenanceMeta {
  // rawHash not 64 hex chars
  return { ...VALID_PROVENANCE, rawHash: "not-a-hash" } as unknown as ProvenanceMeta
}

function makeVersionMismatchProvenance(): ProvenanceMeta {
  return { ...VALID_PROVENANCE, parserVersion: "2.0.0" }
}

function makeCustomConnector(
  id: string,
  version: string = "1.0.0",
  override?: Partial<Connector>,
): Connector {
  return {
    id,
    kind: "catalog",
    version,
    sourceURL: `https://example.test/${id}.json`,
    parserVersion: version,
    licenseCode: "MIT",
    copyrightNotice: "Copyright (c) 2025 Custom",
    licenseFileURL: "https://example.test/LICENSE",
    confidenceLevel: "official",
    async discover(): Promise<DiscoverResult> {
      return makeMinimalDiscover()
    },
    async pricing(): Promise<PricingResult> {
      return { pricing: [], warnings: [], provenance: VALID_PROVENANCE }
    },
    async capabilities(): Promise<CapabilitiesResult> {
      return { capabilities: [], warnings: [], provenance: VALID_PROVENANCE }
    },
    async status(): Promise<StatusResult> {
      return { status: [], warnings: [], provenance: VALID_PROVENANCE }
    },
    ...override,
  }
}

// =====================================================================
// isAllowedConnectorID
// =====================================================================

describe("isAllowedConnectorID", () => {
  test("allows built-in fake", () => {
    expect(isAllowedConnectorID("fake")).toBe(true)
  })

  test("rejects unknown ids when test prefix disabled", () => {
    expect(isAllowedConnectorID("models.dev")).toBe(false)
    expect(isAllowedConnectorID("custom")).toBe(false)
  })

  test("accepts test:* prefix when enabled", () => {
    expect(isAllowedConnectorID("test:foo", true)).toBe(true)
    expect(isAllowedConnectorID("test:bar", true)).toBe(true)
  })

  test("rejects test:* prefix when disabled", () => {
    expect(isAllowedConnectorID("test:foo", false)).toBe(false)
  })

  test("rejects empty string", () => {
    expect(isAllowedConnectorID("", false)).toBe(false)
    expect(isAllowedConnectorID("", true)).toBe(false)
  })
})

// =====================================================================
// register / unregister / get / list
// =====================================================================

describe("ConnectorRegistry.register", () => {
  test("accepts built-in fake connector", () => {
    const reg = new ConnectorRegistry()
    expect(() => reg.register(new FakeConnector())).not.toThrow()
    expect(reg.size()).toBe(1)
  })

  test("rejects unauthorized id (strict mode)", () => {
    const reg = new ConnectorRegistry()
    expect(() => reg.register(makeCustomConnector("models.dev"))).toThrow(ConnectorOperationError)
    expect(reg.size()).toBe(0)
  })

  test("accepts test:* id when allowTestPrefix=true", () => {
    const reg = new ConnectorRegistry({ allowTestPrefix: true })
    expect(() => reg.register(makeCustomConnector("test:foo"))).not.toThrow()
  })

  test("re-registering same id replaces + invalidates cache", async () => {
    const reg = new ConnectorRegistry()
    const fc1 = new FakeConnector()
    reg.register(fc1)
    await reg.discover("fake")
    expect(reg.hasCachedResult("fake")).toBe(true)

    const fc2 = new FakeConnector()
    reg.register(fc2)
    // cache should be cleared after re-register
    expect(reg.hasCachedResult("fake")).toBe(false)
  })

  test("unregister removes connector and clears its caches", async () => {
    const reg = new ConnectorRegistry()
    reg.register(new FakeConnector())
    await reg.discover("fake")
    expect(reg.hasCachedResult("fake")).toBe(true)

    expect(reg.unregister("fake")).toBe(true)
    expect(reg.get("fake")).toBeUndefined()
    expect(reg.hasCachedResult("fake")).toBe(false)
  })

  test("unregister returns false for unknown id", () => {
    const reg = new ConnectorRegistry()
    expect(reg.unregister("does-not-exist")).toBe(false)
  })

  test("list() returns all registered connectors", () => {
    const reg = new ConnectorRegistry({ allowTestPrefix: true })
    reg.register(new FakeConnector())
    reg.register(makeCustomConnector("test:foo"))
    const list = reg.list()
    expect(list.length).toBe(2)
    expect(reg.ids().sort()).toEqual(["fake", "test:foo"])
  })
})

// =====================================================================
// discover / pricing / capabilities / status — success path
// =====================================================================

describe("ConnectorRegistry — successful operations", () => {
  test("discover() returns a valid DiscoverResult and caches it", async () => {
    const reg = new ConnectorRegistry()
    reg.register(new FakeConnector())
    const r = await reg.discover("fake")
    expect(r.providers.length).toBe(1)
    expect(r.provenance.sourceID).toBe("fake:test:fixture")
    expect(reg.hasCachedResult("fake")).toBe(true)
  })

  test("pricing() / capabilities() / status() populate their respective cache slots", async () => {
    const reg = new ConnectorRegistry()
    reg.register(new FakeConnector())
    await reg.pricing("fake")
    await reg.capabilities("fake")
    await reg.status("fake")
    expect(reg.hasCachedResult("fake")).toBe(true)
    const bag = (reg as unknown as { cache: { getBag(id: string): unknown } }).cache.getBag("fake")
    expect(bag).toBeDefined()
  })

  test("last-valid snapshot is recorded on success", async () => {
    const reg = new ConnectorRegistry()
    reg.register(new FakeConnector())
    await reg.discover("fake")
    expect(reg.hasLastValid("fake")).toBe(true)
    const snap = reg.restoreLastValid("fake")
    expect(snap).toBeDefined()
    expect(snap!.discover).toBeDefined()
  })
})

// =====================================================================
// discover — error paths (fail-closed)
// =====================================================================

describe("ConnectorRegistry — error paths (fail-closed)", () => {
  test("discover() with FakeConnector in fail-fetch mode rethrows", async () => {
    const reg = new ConnectorRegistry()
    reg.register(new FakeConnector({ mode: "fail-fetch" }))
    await expect(reg.discover("fake")).rejects.toThrow(ConnectorOperationError)
  })

  test("discover() does NOT cache result on failure", async () => {
    const reg = new ConnectorRegistry()
    reg.register(new FakeConnector({ mode: "fail-fetch" }))
    try {
      await reg.discover("fake")
    } catch {
      // expected
    }
    expect(reg.hasCachedResult("fake")).toBe(false)
  })

  test("unknown connector id raises unauthorized", async () => {
    const reg = new ConnectorRegistry()
    let captured: ConnectorOperationError | null = null
    try {
      await reg.discover("does-not-exist")
    } catch (e) {
      captured = e as ConnectorOperationError
    }
    expect(captured).not.toBeNull()
    expect(captured!.detail.kind).toBe("unauthorized")
  })

  test("connector returning invalid provenance raises validation error", async () => {
    const reg = new ConnectorRegistry({ allowTestPrefix: true })
    const bad: Connector = {
      ...makeCustomConnector("test:bad"),
      async discover(): Promise<DiscoverResult> {
        return makeMinimalDiscover(makeBadProvenance())
      },
    }
    reg.register(bad)
    await expect(reg.discover("test:bad")).rejects.toThrow(ConnectorOperationError)
  })

  test("connector returning incompatible parser version raises unsupported_version", async () => {
    const reg = new ConnectorRegistry({ allowTestPrefix: true })
    const bad: Connector = {
      ...makeCustomConnector("test:bad-version", "1.0.0"),
      async discover(): Promise<DiscoverResult> {
        return makeMinimalDiscover(makeVersionMismatchProvenance())
      },
    }
    reg.register(bad)
    let captured: ConnectorOperationError | null = null
    try {
      await reg.discover("test:bad-version")
    } catch (e) {
      captured = e as ConnectorOperationError
    }
    expect(captured).not.toBeNull()
    expect(captured!.detail.kind).toBe("unsupported_version")
  })
})

// =====================================================================
// Last-valid snapshot restoration (degraded mode)
// =====================================================================

describe("ConnectorRegistry — last-valid snapshot restoration", () => {
  test("after success, a later failure still allows restoreLastValid()", async () => {
    const reg = new ConnectorRegistry({ allowTestPrefix: true })
    // Use an in-memory connector that succeeds first, then fails
    let calls = 0
    const flaky: Connector = {
      ...makeCustomConnector("test:flaky"),
      async discover(): Promise<DiscoverResult> {
        calls += 1
        if (calls === 1) return makeMinimalDiscover()
        throw new ConnectorOperationError({
          kind: "fetch",
          sourceID: "test:flaky",
          url: "https://example.test",
          attempts: 1,
          cause: "simulated second-call failure",
        })
      },
    }
    reg.register(flaky)
    const first = await reg.discover("test:flaky")
    expect(first.providers.length).toBe(1)
    expect(reg.hasLastValid("test:flaky")).toBe(true)

    let captured: ConnectorOperationError | null = null
    try {
      await reg.discover("test:flaky")
    } catch (e) {
      captured = e as ConnectorOperationError
    }
    expect(captured).not.toBeNull()
    expect(captured!.detail.kind).toBe("fetch")

    // restoreLastValid returns the last successful snapshot
    const snap = reg.restoreLastValid("test:flaky")
    expect(snap).toBeDefined()
    expect(snap!.discover).toBeDefined()
    expect(snap!.discover!.providers.length).toBe(1)
  })

  test("restoreLastValid returns undefined when no successful call ever happened", () => {
    const reg = new ConnectorRegistry({ allowTestPrefix: true })
    reg.register(makeCustomConnector("test:never"))
    expect(reg.restoreLastValid("test:never")).toBeUndefined()
    expect(reg.hasLastValid("test:never")).toBe(false)
  })

  test("clear on unregister wipes last-valid snapshot", async () => {
    const reg = new ConnectorRegistry({ allowTestPrefix: true })
    reg.register(makeCustomConnector("test:foo"))
    await reg.discover("test:foo")
    expect(reg.hasLastValid("test:foo")).toBe(true)
    reg.unregister("test:foo")
    expect(reg.hasLastValid("test:foo")).toBe(false)
  })
})

// =====================================================================
// Cache invalidation
// =====================================================================

describe("ConnectorRegistry — cache invalidation", () => {
  test("invalidate(id) clears cache for that id only", async () => {
    const reg = new ConnectorRegistry({ allowTestPrefix: true })
    reg.register(makeCustomConnector("test:a"))
    reg.register(makeCustomConnector("test:b"))
    await reg.discover("test:a")
    await reg.discover("test:b")
    expect(reg.hasCachedResult("test:a")).toBe(true)
    expect(reg.hasCachedResult("test:b")).toBe(true)

    reg.invalidate("test:a")
    expect(reg.hasCachedResult("test:a")).toBe(false)
    expect(reg.hasCachedResult("test:b")).toBe(true)
  })

  test("invalidate() with no args clears everything", async () => {
    const reg = new ConnectorRegistry({ allowTestPrefix: true })
    reg.register(makeCustomConnector("test:a"))
    reg.register(makeCustomConnector("test:b"))
    await reg.discover("test:a")
    await reg.discover("test:b")

    reg.invalidate()
    expect(reg.hasCachedResult("test:a")).toBe(false)
    expect(reg.hasCachedResult("test:b")).toBe(false)
    expect(reg.hasLastValid("test:a")).toBe(false)
    expect(reg.hasLastValid("test:b")).toBe(false)
  })

  test("invalidate(id, op) clears a single operation slot", async () => {
    const reg = new ConnectorRegistry()
    reg.register(new FakeConnector())
    await reg.discover("fake")
    await reg.pricing("fake")
    await reg.capabilities("fake")
    await reg.status("fake")

    reg.invalidate("fake", "discover")
    // discover slot cleared, others remain
    const bag = (reg as unknown as { cache: { getBag(id: string): { discover?: unknown; pricing?: unknown; capabilities?: unknown; status?: unknown } } }).cache.getBag("fake")
    expect(bag.discover).toBeUndefined()
    expect(bag.pricing).toBeDefined()
    expect(bag.capabilities).toBeDefined()
    expect(bag.status).toBeDefined()
  })
})

// =====================================================================
// toC01ParsedSource — pont C02 → C01
// =====================================================================

describe("toC01ParsedSource (pont C02 → C01)", () => {
  test("adapts a DiscoverResult to ParsedSource shape expected by ingest()", async () => {
    const fc = new FakeConnector({ deterministic: true })
    const r = await fc.discover()
    const parsed = toC01ParsedSource(r)
    expect(parsed.providers.length).toBe(1)
    expect(parsed.models.length).toBe(1)
    expect(parsed.aliases.length).toBe(1)
    expect(parsed.metadata.sourceID).toBe(r.provenance.sourceID)
    expect(parsed.metadata.sourceVersion).toBe(r.provenance.sourceVersion)
    expect(parsed.metadata.rawHash).toBe(r.provenance.rawHash)
    expect(parsed.metadata.parserVersion).toBe(r.provenance.parserVersion)
    expect(parsed.metadata.fetchedAtUTC).toBe(r.provenance.fetchedAtUTC)
  })

  test("does not mutate the input DiscoverResult", async () => {
    const fc = new FakeConnector({ deterministic: true })
    const r = await fc.discover()
    const before = JSON.stringify(r)
    toC01ParsedSource(r)
    const after = JSON.stringify(r)
    expect(after).toBe(before)
  })
})

// =====================================================================
// Determinism + no network — invariants globaux
// =====================================================================

describe("ConnectorRegistry — invariants globaux", () => {
  test("two calls in deterministic mode produce byte-identical DiscoverResults", async () => {
    const reg = new ConnectorRegistry()
    reg.register(new FakeConnector({ deterministic: true, fetchedAtUTC: "2026-01-01T00:00:00Z" }))
    const a = await reg.discover("fake")
    const b = await reg.discover("fake")
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  test("uses no network — works with offline=true", async () => {
    const reg = new ConnectorRegistry()
    reg.register(new FakeConnector())
    const r = await reg.discover("fake", { offline: true })
    expect(r.providers.length).toBe(1)
  })

  test("allowTestPrefix is read-only after construction (cannot be toggled)", () => {
    const reg = new ConnectorRegistry({ allowTestPrefix: false })
    expect(() => reg.register(makeCustomConnector("test:foo"))).toThrow(ConnectorOperationError)
  })
})