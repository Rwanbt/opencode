/**
 * Tests for `KeychainStorage` (src/auth/index.ts) wiring against the in-process
 * mock keychain server (test/lib/mock-keychain-server.ts).
 *
 * Coverage:
 *   - constructor reads env vars at instantiation time (OPENCODE_KEYCHAIN_URL / TOKEN).
 *   - available() returns true when both env vars are set.
 *   - load()/save() round-trip through the HTTP protocol.
 *   - set()/get() single-entry round-trip used by the migration path.
 *   - save() deletes entries present remotely but missing in the next snapshot.
 *   - load() surfaces a transport error when the server is killed mid-test.
 *
 * We deliberately test the class directly, not the full `Auth.layer`, because
 * `Auth.layer` bakes its backend selection at runtime-init (Layer.effect)
 * against the module-level `AUTH_STORAGE_BACKEND` constant. Flipping that
 * mid-process would require re-building the ManagedRuntime, which is outside
 * the surface we want to touch here.
 */
import { test, expect, beforeEach, afterEach } from "bun:test"
import { KeychainStorage } from "../../src/auth"
import { startMockKeychainServer, type MockKeychainServer } from "../lib/mock-keychain-server"

let server: MockKeychainServer | undefined
const SAVED: Record<string, string | undefined> = {}

function setEnv(k: string, v: string | undefined) {
  SAVED[k] = process.env[k]
  if (v === undefined) delete process.env[k]
  else process.env[k] = v
}

beforeEach(async () => {
  server = await startMockKeychainServer()
  setEnv("OPENCODE_KEYCHAIN_URL", server.url)
  setEnv("OPENCODE_KEYCHAIN_TOKEN", server.token)
})

afterEach(async () => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  for (const k of Object.keys(SAVED)) delete SAVED[k]
  if (server) {
    await server.close()
    server = undefined
  }
})

test("available() reports true when env vars are set", () => {
  const kc = new KeychainStorage()
  expect(kc.available()).toBe(true)
})

test("available() reports false when env vars are missing", () => {
  setEnv("OPENCODE_KEYCHAIN_URL", undefined)
  setEnv("OPENCODE_KEYCHAIN_TOKEN", undefined)
  const kc = new KeychainStorage()
  expect(kc.available()).toBe(false)
})

test("set/get single-entry round-trip", async () => {
  const kc = new KeychainStorage()
  await kc.set("anthropic", { type: "api", key: "sk-test-1" })
  const got = await kc.get("anthropic")
  expect(got).toEqual({ type: "api", key: "sk-test-1" })
})

test("get returns undefined for unknown key (404)", async () => {
  const kc = new KeychainStorage()
  const got = await kc.get("unknown-provider")
  expect(got).toBeUndefined()
})

test("save/load multi-entry round-trip preserves all values", async () => {
  const kc = new KeychainStorage()
  const payload = {
    anthropic: { type: "api", key: "sk-anth" },
    openai: { type: "api", key: "sk-oai" },
    "https://example.com": { type: "wellknown", key: "X-API-Key", token: "tok" },
  }
  await kc.save(payload)
  const loaded = await kc.load()
  expect(loaded).toEqual(payload)
})

test("save() removes keys absent from the new snapshot", async () => {
  const kc = new KeychainStorage()
  await kc.save({
    anthropic: { type: "api", key: "sk-a" },
    openai: { type: "api", key: "sk-b" },
  })
  // Drop `openai` in the next save.
  await kc.save({
    anthropic: { type: "api", key: "sk-a" },
  })
  const loaded = await kc.load()
  expect(Object.keys(loaded).sort()).toEqual(["anthropic"])
})

test("load throws when the server is unreachable (transport error)", async () => {
  const kc = new KeychainStorage()
  await kc.save({ x: { type: "api", key: "v" } })
  // Hard-kill the mock server; subsequent HTTP calls must raise.
  await server!.kill()
  server = undefined
  await expect(kc.load()).rejects.toThrow()
})

test("load throws with a clear message when env vars are missing", async () => {
  setEnv("OPENCODE_KEYCHAIN_URL", undefined)
  setEnv("OPENCODE_KEYCHAIN_TOKEN", undefined)
  const kc = new KeychainStorage()
  await expect(kc.load()).rejects.toThrow(/KeychainStorage unavailable/)
})

test("rejects requests with a bad token", async () => {
  setEnv("OPENCODE_KEYCHAIN_TOKEN", "wrong-token")
  const kc = new KeychainStorage()
  await expect(kc.load()).rejects.toThrow(/keychain list failed|401/)
})
