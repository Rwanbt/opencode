/**
 * Tests for src/github/auth.ts — session storage + Device Flow orchestration.
 *
 * Storage is exercised against the `file` backend (test/preload.ts already
 * isolates Global.Path.data via XDG_DATA_HOME, so this never touches the
 * real user's data dir). Device Flow HTTP calls are exercised by stubbing
 * `globalThis.fetch` — no real network access to github.com.
 */
import { afterEach, beforeEach, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "../../src/global"

const file = path.join(Global.Path.data, "github-auth.json")
const encryptedFile = path.join(Global.Path.data, "github-auth.enc.json")

let realFetch: typeof fetch
let savedClient: string | undefined
let savedBackend: string | undefined

beforeEach(async () => {
  realFetch = globalThis.fetch
  savedClient = process.env.OPENCODE_CLIENT
  savedBackend = process.env.OPENCODE_AUTH_STORAGE
  delete process.env.OPENCODE_CLIENT
  process.env.OPENCODE_AUTH_STORAGE = "file"
  await fs.rm(file, { force: true })
  await fs.rm(encryptedFile, { force: true })
})

afterEach(async () => {
  globalThis.fetch = realFetch
  if (savedClient === undefined) delete process.env.OPENCODE_CLIENT
  else process.env.OPENCODE_CLIENT = savedClient
  if (savedBackend === undefined) delete process.env.OPENCODE_AUTH_STORAGE
  else process.env.OPENCODE_AUTH_STORAGE = savedBackend
  await fs.rm(file, { force: true })
  await fs.rm(encryptedFile, { force: true })
})

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString()
    return handler(url, init)
  }) as typeof fetch
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })
}

test("getIdentity returns undefined when never connected", async () => {
  const GithubAuth = await import("../../src/github/auth")
  expect(await GithubAuth.getIdentity()).toBeUndefined()
  expect(await GithubAuth.getAccessToken()).toBeUndefined()
})

test("full device flow: start -> pending -> success persists session, never leaks token via getIdentity", async () => {
  let pollCount = 0
  stubFetch((url) => {
    if (url === "https://github.com/login/device/code") {
      return json({
        device_code: "dc-1",
        user_code: "ABCD-EFGH",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      })
    }
    if (url === "https://github.com/login/oauth/access_token") {
      pollCount++
      if (pollCount === 1) return json({ error: "authorization_pending" })
      return json({ access_token: "gho_secret_token_value", token_type: "bearer", scope: "repo" })
    }
    if (url === "https://api.github.com/user") {
      return json(
        { login: "octocat", name: "The Octocat", avatar_url: "https://avatars/octo.png", html_url: "https://github.com/octocat" },
        200,
        { "x-oauth-scopes": "repo" },
      )
    }
    throw new Error(`unexpected fetch: ${url}`)
  })

  const GithubAuth = await import("../../src/github/auth")
  const auth = await GithubAuth.startDeviceFlow()
  expect(auth.userCode).toBe("ABCD-EFGH")

  expect(await GithubAuth.pollDeviceFlow()).toEqual({ status: "pending" })
  const result = await GithubAuth.pollDeviceFlow()
  expect(result).toEqual({
    status: "success",
    identity: { login: "octocat", name: "The Octocat", avatarUrl: "https://avatars/octo.png", profileUrl: "https://github.com/octocat" },
  })

  const identity = await GithubAuth.getIdentity()
  expect(identity).toEqual({ login: "octocat", name: "The Octocat", avatarUrl: "https://avatars/octo.png", profileUrl: "https://github.com/octocat" })
  // The raw token must never appear on the identity object returned to routes/UI.
  expect(JSON.stringify(identity)).not.toContain("gho_secret_token_value")

  // But it IS retrievable internally for the git credential bridge.
  expect(await GithubAuth.getAccessToken()).toBe("gho_secret_token_value")

  await GithubAuth.disconnect()
  expect(await GithubAuth.getIdentity()).toBeUndefined()
})

test("slow_down increases the poll interval and is reflected in the next poll result", async () => {
  stubFetch((url) => {
    if (url === "https://github.com/login/device/code") {
      return json({ device_code: "dc-2", user_code: "SLOW-DOWN", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 })
    }
    if (url === "https://github.com/login/oauth/access_token") return json({ error: "slow_down" })
    throw new Error(`unexpected fetch: ${url}`)
  })

  const GithubAuth = await import("../../src/github/auth")
  await GithubAuth.startDeviceFlow()
  const result = await GithubAuth.pollDeviceFlow()
  expect(result.status).toBe("slow_down")
  if (result.status === "slow_down") expect(result.nextIntervalSeconds).toBeGreaterThan(5)
})

test("expired_token clears pending state and reports expired", async () => {
  stubFetch((url) => {
    if (url === "https://github.com/login/device/code") {
      return json({ device_code: "dc-3", user_code: "EXPIRE-ME", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 })
    }
    if (url === "https://github.com/login/oauth/access_token") return json({ error: "expired_token" })
    throw new Error(`unexpected fetch: ${url}`)
  })

  const GithubAuth = await import("../../src/github/auth")
  await GithubAuth.startDeviceFlow()
  expect(await GithubAuth.pollDeviceFlow()).toEqual({ status: "expired" })
  // Pending flow was cleared — polling again with no active flow reports so.
  expect(await GithubAuth.pollDeviceFlow()).toEqual({ status: "no_pending_flow" })
})

test("access_denied is reported and clears pending state", async () => {
  stubFetch((url) => {
    if (url === "https://github.com/login/device/code") {
      return json({ device_code: "dc-4", user_code: "DENY-ME", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 })
    }
    if (url === "https://github.com/login/oauth/access_token") return json({ error: "access_denied" })
    throw new Error(`unexpected fetch: ${url}`)
  })

  const GithubAuth = await import("../../src/github/auth")
  await GithubAuth.startDeviceFlow()
  expect(await GithubAuth.pollDeviceFlow()).toEqual({ status: "denied" })
})

test("cancelDeviceFlow makes subsequent polls report no_pending_flow", async () => {
  stubFetch((url) => {
    if (url === "https://github.com/login/device/code") {
      return json({ device_code: "dc-5", user_code: "CANCEL-ME", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })

  const GithubAuth = await import("../../src/github/auth")
  await GithubAuth.startDeviceFlow()
  GithubAuth.cancelDeviceFlow()
  expect(await GithubAuth.pollDeviceFlow()).toEqual({ status: "no_pending_flow" })
})

test("session persists across module state via the file backend (survives a fresh read)", async () => {
  stubFetch((url) => {
    if (url === "https://github.com/login/device/code") {
      return json({ device_code: "dc-6", user_code: "PERSIST", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 })
    }
    if (url === "https://github.com/login/oauth/access_token") return json({ access_token: "gho_persisted", token_type: "bearer", scope: "repo" })
    if (url === "https://api.github.com/user") {
      return json({ login: "persisted-user", html_url: "https://github.com/persisted-user" }, 200, { "x-oauth-scopes": "repo" })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })

  const GithubAuth = await import("../../src/github/auth")
  await GithubAuth.startDeviceFlow()
  await GithubAuth.pollDeviceFlow()

  const raw = JSON.parse(await fs.readFile(file, "utf8"))
  expect(raw.login).toBe("persisted-user")
  expect(raw.accessToken).toBe("gho_persisted")
})
