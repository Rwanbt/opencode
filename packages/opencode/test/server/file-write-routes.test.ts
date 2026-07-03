import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import path from "path"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { tmpdir } from "../fixture/fixture"

// HTTP-level coverage for the file write API routes (ADR-0004). Verifies the
// real status-code mapping (200 / 400 / 403 / 404 / 409) that the editor relies
// on — File.* unit tests cover the logic; this pins the route + middleware wiring
// and the HTTPException translation. One server boot, fresh tmpdir per request
// (directory is request-scoped via WorkspaceRouterMiddleware).

const PASSWORD = "file-write-test-pw"
const AUTH = "Basic " + Buffer.from("opencode:" + PASSWORD).toString("base64")

let server: InProcessServer

beforeAll(async () => {
  server = await withInProcessServer({ password: PASSWORD })
})

afterAll(async () => {
  await server.close()
})

function call(method: string, route: string, dir: string, body?: unknown) {
  const sep = route.includes("?") ? "&" : "?"
  const url = `${route}${sep}directory=${encodeURIComponent(dir)}`
  return server.fetch(url, {
    method,
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe("POST /file/write", () => {
  test("creates a file → 200 + stamp", async () => {
    await using tmp = await tmpdir()
    const r = await call("POST", "/file/write", tmp.path, { path: "a.txt", content: "hello" })
    expect(r.status).toBe(200)
    const res = (await r.json()) as { content: string; stamp: { hash: string }; formatted: boolean }
    expect(res.stamp.hash.length).toBe(64)
    expect(res.content).toBe("hello")
    expect(res.formatted).toBe(false)
    expect(await Bun.file(path.join(tmp.path, "a.txt")).text()).toBe("hello")
  })

  test("overwrite existing without expectedHash → 409", async () => {
    await using tmp = await tmpdir({ init: async (dir) => Bun.write(path.join(dir, "a.txt"), "v1") })
    const r = await call("POST", "/file/write", tmp.path, { path: "a.txt", content: "v2" })
    expect(r.status).toBe(409)
  })

  test("stale expectedHash → 409", async () => {
    await using tmp = await tmpdir({ init: async (dir) => Bun.write(path.join(dir, "a.txt"), "v1") })
    const r = await call("POST", "/file/write", tmp.path, {
      path: "a.txt",
      content: "v2",
      expectedHash: "0".repeat(64),
    })
    expect(r.status).toBe(409)
  })

  test("path escaping the project → 403", async () => {
    await using tmp = await tmpdir()
    const r = await call("POST", "/file/write", tmp.path, { path: "../escape.txt", content: "x" })
    expect(r.status).toBe(403)
  })

  test("missing required field (content) → 400", async () => {
    await using tmp = await tmpdir()
    const r = await call("POST", "/file/write", tmp.path, { path: "a.txt" })
    expect(r.status).toBe(400)
  })
})

describe("GET /file/raw", () => {
  test("reads untrimmed content + stamp → 200", async () => {
    await using tmp = await tmpdir({ init: async (dir) => Bun.write(path.join(dir, "a.txt"), "body\n") })
    const r = await call("GET", "/file/raw?path=a.txt", tmp.path)
    expect(r.status).toBe(200)
    const out = (await r.json()) as { content: string; stamp: { hash: string } }
    expect(out.content).toBe("body\n")
    expect(out.stamp.hash.length).toBe(64)
  })

  test("missing file → 404", async () => {
    await using tmp = await tmpdir()
    const r = await call("GET", "/file/raw?path=nope.txt", tmp.path)
    expect(r.status).toBe(404)
  })
})

describe("POST /file/rename", () => {
  test("renames → 200", async () => {
    await using tmp = await tmpdir({ init: async (dir) => Bun.write(path.join(dir, "a.txt"), "data") })
    const r = await call("POST", "/file/rename", tmp.path, { from: "a.txt", to: "b.txt" })
    expect(r.status).toBe(200)
    expect(await Bun.file(path.join(tmp.path, "b.txt")).text()).toBe("data")
  })

  test("clobbering an existing destination → 409", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "a.txt"), "a")
        await Bun.write(path.join(dir, "b.txt"), "b")
      },
    })
    const r = await call("POST", "/file/rename", tmp.path, { from: "a.txt", to: "b.txt" })
    expect(r.status).toBe(409)
  })
})

describe("DELETE /file", () => {
  test("deletes a file → 200", async () => {
    await using tmp = await tmpdir({ init: async (dir) => Bun.write(path.join(dir, "a.txt"), "data") })
    const r = await call("DELETE", "/file", tmp.path, { path: "a.txt" })
    expect(r.status).toBe(200)
    expect(await Bun.file(path.join(tmp.path, "a.txt")).exists()).toBe(false)
  })

  test("missing file → 404", async () => {
    await using tmp = await tmpdir()
    const r = await call("DELETE", "/file", tmp.path, { path: "ghost.txt" })
    expect(r.status).toBe(404)
  })
})
