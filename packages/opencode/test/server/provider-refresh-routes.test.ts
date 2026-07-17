// HTTP-level coverage for POST /provider/refresh (server/routes/provider.ts).
// The route is a thin pass-through: it must call ModelsDev.refresh(true) and
// return its result verbatim as the JSON body with a 200 status (the result's
// own `ok` field carries success/failure, not the HTTP status). The detailed
// behavior of refresh() itself (flag gates, invalid-JSON regression, lock
// contention, callback awaiting) is covered by test/provider/models-refresh.test.ts —
// this file only asserts the route wiring.
import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Flag } from "../../src/flag/flag"
import { Global } from "../../src/global"
import { ProviderRoutes } from "../../src/server/routes/provider"

const originalModelsPath = Flag.OPENCODE_MODELS_PATH
const originalFetch = globalThis.fetch
const cacheFilepath = path.join(Global.Path.cache, "models.json")

function setModelsPath(value: string | undefined) {
  // @ts-expect-error intentional test-only override of a Flag namespace member, restored in afterEach
  Flag.OPENCODE_MODELS_PATH = value
}

afterEach(async () => {
  setModelsPath(originalModelsPath)
  globalThis.fetch = originalFetch
  await fs.rm(cacheFilepath, { force: true })
})

describe("POST /provider/refresh", () => {
  test("propagates a failure result from ModelsDev.refresh() as 200 with ok:false", async () => {
    // Default test env: OPENCODE_MODELS_PATH is set by test/preload.ts, so
    // refresh() short-circuits with an explicit "managed externally" error.
    const app = ProviderRoutes()
    const response = await app.request("/refresh", { method: "POST" })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; error?: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain("OPENCODE_MODELS_PATH")
  })

  test("propagates a success result from ModelsDev.refresh() as 200 with ok:true", async () => {
    setModelsPath(undefined)
    const payload = JSON.stringify({ anthropic: { id: "anthropic", name: "Anthropic (route test)", env: [], models: {} } })
    globalThis.fetch = (async () => new Response(payload, { status: 200 })) as unknown as typeof fetch

    const app = ProviderRoutes()
    const response = await app.request("/refresh", { method: "POST" })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; error?: string }
    expect(body.ok).toBe(true)
    expect(body.error).toBeUndefined()
  })
})
