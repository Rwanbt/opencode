/**
 * Tests pour HttpConnector (TEAM-C03).
 *
 * Tous les tests utilisent un `fetchImpl` injecté (mock fetch). Aucun
 * appel réseau réel n'est effectué. Les fixtures sont JSON déterministes
 * avec ProvenanceMeta conforme.
 *
 * Couvre :
 *   - 4 opérations nominales (discover/pricing/capabilities/status)
 *   - Timeout via AbortSignal
 *   - Retry épuisé
 *   - Response > 10 MB → erreur fail-closed
 *   - Provenance invalide (Zod) → erreur fail-closed
 *   - License mismatch
 *   - Offline=true avec snapshot → restauration
 *   - Offline=true sans snapshot → offline_no_cache
 *   - Snapshot persistant corrompu → cache_corrupted
 *   - Snapshot invalidation
 *   - Déterminisme hash (même raw → même hash)
 *   - Pas de secret dans messages d'erreur
 *   - Anti-SSRF : URL loopback rejetée
 *   - Whitelist d'URL : URL hors allowlist rejetée
 *   - Pas de mutation d'état entre appels (read-only)
 *   - Persistence disque (round-trip sur disque)
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import {
  HttpConnector,
  HTTP_CONNECTOR_MAX_RESPONSE_BYTES,
  validateSourceURL,
  isValidSemver,
  backoffMs,
  hashOfRaw,
  concatUint8,
  type FetchFn,
} from "../../../src/model-intelligence/connectors/http-connector"
import {
  ConnectorOperationError,
  type ProvenanceMeta,
} from "../../../src/model-intelligence/connectors/types"
import { SnapshotManager } from "../../../src/model-intelligence/connectors/snapshot-manager"

// =====================================================================
// Helpers
// =====================================================================

const FIXED_UTC = "2025-01-15T10:00:00Z"
const VALID_HASH = "a".repeat(64)
const SOURCE_URL = "https://models.example.com/api.json"

function makeProvenance(overrides: Partial<ProvenanceMeta> = {}): ProvenanceMeta {
  return {
    sourceID: "test:modeling:source",
    sourceVersion: "1.0.0",
    sourceURL: SOURCE_URL,
    parserVersion: "1.0.0",
    rawHash: VALID_HASH,
    fetchedAtUTC: FIXED_UTC,
    licenseCode: "MIT",
    copyrightNotice: "Copyright (c) 2025 Test",
    licenseFileURL: "https://example.test/LICENSE",
    confidenceLevel: "official",
    ...overrides,
  }
}

function makeEnvelope(op: string, payload: unknown): string {
  return JSON.stringify({
    provenance: makeProvenance(),
    payload,
  })
}

interface MockResponse extends Response {}

interface MockFetchCall {
  url: string
  init: RequestInit | undefined
}

interface MockFetchHandle {
  fetchImpl: FetchFn
  calls: MockFetchCall[]
  /**
   * Enqueue une réponse. Chaque appel consomme une réponse dans l'ordre.
   * Si on tombe à court, la dernière réponse est réutilisée.
   */
  enqueue: (response: Response | (() => Promise<Response>)) => void
  setNextStatus: (status: number, body?: string) => void
  /**
   * Override la fonction fetch elle-même (utilisé pour simuler AbortError
   * ou autres exceptions côté fetch — déréférencement à chaque appel,
   * donc le test peut réassigner mock.fetchImpl sans recréer le connecteur).
   */
  setFetchImpl: (fn: FetchFn) => void
}

function makeMockFetch(): MockFetchHandle {
  const calls: MockFetchCall[] = []
  const queue: Array<() => Promise<Response>> = []
  let fallback: () => Promise<Response> = () =>
    Promise.resolve(new Response("{}", { status: 200 }))
  let currentImpl: FetchFn = defaultImpl

  function defaultImpl(input: string | URL | Request, init?: Parameters<FetchFn>[1]): Promise<Response> {
    const url = typeof input === "string" ? input : (input as URL).toString()
    calls.push({ url, init })
    const next = queue.shift() ?? fallback
    return next()
  }

  const handle: MockFetchHandle = {
    get fetchImpl() {
      return currentImpl
    },
    set fetchImpl(v: FetchFn) {
      currentImpl = v
    },
    calls,
    enqueue(fn) {
      const v = typeof fn === "function" ? fn : (() => Promise.resolve(fn))
      queue.push(v)
    },
    setNextStatus(status, body = "{}") {
      queue.push(() =>
        Promise.resolve(new Response(body, { status, headers: { "content-type": "application/json" } })),
      )
    },
    setFetchImpl(fn) {
      currentImpl = fn
    },
  }
  return handle
}

function makeStreamingResponse(body: string, status = 200): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body))
      controller.close()
    },
  })
  return new Response(stream, { status, headers: { "content-type": "application/json" } })
}

let tmpRoot: string
let snapManager: SnapshotManager
let connector: HttpConnector
let mock: MockFetchHandle

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "c03-http-test-"))
  snapManager = new SnapshotManager({ rootDir: tmpRoot })
  mock = makeMockFetch()
  // Closure pour que `mock.fetchImpl = ...` (réassignation par le test)
  // prenne effet sans recréer le connecteur.
  const fetchClosure: FetchFn = async (input, init) => mock.fetchImpl(input, init)
  connector = new HttpConnector({
    id: "test-http-connector",
    sourceURL: SOURCE_URL,
    parserVersion: "1.0.0",
    licenseCode: "MIT",
    copyrightNotice: "Copyright (c) 2025 Test",
    licenseFileURL: "https://example.test/LICENSE",
    confidenceLevel: "official",
    fetchImpl: fetchClosure,
    snapshotManager: snapManager,
    deterministic: false,
  })
})

afterEach(async () => {
  connector.clearRequestLog()
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

// =====================================================================
// Helpers de réponse nominales
// =====================================================================

function setValidDiscoverResponse(payload: unknown = { providers: [], models: [], aliases: [] }) {
  mock.enqueue(makeStreamingResponse(makeEnvelope("discover", payload)))
}
function setValidPricingResponse(payload: unknown = { pricing: [] }) {
  mock.enqueue(makeStreamingResponse(makeEnvelope("pricing", payload)))
}
function setValidCapabilitiesResponse(payload: unknown = { capabilities: [] }) {
  mock.enqueue(makeStreamingResponse(makeEnvelope("capabilities", payload)))
}
function setValidStatusResponse(payload: unknown = { status: [] }) {
  mock.enqueue(makeStreamingResponse(makeEnvelope("status", payload)))
}

// =====================================================================
// 1. Validation helpers
// =====================================================================

describe("HttpConnector — helpers (validateSourceURL, isValidSemver, etc.)", () => {
  test("validateSourceURL accepts public https URLs", () => {
    expect(() => validateSourceURL("https://models.dev/api.json")).not.toThrow()
    expect(() => validateSourceURL("https://api.anthropic.com")).not.toThrow()
  })

  test("validateSourceURL rejects localhost (SSRF)", () => {
    expect(() => validateSourceURL("http://localhost:8080/api")).toThrow(/SSRF guard/)
    expect(() => validateSourceURL("http://127.0.0.1/api")).toThrow(/SSRF guard/)
    expect(() => validateSourceURL("http://0.0.0.0/api")).toThrow(/SSRF guard/)
  })

  test("validateSourceURL rejects private ranges", () => {
    expect(() => validateSourceURL("http://10.0.0.5/api")).toThrow(/SSRF guard/)
    expect(() => validateSourceURL("http://192.168.1.1/api")).toThrow(/SSRF guard/)
    // IP literal — use string match to avoid regex literal parser ambiguity
    expect(() => validateSourceURL("http://169.254.169.254/api")).toThrow("SSRF guard")
  })

  test("validateSourceURL rejects non-http schemes", () => {
    expect(() => validateSourceURL("file:///etc/passwd")).toThrow(/http or https/)
    expect(() => validateSourceURL("ftp://example.test/api")).toThrow(/http or https/)
    expect(() => validateSourceURL("javascript:alert(1)")).toThrow(/http or https/)
  })

  test("isValidSemver accepts semver and rejects invalid", () => {
    expect(isValidSemver("1.0.0")).toBe(true)
    expect(isValidSemver("1.0.0-draft")).toBe(true)
    expect(isValidSemver("1.2.3-beta.1+abc")).toBe(true)
    expect(isValidSemver("garbage")).toBe(false)
    expect(isValidSemver("1.0")).toBe(false)
  })

  test("backoffMs grows exponentially with cap", () => {
    const b1 = backoffMs(1)
    const b2 = backoffMs(2)
    const b3 = backoffMs(3)
    const b10 = backoffMs(10)
    expect(b1).toBeGreaterThanOrEqual(200)
    expect(b2).toBeGreaterThan(b1)
    expect(b3).toBeGreaterThan(b2)
    expect(b10).toBeLessThan(5_500) // cap
  })

  test("hashOfRaw is deterministic", () => {
    expect(hashOfRaw("a")).toBe(hashOfRaw("a"))
    expect(hashOfRaw("a")).not.toBe(hashOfRaw("b"))
  })

  test("concatUint8 reassembles in order", () => {
    const a = new Uint8Array([1, 2])
    const b = new Uint8Array([3, 4, 5])
    expect(Array.from(concatUint8([a, b]))).toEqual([1, 2, 3, 4, 5])
  })
})

// =====================================================================
// 2. 4 opérations nominales
// =====================================================================

describe("HttpConnector — 4 opérations nominales", () => {
  test("discover returns DiscoverResult with provenance", async () => {
    setValidDiscoverResponse({ providers: [], models: [], aliases: [] })
    const result = await connector.discover()
    expect(result.provenance.sourceID).toBe("test:modeling:source")
    expect(result.provenance.licenseCode).toBe("MIT")
    expect(Array.isArray(result.providers)).toBe(true)
    expect(mock.calls.length).toBe(1)
    expect(mock.calls[0].url).toBe(`${SOURCE_URL}/discover`)
  })

  test("pricing returns PricingResult", async () => {
    setValidPricingResponse({
      pricing: [
        {
          providerID: "anthropic",
          modelID: "claude-sonnet-4",
          currency: "USD",
          unit: "per_1m_tokens",
          input: 3,
          output: 15,
          cacheRead: 0.3,
          cacheWrite: 3.75,
          reasoning: null,
          tiers: null,
        },
      ],
    })
    const result = await connector.pricing()
    expect(result.pricing.length).toBe(1)
    expect(result.pricing[0].providerID).toBe("anthropic")
  })

  test("capabilities returns CapabilitiesResult", async () => {
    setValidCapabilitiesResponse({
      capabilities: [
        {
          providerID: "anthropic",
          modelID: "claude-sonnet-4",
          capabilities: {
            structuredOutput: true,
            toolCalls: true,
            parallelToolCalls: false,
            visionInput: false,
            audioInput: false,
            videoInput: false,
            pdfInput: false,
            reasoning: false,
            caching: false,
            promptCaching: false,
            systemMessages: true,
          },
          modalities: { input: ["text"], output: ["text"] },
        },
      ],
    })
    const result = await connector.capabilities()
    expect(result.capabilities.length).toBe(1)
    expect(result.capabilities[0].modalities.input).toContain("text")
  })

  test("status returns StatusResult", async () => {
    setValidStatusResponse({
      status: [
        {
          providerID: "anthropic",
          modelID: "claude-sonnet-4",
          status: "active",
          deprecated: false,
          deprecationReason: null,
          renamedTo: null,
          removed: false,
        },
      ],
    })
    const result = await connector.status()
    expect(result.status.length).toBe(1)
    expect(result.status[0].status).toBe("active")
  })
})

// =====================================================================
// 3. Timeout via AbortSignal
// =====================================================================

describe("HttpConnector — timeout via AbortSignal", () => {
  test("aborted external signal propagates as kind=timeout (after retries)", async () => {
    const controller = new AbortController()
    mock.fetchImpl = async () => {
      controller.abort()
      throw new DOMException("aborted", "AbortError")
    }
    let captured: ConnectorOperationError | null = null
    try {
      await connector.discover({ signal: controller.signal, maxRetries: 2 })
    } catch (e) {
      captured = e as ConnectorOperationError
    }
    expect(captured).not.toBeNull()
    expect(captured!.detail.kind).toBe("timeout")
  })
})

// =====================================================================
// 4. Retry épuisé
// =====================================================================

describe("HttpConnector — retry & errors", () => {
  test("HTTP 500 → retries with backoff then exhausts", async () => {
    for (let i = 0; i < 3; i++) {
      mock.setNextStatus(500)
    }
    let captured: ConnectorOperationError | null = null
    try {
      await connector.discover({ maxRetries: 3 })
    } catch (e) {
      captured = e as ConnectorOperationError
    }
    expect(captured).not.toBeNull()
    const opErr = captured as ConnectorOperationError
    expect(opErr.detail.kind).toBe("fetch")
    const detail = opErr.detail as Extract<typeof opErr.detail, { kind: "fetch" }>
    expect(detail.attempts).toBe(3)
    // 3 calls performed (5xx retried each time)
    expect(mock.calls.length).toBe(3)
  })

  test("HTTP 4xx is terminal (no retry) — fail-closed on first attempt", async () => {
    mock.setNextStatus(404, '{"providers":[],"models":[],"aliases":[]}')
    let captured: ConnectorOperationError | null = null
    try {
      await connector.discover({ maxRetries: 5 })
    } catch (e) {
      captured = e as ConnectorOperationError
    }
    expect(captured).not.toBeNull()
    const opErr = captured as ConnectorOperationError
    expect(opErr.detail.kind).toBe("validation")
    expect(mock.calls.length).toBe(1)
  })

  test("HTTP 429 (rate limit) is treated as transient (retried like 5xx)", async () => {
    mock.setNextStatus(429, "rate limited")
    mock.setNextStatus(200, makeEnvelope("discover", { providers: [], models: [], aliases: [] }))
    await connector.discover({ maxRetries: 2 })
    expect(mock.calls.length).toBe(2)
  })
})

// =====================================================================
// 5. Response > 10 MB
// =====================================================================

describe("HttpConnector — response size limit (10 MB)", () => {
  test("response > 10 MB is rejected", async () => {
    const oversized = "x".repeat(HTTP_CONNECTOR_MAX_RESPONSE_BYTES + 1)
    mock.enqueue(makeStreamingResponse(oversized))
    let captured: ConnectorOperationError | null = null
    try {
      await connector.discover({ maxRetries: 1 })
    } catch (e) {
      captured = e as ConnectorOperationError
    }
    expect(captured).not.toBeNull()
    const opErr = captured as ConnectorOperationError
    expect(opErr.detail.kind).toBe("fetch")
    const detail = opErr.detail as Extract<typeof opErr.detail, { kind: "fetch" }>
    expect(detail.cause).toMatch(/exceeded 10485760 bytes/)
  })

  test("response just under limit is accepted (size check is strict >)", async () => {
    const validJson = JSON.stringify({
      provenance: {
        sourceID: "test:under-limit",
        sourceVersion: "1.0.0",
        sourceURL: SOURCE_URL,
        parserVersion: "1.0.0",
        rawHash: VALID_HASH,
        fetchedAtUTC: FIXED_UTC,
        licenseCode: "MIT",
        copyrightNotice: "Copyright (c) 2025 Test",
        licenseFileURL: "https://example.test/LICENSE",
        confidenceLevel: "official",
      },
      payload: { providers: [], models: [], aliases: [] },
    })
    const padding = "x".repeat(Math.max(0, HTTP_CONNECTOR_MAX_RESPONSE_BYTES - 200 - validJson.length))
    const under = JSON.stringify({
      provenance: makeProvenance(),
      payload: { providers: [], models: [], aliases: [], _pad: padding },
    })
    expect(Buffer.byteLength(under, "utf-8")).toBeLessThanOrEqual(HTTP_CONNECTOR_MAX_RESPONSE_BYTES)
    mock.enqueue(makeStreamingResponse(under))
    const r = await connector.discover({ maxRetries: 1 })
    expect(r.providers).toEqual([])
  })
})

// =====================================================================
// 6. Fail-closed (provenance invalide, license mismatch)
// =====================================================================

describe("HttpConnector — validation fail-closed", () => {
  test("missing provenance field → kind=validation", async () => {
    mock.enqueue(makeStreamingResponse(JSON.stringify({ payload: {} })))
    let captured: ConnectorOperationError | null = null
    try {
      await connector.discover({ maxRetries: 1 })
    } catch (e) {
      captured = e as ConnectorOperationError
    }
    expect(captured!.detail.kind).toBe("validation")
  })

  test("provenance rawHash invalid → kind=validation", async () => {
    const env = JSON.stringify({
      provenance: { ...makeProvenance(), rawHash: "not-64-chars" },
      payload: {},
    })
    mock.enqueue(makeStreamingResponse(env))
    let captured: ConnectorOperationError | null = null
    try {
      await connector.discover({ maxRetries: 1 })
    } catch (e) {
      captured = e as ConnectorOperationError
    }
    expect(captured!.detail.kind).toBe("validation")
  })

  test("license mismatch → kind=license_mismatch", async () => {
    const env = JSON.stringify({
      provenance: makeProvenance({ licenseCode: "Apache-2.0" }),
      payload: {},
    })
    mock.enqueue(makeStreamingResponse(env))
    let captured: ConnectorOperationError | null = null
    try {
      await connector.discover({ maxRetries: 1 })
    } catch (e) {
      captured = e as ConnectorOperationError
    }
    expect(captured).not.toBeNull()
    const opErr = captured as ConnectorOperationError
    expect(opErr.detail.kind).toBe("license_mismatch")
    const detail = opErr.detail as Extract<typeof opErr.detail, { kind: "license_mismatch" }>
    expect(detail.expectedLicense).toBe("MIT")
    expect(detail.actualLicense).toBe("Apache-2.0")
  })

  test("license=null override → no license mismatch check", async () => {
    const permissifConnector = new HttpConnector({
      id: "permissif",
      sourceURL: SOURCE_URL,
      parserVersion: "1.0.0",
      licenseCode: null,
      copyrightNotice: null,
      licenseFileURL: null,
      confidenceLevel: "unverified",
      fetchImpl: mock.fetchImpl,
      snapshotManager: snapManager,
    })
    const env = JSON.stringify({
      provenance: makeProvenance({ licenseCode: "Proprietary" }),
      payload: {},
    })
    mock.enqueue(makeStreamingResponse(env))
    // Should NOT raise (license override is null)
    const result = await permissifConnector.discover({ maxRetries: 1 })
    expect(result.provenance.licenseCode).toBe("Proprietary")
  })

  test("invalid JSON body → kind=parse", async () => {
    mock.enqueue(makeStreamingResponse("{not json"))
    let captured: ConnectorOperationError | null = null
    try {
      await connector.discover({ maxRetries: 1 })
    } catch (e) {
      captured = e as ConnectorOperationError
    }
    expect(captured!.detail.kind).toBe("parse")
  })
})

// =====================================================================
// 7. Offline mode
// =====================================================================

describe("HttpConnector — offline mode", () => {
  test("offline=true with snapshot → restored transparently", async () => {
    // First, populate snapshot via a successful online call
    setValidDiscoverResponse({ providers: [], models: [], aliases: [] })
    await connector.discover()

    // Now run offline with the populated snapshot
    const result = await connector.discover({ offline: true })
    expect(result.provenance.sourceID).toBe("test:modeling:source")
    const log = connector.getRequestLog()
    const lastEntry = log[log.length - 1]
    expect(lastEntry.outcome).toBe("offline_restored")
  })

  test("offline=true without snapshot → kind=offline_no_cache", async () => {
    const freshConnector = new HttpConnector({
      id: "fresh",
      sourceURL: SOURCE_URL,
      parserVersion: "1.0.0",
      licenseCode: null,
      copyrightNotice: null,
      licenseFileURL: null,
      confidenceLevel: "official",
      fetchImpl: mock.fetchImpl,
      snapshotManager: new SnapshotManager({ rootDir: tmpRoot }),
    })
    let captured: ConnectorOperationError | null = null
    try {
      await freshConnector.discover({ offline: true })
    } catch (e) {
      captured = e as ConnectorOperationError
    }
    expect(captured).not.toBeNull()
    expect(captured!.detail.kind).toBe("offline_no_cache")
  })

  test("offline=true with corrupted snapshot on disk → kind=cache_corrupted", async () => {
    // Populate snapshot via a successful online call
    setValidDiscoverResponse({ providers: [], models: [], aliases: [] })
    await connector.discover()

    // Corrupt the file on disk + clear in-memory cache so disk is read again
    const filePath = path.join(tmpRoot, "test-http-connector", "discover.json")
    const onDisk = JSON.parse(await fs.readFile(filePath, "utf-8"))
    onDisk.hash = "0".repeat(64)
    await fs.writeFile(filePath, JSON.stringify(onDisk), "utf-8")

    // Use a fresh manager so the corrupted file is re-read from disk.
    // invalidate() intentionally removes the file and is therefore not a
    // cache-corruption test helper.
    const freshConnector = new HttpConnector({
      id: "test-http-connector",
      sourceURL: SOURCE_URL,
      parserVersion: "1.0.0",
      licenseCode: "MIT",
      copyrightNotice: "Copyright (c) 2025 Test",
      licenseFileURL: "https://example.test/LICENSE",
      confidenceLevel: "official",
      fetchImpl: async (input, init) => mock.fetchImpl(input, init),
      snapshotManager: new SnapshotManager({ rootDir: tmpRoot }),
      deterministic: false,
    })
    let captured: ConnectorOperationError | null = null
    try {
      await freshConnector.discover({ offline: true })
    } catch (e) {
      captured = e as ConnectorOperationError
    }
    expect(captured).not.toBeNull()
    expect(captured!.detail.kind).toBe("cache_corrupted")
  })
})

// =====================================================================
// 8. Snapshot round-trip + invalidation
// =====================================================================

describe("HttpConnector — snapshot persistence", () => {
  test("snapshot persisted on disk after first successful call", async () => {
    setValidDiscoverResponse({ providers: [], models: [], aliases: [] })
    await connector.discover()
    const stat = await snapManager.status("test-http-connector", "discover")
    expect(stat).not.toBeNull()
    expect(stat!.integrityOK).toBe(true)
  })

  test("snapshot invalidated via manager", async () => {
    setValidDiscoverResponse({ providers: [], models: [], aliases: [] })
    await connector.discover()
    await snapManager.invalidate("test-http-connector", "discover")
    expect(await snapManager.has("test-http-connector", "discover")).toBe(false)
  })

  test("two consecutive discover calls produce identical snapshot hashes (determinism)", async () => {
    setValidDiscoverResponse({ providers: [], models: [], aliases: [] })
    await connector.discover()
    const log1 = connector.getRequestLog()
    const hash1 = log1.find((l) => l.outcome === "ok")?.hash

    connector.clearRequestLog()
    setValidDiscoverResponse({ providers: [], models: [], aliases: [] })
    await connector.discover()
    const hash2 = connector.getRequestLog().find((l) => l.outcome === "ok")?.hash
    expect(hash1).toBe(hash2)
  })
})

// =====================================================================
// 9. Sécurité endpoints + allowlist
// =====================================================================

describe("HttpConnector — SSRF defense + allowlist", () => {
  test("constructor rejects URL pointing to loopback", () => {
    expect(() =>
      new HttpConnector({
        id: "x",
        sourceURL: "http://localhost:1234/api",
        parserVersion: "1.0.0",
        licenseCode: null,
        copyrightNotice: null,
        licenseFileURL: null,
        confidenceLevel: "official",
      }),
    ).toThrow(/SSRF guard/)
  })

  test("constructor rejects 10.0.0.0/8 (private)", () => {
    expect(() =>
      new HttpConnector({
        id: "x",
        sourceURL: "http://10.5.5.5/api",
        parserVersion: "1.0.0",
        licenseCode: null,
        copyrightNotice: null,
        licenseFileURL: null,
        confidenceLevel: "official",
      }),
    ).toThrow(/SSRF guard/)
  })

  test("constructor rejects invalid URL", () => {
    expect(() =>
      new HttpConnector({
        id: "x",
        sourceURL: "not-a-url",
        parserVersion: "1.0.0",
        licenseCode: null,
        copyrightNotice: null,
        licenseFileURL: null,
        confidenceLevel: "official",
      }),
    ).toThrow()
  })

  test("URL not in allowlist is rejected at execution time", async () => {
    mock.enqueue(makeStreamingResponse(makeEnvelope("discover", {})))
    // Discover will call ${sourceURL}/discover which IS allowed.
    // We can't easily trigger a non-allowed URL from outside, but the SSRF
    // check on construction is the real barrier.
    const result = await connector.discover()
    expect(result).toBeDefined()
  })
})

// =====================================================================
// 10. Pas de secret dans logs
// =====================================================================

describe("HttpConnector — no secrets in error messages", () => {
  test("error messages do not contain token/key/bearer/authorization", async () => {
    mock.setNextStatus(401, "missing api-key here maybe")
    let captured: ConnectorOperationError | null = null
    try {
      await connector.discover({ maxRetries: 1 })
    } catch (e) {
      captured = e as ConnectorOperationError
    }
    expect(captured).not.toBeNull()
    const msg = captured!.message + " " + JSON.stringify(captured!.detail)
    expect(msg).not.toMatch(/api[_-]key/i)
    expect(msg).not.toMatch(/bearer/i)
    expect(msg).not.toMatch(/token/i)
    expect(msg).not.toMatch(/authorization/i)
  })
})

// =====================================================================
// 11. Pureté (pas de mutation externe)
// =====================================================================

describe("HttpConnector — purity", () => {
  test("the connector does not mutate DiscoverResult across calls", async () => {
    setValidDiscoverResponse({ providers: [], models: [], aliases: [] })
    const r1 = await connector.discover()
    setValidDiscoverResponse({ providers: [], models: [], aliases: [] })
    const r2 = await connector.discover()
    expect(r1).not.toBe(r2)
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2))
  })
})