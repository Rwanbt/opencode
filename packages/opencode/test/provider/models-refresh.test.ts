// Regression coverage for ModelsDev.refresh() (packages/opencode/src/provider/models.ts).
//
// Context: the models.dev catalog can lag behind reality for a given provider.
// A manual "refresh" button was added, which surfaced 4 pre-existing bugs in
// refresh() that had to be fixed first (see models.ts for the fix commentary):
//   1. refresh() swallowed all errors and returned nothing exploitable.
//   2. A corrupted/truncated fetch body could silently overwrite a good cache.
//   3. OPENCODE_MODELS_PATH (externally-managed catalog) was ignored by refresh().
//   4. OPENCODE_DISABLE_MODELS_FETCH was ignored by refresh() (only gated the
//      background timer, not a direct call).
//
// Testing note: `Flag.OPENCODE_MODELS_PATH` is set globally by test/preload.ts
// (to test/tool/fixtures/models-api.json) so that ModelsDev.get() has a stable
// fixture across the whole suite. Flag namespace members are plain mutable
// object properties (not getters), so tests can safely override them for the
// duration of a single test and restore them afterwards — this is the same
// pattern already used in test/sync/index.test.ts for
// Flag.OPENCODE_EXPERIMENTAL_WORKSPACES.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Flag } from "../../src/flag/flag"
import { Global } from "../../src/global"
import { Flock } from "../../src/util/flock"
import { ModelsDev } from "../../src/provider/models"

const originalModelsPath = Flag.OPENCODE_MODELS_PATH
const originalDisableFetch = Flag.OPENCODE_DISABLE_MODELS_FETCH
const originalFetch = globalThis.fetch

// Mirrors the private `filepath` computation in models.ts. OPENCODE_MODELS_URL
// is never set in the test env, so `source === "https://models.dev"` and the
// cache file is always `<cache>/models.json`. Not exported from models.ts on
// purpose (no test-only surface added to the production module) — duplicated
// here deliberately, see file header.
const cacheFilepath = path.join(Global.Path.cache, "models.json")
const lockKey = `models-dev:${cacheFilepath}`

function setModelsPath(value: string | undefined) {
  // @ts-expect-error intentional test-only override of a Flag namespace member, restored in afterEach
  Flag.OPENCODE_MODELS_PATH = value
}

function setDisableFetch(value: boolean) {
  // @ts-expect-error intentional test-only override of a Flag namespace member, restored in afterEach
  Flag.OPENCODE_DISABLE_MODELS_FETCH = value
}

function mockFetchOnce(handler: () => Response | Promise<Response>) {
  globalThis.fetch = (async () => handler()) as unknown as typeof fetch
}

async function removeCacheFile() {
  await fs.rm(cacheFilepath, { force: true })
}

beforeEach(async () => {
  await removeCacheFile()
})

afterEach(async () => {
  setModelsPath(originalModelsPath)
  setDisableFetch(originalDisableFetch)
  globalThis.fetch = originalFetch
  await removeCacheFile()
})

describe("ModelsDev.refresh() — flag gates", () => {
  test("OPENCODE_MODELS_PATH set → no-op with explicit error, no fetch performed", async () => {
    setModelsPath("/some/externally-managed/models.json")
    let fetchCalled = false
    mockFetchOnce(() => {
      fetchCalled = true
      return new Response("{}", { status: 200 })
    })

    const result = await ModelsDev.refresh(true)

    expect(result.ok).toBe(false)
    expect(result.error).toContain("OPENCODE_MODELS_PATH")
    expect(fetchCalled).toBe(false)
  })

  test("OPENCODE_DISABLE_MODELS_FETCH set → no-op with explicit error, no fetch performed", async () => {
    setModelsPath(undefined)
    setDisableFetch(true)
    let fetchCalled = false
    mockFetchOnce(() => {
      fetchCalled = true
      return new Response("{}", { status: 200 })
    })

    const result = await ModelsDev.refresh(true)

    expect(result.ok).toBe(false)
    expect(result.error).toContain("OPENCODE_DISABLE_MODELS_FETCH")
    expect(fetchCalled).toBe(false)
  })
})

describe("ModelsDev.refresh() — fetch outcomes", () => {
  beforeEach(() => {
    setModelsPath(undefined)
    setDisableFetch(false)
  })

  test("HTTP non-OK response → ok:false with the status code in the message", async () => {
    mockFetchOnce(() => new Response("server error", { status: 503 }))

    const result = await ModelsDev.refresh(true)

    expect(result.ok).toBe(false)
    expect(result.error).toContain("503")
  })

  test("invalid JSON body does NOT overwrite an existing valid cache (critical regression)", async () => {
    const sentinel = JSON.stringify({ anthropic: { id: "anthropic", name: "Anthropic (sentinel)", env: [], models: {} } })
    await fs.mkdir(path.dirname(cacheFilepath), { recursive: true })
    await fs.writeFile(cacheFilepath, sentinel, "utf-8")

    mockFetchOnce(() => new Response("<html>not json</html>", { status: 200 }))

    const result = await ModelsDev.refresh(true)

    expect(result.ok).toBe(false)
    expect(result.error).toContain("Invalid response")

    const onDisk = await fs.readFile(cacheFilepath, "utf-8")
    expect(onDisk).toBe(sentinel)
  })

  test("successful fetch → ok:true, cache file written, onRefresh callbacks awaited before resolving", async () => {
    const payload = JSON.stringify({ anthropic: { id: "anthropic", name: "Anthropic (fresh)", env: [], models: {} } })
    mockFetchOnce(() => new Response(payload, { status: 200 }))

    let callbackSettled = false
    const unsubscribe = ModelsDev.onRefresh(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      callbackSettled = true
    })

    try {
      const result = await ModelsDev.refresh(true)

      expect(result.ok).toBe(true)
      // Bug #2 regression: refresh() must await onRefresh callbacks before
      // resolving, not fire-and-forget them.
      expect(callbackSettled).toBe(true)

      const onDisk = await fs.readFile(cacheFilepath, "utf-8")
      expect(onDisk).toBe(payload)
    } finally {
      unsubscribe()
    }
  })

  test("fetch rejecting inside the lock propagates as ok:false instead of being silently swallowed", async () => {
    globalThis.fetch = (async () => {
      throw new Error("simulated network failure")
    }) as unknown as typeof fetch

    const result = await ModelsDev.refresh(true)

    expect(result.ok).toBe(false)
    expect(result.error).toContain("simulated network failure")
  })
})

describe("ModelsDev.refresh() — lock contention", () => {
  beforeEach(() => {
    setModelsPath(undefined)
    setDisableFetch(false)
  })

  test("a concurrent holder of the same Flock lock blocks refresh() until released, then it completes normally", async () => {
    const payload = JSON.stringify({ anthropic: { id: "anthropic", name: "Anthropic (after contention)", env: [], models: {} } })
    mockFetchOnce(() => new Response(payload, { status: 200 }))

    // Not `await using`: we release manually below, and letting the implicit
    // asyncDispose call release() a second time would throw ("lock is
    // compromised") since the lock dir is already gone by then.
    const held = await Flock.acquire(lockKey)

    const refreshPromise = ModelsDev.refresh(true)

    const stillPending = await Promise.race([
      refreshPromise.then(() => "resolved" as const),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 300)),
    ])
    expect(stillPending).toBe("pending")

    await held.release()

    const result = await refreshPromise
    expect(result.ok).toBe(true)
  })
})
