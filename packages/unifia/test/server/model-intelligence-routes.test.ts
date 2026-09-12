import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { defaultStorage } from "../../src/model-intelligence/registry"
import { SCHEMA_VERSION, GENERATOR_VERSION } from "../../src/model-intelligence/schema-version"
import { Registry as RegistrySchema, type Registry } from "../../src/model-intelligence/schema"
import { generateSyntheticModels } from "../model-intelligence/synthetic-generator"

// HTTP contract coverage for the model-intelligence routes (TEAM-L02).
//
// The registry is seeded into `defaultStorage` before the first request:
// LiveRegistryLayer reads it when the layer is first built, and makeRuntime
// memoises that layer, so seeding afterwards would be seeding a registry
// nobody reads.

const PASSWORD = "mi-routes-test-pw"
const AUTH = "Basic " + Buffer.from("opencode:" + PASSWORD).toString("base64")
const MODEL_COUNT = 500

let server: InProcessServer

function buildRegistry(): Registry {
  const models = generateSyntheticModels({ count: MODEL_COUNT })
  const providerIDs = [...new Set(models.map((model) => model.providerID))]
  const registry: Registry = {
    schemaVersion: SCHEMA_VERSION,
    generatedAtUTC: "2026-07-28T00:00:00Z",
    generatorVersion: GENERATOR_VERSION,
    registryID: "b".repeat(64),
    sources: [],
    providers: providerIDs.map((id) => ({
      id,
      name: id,
      sdk: `@ai-sdk/${id}`,
      api: { baseURL: `https://api.${id}.test` },
      envVars: [`${id.toUpperCase()}_API_KEY`],
      capabilities: {
        tools: true,
        structuredOutput: true,
        streaming: true,
        visionInput: false,
        audioIO: false,
        videoIO: false,
        pdfInput: false,
        functionCallingStrict: false,
        systemPrompts: true,
      },
      modalitiesSupported: { input: ["text"], output: ["text"] },
      status: "active",
      deprecationReason: null,
      addedAtUTC: "2026-07-21T00:00:00Z",
      removedAtUTC: null,
      docsURL: null,
      privacyPolicyRef: null,
      regionPolicy: { allowedRegions: [], dataResidencyRequired: false },
      aliases: [],
    })),
    models,
    aliases: [],
    health: {
      snapshotAtUTC: "2026-07-28T00:00:00Z",
      totalProviders: providerIDs.length,
      totalModels: models.length,
      activeModels: models.filter((model) => model.status === "active").length,
      deprecatedModels: models.filter((model) => model.status === "deprecated").length,
      missingPricingModels: 0,
      aliasesResolved: 0,
    },
    provenance: [],
  }
  // Parsing the fixture is not ceremony: a fixture that does not satisfy the
  // schema would make every assertion below meaningless.
  return RegistrySchema.parse(registry)
}

beforeAll(async () => {
  await defaultStorage.save(buildRegistry())
  server = await withInProcessServer({ password: PASSWORD })
})

afterAll(async () => {
  await server.close()
})

function get(route: string) {
  const sep = route.includes("?") ? "&" : "?"
  return server.fetch(`${route}${sep}directory=${encodeURIComponent(process.cwd())}`, {
    headers: { Authorization: AUTH },
  })
}

describe("GET /model-intelligence/models — success and versioning", () => {
  test("returns a versioned, bounded page rather than the whole registry", async () => {
    const response = await get("/model-intelligence/models")
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.schemaVersion).toBe(SCHEMA_VERSION)
    expect(body.total).toBe(MODEL_COUNT)
    expect(body.items).toHaveLength(100)
    expect(body.nextCursor).toBe("100")
  })

  test("walks the whole registry across pages with no gap and no repeat", async () => {
    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0

    for (;;) {
      const route: string =
        cursor === null ? "/model-intelligence/models?limit=120" : `/model-intelligence/models?limit=120&cursor=${cursor}`
      const body: { items: { id: string; providerID: string }[]; nextCursor: string | null } = await (
        await get(route)
      ).json()
      seen.push(...body.items.map((model) => `${model.providerID}/${model.id}`))
      pages++
      if (body.nextCursor === null) break
      cursor = body.nextCursor
      if (pages > 100) throw new Error("pagination did not terminate")
    }

    expect(seen).toHaveLength(MODEL_COUNT)
    expect(new Set(seen).size).toBe(MODEL_COUNT)
  })

  test("filters by provider", async () => {
    const providerID = (await (await get("/model-intelligence/models?limit=1")).json()).items[0].providerID
    const body = await (await get(`/model-intelligence/models?providerID=${providerID}&limit=500`)).json()

    expect(body.items.length).toBeGreaterThan(0)
    expect(body.items.every((model: { providerID: string }) => model.providerID === providerID)).toBe(true)
  })

  test("filters by a status the registry schema actually declares", async () => {
    // The allowed set is read off the schema, so this passing means the route
    // and the registry agree on the vocabulary rather than on a copy of it.
    const response = await get("/model-intelligence/models?status=active&limit=500")
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.items.every((model: { status: string }) => model.status === "active")).toBe(true)
  })

  test("lists providers", async () => {
    const body = await (await get("/model-intelligence/providers?limit=500")).json()

    expect(body.total).toBeGreaterThan(0)
    expect(body.items[0]).toHaveProperty("id")
  })

  test("fetches one model, and 404s on one that does not exist", async () => {
    const first = (await (await get("/model-intelligence/models?limit=1")).json()).items[0]

    const found = await get(`/model-intelligence/models/${first.providerID}/${first.id}`)
    expect(found.status).toBe(200)
    expect((await found.json()).model.id).toBe(first.id)

    const missing = await get("/model-intelligence/models/nope/nope")
    expect(missing.status).toBe(404)
  })

  test("reports the snapshot identity without shipping the snapshot", async () => {
    // The body is megabytes and every consumer that wants rows wants them
    // filtered; the hash is what lets a client skip the fetch entirely.
    const body = await (await get("/model-intelligence/snapshot")).json()

    expect(body.schemaVersion).toBe(SCHEMA_VERSION)
    expect(body.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(body.byteLength).toBeGreaterThan(0)
    expect(body).not.toHaveProperty("json")
  })

  test("health always answers 200 so a client can poll it", async () => {
    const response = await get("/model-intelligence/health")

    expect(response.status).toBe(200)
    expect((await response.json()).loaded).toBe(true)
  })
})

describe("model-intelligence routes — unknown data is rejected, not ignored", () => {
  test("an unknown query parameter is 400", async () => {
    const response = await get("/model-intelligence/models?provider=anthropic")

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain("provider")
  })

  test("a misspelled status is 400, not a silent full listing", async () => {
    // Dropping the filter returns every model and the caller reads it as
    // "they all have that status" — the opposite of what was asked.
    const response = await get("/model-intelligence/models?status=activ")

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain("activ")
  })

  test("a status valid for models but not for providers is 400 on /providers", async () => {
    // The two enums differ: "quarantined" is a model status only.
    const response = await get("/model-intelligence/providers?status=quarantined")

    expect(response.status).toBe(400)
  })

  test("an unknown modality is 400", async () => {
    expect((await get("/model-intelligence/models?modality=telepathy")).status).toBe(400)
  })

  test("an out-of-range limit or cursor is 400", async () => {
    for (const query of ["limit=0", "limit=-3", "limit=1.5", "limit=99999", "limit=abc", "cursor=-1", "cursor=abc"]) {
      expect((await get(`/model-intelligence/models?${query}`)).status).toBe(400)
    }
  })

  test("an unknown alias is 404", async () => {
    expect((await get("/model-intelligence/aliases/not-an-alias")).status).toBe(404)
  })
})
