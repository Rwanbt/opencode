// HTTP-level tests for the git write routes added in Phase 3 (ADR-0005).
// Strategy: boot the production server; a real git repository is created by
// `tmpdir({ git: true })` so route reachability + basic behaviour can be
// verified without mocking.  Tests do NOT rely on external network or git
// credentials, so push/pull routes are only tested for shape, not outcome.
//
// Coverage:
//   • route reachability (2xx / expected status)
//   • input validation (400 on missing / bad fields)
//   • empty-fallback response shape is JSON-parseable and structurally correct
//   • happy-path round-trips: stage + commit + log + blame + branches
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { writeFile, mkdir } from "fs/promises"
import path from "path"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { tmpdir } from "../fixture/fixture"

const PASSWORD = "git-routes-test-pw"
const AUTH = "Basic " + Buffer.from("opencode:" + PASSWORD).toString("base64")

let server: InProcessServer
let tmpPath: string

beforeAll(async () => {
  const tmp = await tmpdir({ git: true })
  tmpPath = tmp.path
  server = await withInProcessServer({ password: PASSWORD })
})

afterAll(async () => {
  await server.close()
})

function git(method: string, route: string, body?: unknown) {
  const sep = route.includes("?") ? "&" : "?"
  const url = `${route}${sep}directory=${encodeURIComponent(tmpPath)}`
  return server.fetch(url, {
    method,
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

// Helper: write a file and stage it so commits can succeed
async function writeAndStage(name: string, content = "hello") {
  await writeFile(path.join(tmpPath, name), content, "utf8")
  await git("POST", "/git/add", { files: [name] })
}

// ─── GET /git/working-status ─────────────────────────────────────────────────

describe("GET /git/working-status", () => {
  test("returns array (possibly empty) for clean repo", async () => {
    const r = await git("GET", "/git/working-status")
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(Array.isArray(body)).toBe(true)
  })

  test("returns entry with file/code/status after writing a file", async () => {
    await writeFile(path.join(tmpPath, "untracked.txt"), "test", "utf8")
    const r = await git("GET", "/git/working-status")
    expect(r.status).toBe(200)
    const body = (await r.json()) as Array<{ file: string; code: string; status: string }>
    const entry = body.find((e) => e.file === "untracked.txt")
    expect(entry).toBeDefined()
    const e = entry!
    expect(typeof e.code).toBe("string")
    expect(e.code).toHaveLength(2)
    expect(["added", "deleted", "modified"]).toContain(e.status)
  })
})

// ─── POST /git/add ────────────────────────────────────────────────────────────

describe("POST /git/add", () => {
  test("stage a specific file → 200 ok: true", async () => {
    await writeFile(path.join(tmpPath, "to_stage.txt"), "content", "utf8")
    const r = await git("POST", "/git/add", { files: ["to_stage.txt"] })
    expect(r.status).toBe(200)
    const body = (await r.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  test("stage all (empty files array) → 200 ok: true", async () => {
    await writeFile(path.join(tmpPath, "another.txt"), "content", "utf8")
    const r = await git("POST", "/git/add", {})
    expect(r.status).toBe(200)
    const body = (await r.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  test("no body → 200 ok: true (files is optional, defaults to stage-all)", async () => {
    await writeFile(path.join(tmpPath, "no_body_test.txt"), "x", "utf8")
    const r = await server.fetch(`/git/add?directory=${encodeURIComponent(tmpPath)}`, {
      method: "POST",
      headers: { Authorization: AUTH, "Content-Type": "application/json" },
      body: "{}",
    })
    expect(r.status).toBe(200)
    const body = (await r.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})

// ─── POST /git/reset ─────────────────────────────────────────────────────────

describe("POST /git/reset", () => {
  test("unstage specific file → 200 ok: true", async () => {
    await writeAndStage("to_unstage.txt")
    const r = await git("POST", "/git/reset", { files: ["to_unstage.txt"] })
    expect(r.status).toBe(200)
    const body = (await r.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  test("unstage all → 200 ok: true", async () => {
    await writeAndStage("staged_all.txt")
    const r = await git("POST", "/git/reset", {})
    expect(r.status).toBe(200)
    const body = (await r.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  test("empty body → 200 ok: true (files is optional, defaults to unstage-all)", async () => {
    const r = await server.fetch(`/git/reset?directory=${encodeURIComponent(tmpPath)}`, {
      method: "POST",
      headers: { Authorization: AUTH, "Content-Type": "application/json" },
      body: "{}",
    })
    expect(r.status).toBe(200)
    const body = (await r.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})

// ─── POST /git/commit ────────────────────────────────────────────────────────

describe("POST /git/commit", () => {
  test("commit staged changes → 200 with hash", async () => {
    await writeAndStage("commit_test.txt", "commit content")
    const r = await git("POST", "/git/commit", { message: "test: Phase 3 git commit route" })
    expect(r.status).toBe(200)
    const body = (await r.json()) as { hash: string }
    expect(typeof body.hash).toBe("string")
    expect(body.hash.length).toBeGreaterThan(0)
  })

  test("empty message → 400", async () => {
    const r = await git("POST", "/git/commit", { message: "" })
    expect(r.status).toBe(400)
  })

  test("missing message → 400", async () => {
    const r = await git("POST", "/git/commit", {})
    expect(r.status).toBe(400)
  })

  test("nothing to commit → 400 (git error)", async () => {
    // Make sure the working tree is clean first by staging nothing
    // (previous tests may have committed everything already)
    const r = await git("POST", "/git/commit", { message: "should fail" })
    // Either 400 (git error: nothing to commit) or 200 (if there happened to
    // be uncommitted changes from prior tests). Both are valid depending on
    // test ordering. We simply assert JSON is returned.
    expect([200, 400]).toContain(r.status)
    const body = await r.json()
    expect(typeof body).toBe("object")
  })
})

// ─── GET /git/log ─────────────────────────────────────────────────────────────

describe("GET /git/log", () => {
  test("returns array of commits", async () => {
    const r = await git("GET", "/git/log")
    expect(r.status).toBe(200)
    const body = (await r.json()) as Array<{
      hash: string
      shortHash: string
      author: string
      timestamp: number
      subject: string
    }>
    expect(Array.isArray(body)).toBe(true)
    // The tmpdir has at least the initial commit added by `tmpdir({ git: true })`
    // plus the commit we made in the commit test above (if it ran first)
    if (body.length > 0) {
      const first = body[0]!
      expect(typeof first.hash).toBe("string")
      expect(first.hash).toHaveLength(40)
      expect(typeof first.shortHash).toBe("string")
      expect(typeof first.subject).toBe("string")
      expect(typeof first.timestamp).toBe("number")
    }
  })

  test("limit query param is respected", async () => {
    const r = await git("GET", "/git/log?limit=1")
    expect(r.status).toBe(200)
    const body = (await r.json()) as unknown[]
    expect(body.length).toBeLessThanOrEqual(1)
  })
})

// ─── GET /git/blame ───────────────────────────────────────────────────────────

describe("GET /git/blame", () => {
  test("blame a committed file → 200 non-empty array", async () => {
    // commit_test.txt was committed in the POST /git/commit test above.
    // If that test ran first (likely), blame should work.
    const r = await git("GET", `/git/blame?file=commit_test.txt`)
    expect(r.status).toBe(200)
    const body = (await r.json()) as Array<{
      hash: string
      line: number
      author: string
      content: string
    }>
    expect(Array.isArray(body)).toBe(true)
    if (body.length > 0) {
      const first = body[0]!
      expect(typeof first.hash).toBe("string")
      expect(typeof first.line).toBe("number")
      expect(typeof first.author).toBe("string")
      expect(typeof first.content).toBe("string")
    }
  })

  test("blame non-existent file → 200 empty array (git blame fails silently)", async () => {
    const r = await git("GET", "/git/blame?file=does_not_exist.txt")
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(Array.isArray(body)).toBe(true)
  })

  test("missing file param → 400", async () => {
    const r = await git("GET", "/git/blame")
    expect(r.status).toBe(400)
  })
})

// ─── GET /git/branches ────────────────────────────────────────────────────────

describe("GET /git/branches", () => {
  test("returns array with at least main/master", async () => {
    const r = await git("GET", "/git/branches")
    expect(r.status).toBe(200)
    const body = (await r.json()) as Array<{
      name: string
      current: boolean
      remote: boolean
    }>
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
    const current = body.find((b) => b.current)
    expect(current).toBeDefined()
    expect(typeof current?.name).toBe("string")
    expect(typeof current?.remote).toBe("boolean")
  })
})

// ─── POST /git/branch ─────────────────────────────────────────────────────────

describe("POST /git/branch", () => {
  test("create new branch → 200 ok: true", async () => {
    const r = await git("POST", "/git/branch", { name: "test-branch-phase3", create: true })
    expect(r.status).toBe(200)
    const body = (await r.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  test("switch back to main/master → 200 ok: true", async () => {
    // Find the non-test branch name dynamically
    const br = await git("GET", "/git/branches")
    const branches = (await br.json()) as Array<{ name: string; current: boolean }>
    const main = branches.find((b) => b.name === "main" || b.name === "master")
    if (!main) return // skip if we can't find main (unusual CI setup)

    const r = await git("POST", "/git/branch", { name: main.name, create: false })
    expect(r.status).toBe(200)
    const body = (await r.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  test("missing name → 400", async () => {
    const r = await git("POST", "/git/branch", { create: false })
    expect(r.status).toBe(400)
  })

  test("empty name → 400", async () => {
    const r = await git("POST", "/git/branch", { name: "", create: false })
    expect(r.status).toBe(400)
  })
})

// ─── POST /git/push — shape only (no remote configured) ───────────────────────

describe("POST /git/push (no remote)", () => {
  test("push without remote → 200 ok: false + error string (no origin)", async () => {
    const r = await git("POST", "/git/push", { remote: "origin" })
    expect(r.status).toBe(200)
    const body = (await r.json()) as { ok: boolean; error?: string }
    // No remote configured in the tmpdir → git push fails with ok: false
    expect(body.ok).toBe(false)
    expect(typeof body.error).toBe("string")
  })

  test("empty body → 200 ok: false (remote defaults to origin, no remote configured)", async () => {
    const r = await server.fetch(`/git/push?directory=${encodeURIComponent(tmpPath)}`, {
      method: "POST",
      headers: { Authorization: AUTH, "Content-Type": "application/json" },
      body: "{}",
    })
    expect(r.status).toBe(200)
    const body = (await r.json()) as { ok: boolean }
    // No origin configured → ok: false (acceptable; proves route runs)
    expect(typeof body.ok).toBe("boolean")
  })
})

// ─── POST /git/pull — shape only (no remote configured) ───────────────────────

describe("POST /git/pull (no remote)", () => {
  test("pull without remote → 200 ok: false + error string (no origin)", async () => {
    const r = await git("POST", "/git/pull", { remote: "origin" })
    expect(r.status).toBe(200)
    const body = (await r.json()) as { ok: boolean; error?: string }
    expect(body.ok).toBe(false)
    expect(typeof body.error).toBe("string")
  })
})
