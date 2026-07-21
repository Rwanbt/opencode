/**
 * Tests for src/github/credentials.ts — the git push/pull bridge.
 *
 * Verifies the host allowlist (the load-bearing safety property: a GitHub
 * session must never leak its token to a non-github.com remote) and the
 * scoped `http.<url>.extraheader` injection when it IS github.com.
 */
import { afterEach, beforeEach, expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const execFileAsync = promisify(execFile)

let repoDir: string
let realFetch: typeof fetch
let savedBackend: string | undefined

beforeEach(async () => {
  repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "oc-github-cred-"))
  await execFileAsync("git", ["init", "-q"], { cwd: repoDir })
  realFetch = globalThis.fetch
  savedBackend = process.env.OPENCODE_AUTH_STORAGE
  process.env.OPENCODE_AUTH_STORAGE = "file"
})

afterEach(async () => {
  globalThis.fetch = realFetch
  if (savedBackend === undefined) delete process.env.OPENCODE_AUTH_STORAGE
  else process.env.OPENCODE_AUTH_STORAGE = savedBackend
  await fs.rm(repoDir, { recursive: true, force: true })
  const { Global } = await import("../../src/global")
  await fs.rm(path.join(Global.Path.data, "github-auth.json"), { force: true })
})

async function connectFakeSession(token: string) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString()
    if (url === "https://github.com/login/device/code") {
      return new Response(
        JSON.stringify({ device_code: "d", user_code: "U", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 1 }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }
    if (url === "https://github.com/login/oauth/access_token") {
      return new Response(JSON.stringify({ access_token: token, token_type: "bearer", scope: "repo" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    if (url === "https://api.github.com/user") {
      return new Response(JSON.stringify({ login: "u", html_url: "https://github.com/u" }), {
        status: 200,
        headers: { "content-type": "application/json", "x-oauth-scopes": "repo" },
      })
    }
    throw new Error(`unexpected fetch: ${url}`)
  }) as typeof fetch

  const GithubAuth = await import("../../src/github/auth")
  await GithubAuth.startDeviceFlow()
  await GithubAuth.pollDeviceFlow()
}

test("returns {} when the remote is not github.com, even with a connected session", async () => {
  await connectFakeSession("gho_should_not_leak")
  await execFileAsync("git", ["remote", "add", "origin", "https://gitlab.com/foo/bar.git"], { cwd: repoDir })

  const { buildGithubAuthEnv } = await import("../../src/github/credentials")
  const { env } = await buildGithubAuthEnv(repoDir, "origin")
  expect(env).toEqual({})
})

test("returns {} for a github.com remote when no session is connected", async () => {
  await execFileAsync("git", ["remote", "add", "origin", "https://github.com/foo/bar.git"], { cwd: repoDir })

  const { buildGithubAuthEnv } = await import("../../src/github/credentials")
  const { env } = await buildGithubAuthEnv(repoDir, "origin")
  expect(env).toEqual({})
})

test("injects a github.com-scoped extraheader when connected and the remote is github.com", async () => {
  await connectFakeSession("gho_test_token_123")
  await execFileAsync("git", ["remote", "add", "origin", "https://github.com/foo/bar.git"], { cwd: repoDir })

  const { buildGithubAuthEnv } = await import("../../src/github/credentials")
  const { env } = await buildGithubAuthEnv(repoDir, "origin")

  expect(env["GIT_CONFIG_KEY_1"]).toBe("http.https://github.com/.extraheader")
  const expectedBasic = Buffer.from("x-access-token:gho_test_token_123").toString("base64")
  expect(env["GIT_CONFIG_VALUE_1"]).toBe(`Authorization: Basic ${expectedBasic}`)
  // Manual credential.helper is disabled for this scoped injection to avoid
  // a conflicting prompt from a system-configured helper (e.g. Windows GCM).
  expect(env["GIT_CONFIG_KEY_0"]).toBe("credential.helper")
  expect(env["GIT_CONFIG_VALUE_0"]).toBe("")
})

test("returns {} when the remote does not exist", async () => {
  const { buildGithubAuthEnv } = await import("../../src/github/credentials")
  const { env } = await buildGithubAuthEnv(repoDir, "nonexistent")
  expect(env).toEqual({})
})

test("never throws even if cwd is not a git repository", async () => {
  const notARepo = await fs.mkdtemp(path.join(os.tmpdir(), "oc-not-a-repo-"))
  try {
    const { buildGithubAuthEnv } = await import("../../src/github/credentials")
    const { env } = await buildGithubAuthEnv(notARepo, "origin")
    expect(env).toEqual({})
  } finally {
    await fs.rm(notARepo, { recursive: true, force: true })
  }
})
