/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { ExpressionError } from "@unifia/expression-runtime"
import { NodeRegistry, NodeRegistryError } from "../src/nodes/registry.js"
import { BUILTIN_NODE_DEFINITIONS } from "../src/nodes/builtins.js"
import { evaluateNodeRefs } from "../src/nodes/env.js"
import { NodeExecutionError, NODE_HTTP_TIMEOUT_MS } from "../src/nodes/io.js"
import { executeHttpRequest, parseHttpConfig } from "../src/nodes/http-executor.js"
import { executeTransform, parseTransformConfig } from "../src/nodes/transform-executor.js"

const outputs = new Map<string, unknown>([
  ["httpa", { user: { id: 42, name: "Ada" }, tags: ["x", "y"] }], ["HTTP A", { user: { id: 7 } }],
  ["done", { ok: true }],
])
const known = ["httpa", "done", "later", "HTTP A"]
const completed = new Set(["httpa", "done", "HTTP A"])

describe("node registry", () => {
  test("builtins register without conflict; get latest + pinned; unknown throws typed", () => {
    const registry = new NodeRegistry()
    for (const def of BUILTIN_NODE_DEFINITIONS) registry.register(def)
    expect(registry.list().length).toBe(2)
    expect(registry.get("tool.http").version).toBe("v1")
    expect(registry.get("tool.http", "v1").executor).toBe("http")
    expect(registry.get("tool.transform").executor).toBe("transform")
    expect(() => registry.get("tool.nope")).toThrow(NodeRegistryError)
    expect(() => registry.get("tool.http", "v9")).toThrow(NodeRegistryError)
    expect(() => registry.register({ ...BUILTIN_NODE_DEFINITIONS[0]!, metadata: { ...BUILTIN_NODE_DEFINITIONS[0]!.metadata, displayName: "X" } })).toThrow(NodeRegistryError)
    expect(() => registry.register({ type: "", version: "v1" } as never)).toThrow(NodeRegistryError)
  })
})

describe("$node refs (same expression engine)", () => {
  test("dot + bracket forms incl. display names with spaces", () => {
    const spaced = new Map<string, unknown>([["HTTP A", { user: { id: 7 } }]])
    expect(evaluateNodeRefs(`$node["HTTP A"].user.id`, spaced, ["HTTP A"], new Set(["HTTP A"]))).toBe(7)
    expect(evaluateNodeRefs("$node.httpa.user.name", outputs, known, completed)).toBe("Ada")
    expect(evaluateNodeRefs("$node.httpa.tags[1]", outputs, known, completed)).toBe("y")
    expect(evaluateNodeRefs(`$node["httpa"].user.id + 1`, outputs, known, completed)).toBe(43)
  })
  test("unknown id, unexecuted node, missing path, type mismatch, bounds are typed", () => {
    expect(() => evaluateNodeRefs("$node.nope.x", outputs, known, completed)).toThrow(NodeExecutionError)
    try { evaluateNodeRefs("$node.nope.x", outputs, known, completed); expect.unreachable() } catch (e) { expect((e as NodeExecutionError).code).toBe("NODE_UNKNOWN_REFERENCE") }
    try { evaluateNodeRefs("$node.later.x", outputs, known, completed); expect.unreachable() } catch (e) { expect((e as NodeExecutionError).code).toBe("NODE_NOT_EXECUTED") }
    try { evaluateNodeRefs("$node.httpa.nope.deep", outputs, known, completed); expect.unreachable() } catch (e) { expect((e as NodeExecutionError).code).toBe("NODE_PATH_MISSING") }
    try { evaluateNodeRefs("$node.httpa.tags[9]", outputs, known, completed); expect.unreachable() } catch (e) { expect((e as NodeExecutionError).code).toBe("NODE_PATH_MISSING") }
    try { evaluateNodeRefs("$node.httpa.user.id.foo", outputs, known, completed); expect.unreachable() } catch (e) { expect((e as NodeExecutionError).code).toBe("NODE_TYPE_MISMATCH") }
  })
  test("lone $ and $9 fail closed at parse", () => {
    expect(() => evaluateNodeRefs("$", outputs, known, completed)).toThrow(ExpressionError)
    expect(() => evaluateNodeRefs("$9lives", outputs, known, completed)).toThrow(ExpressionError)
  })
})

describe("transform executor", () => {
  test("projection, rename, construction, access, ternary", () => {
    const out = executeTransform(
      parseTransformConfig({ fields: { id: "$node.httpa.user.id", name: "$node.httpa.user.name", label: `"user-" + $node.httpa.user.name`, first: "$node.httpa.tags[0]", flag: "$node.done.ok ? 1 : 0" } }),
      outputs, known, completed,
    )
    expect(out).toEqual({ id: 42, name: "Ada", label: "user-Ada", first: "x", flag: 1 })
  })
  test("invalid configs and refs are typed", () => {
    expect(() => parseTransformConfig({})).toThrow(NodeExecutionError)
    expect(() => parseTransformConfig({ fields: {} })).toThrow(NodeExecutionError)
    expect(() => parseTransformConfig({ fields: { "not an id": "1" } })).toThrow(NodeExecutionError)
    expect(() => parseTransformConfig({ fields: { a: 42 } })).toThrow(NodeExecutionError)
    expect(() => executeTransform(parseTransformConfig({ fields: { a: "$node.missing.x" } }), outputs, known, completed)).toThrow(NodeExecutionError)
  })
})

describe("http executor config", () => {
  test("valid + invalid shapes are typed", () => {
    expect(parseHttpConfig({ method: "get", url: "https://api/x?y=1" }).method).toBe("GET")
    expect(parseHttpConfig({ method: "POST", url: "http://h/", timeoutMs: 5 }).timeoutMs).toBe(5)
    expect(parseHttpConfig({ method: "GET", url: "https://h/" }).timeoutMs).toBe(NODE_HTTP_TIMEOUT_MS)
    for (const bad of [{}, { method: "GET" }, { method: "FETCH", url: "https://h/" }, { method: "GET", url: "notaurl" }, { method: "GET", url: "ftp://h/" }, { method: "GET", url: "https://h/", timeoutMs: -1 }, { method: "GET", url: "https://h/", headers: ["x"] }]) {
      expect(() => parseHttpConfig(bad)).toThrow(NodeExecutionError)
    }
  })
})

describe("http executor against a real local server", () => {
  test("GET json, POST echo, status retryability, timeout, oversize, redirects", async () => {
    const server: ReturnType<typeof Bun.serve> = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/user") return Response.json({ user: { id: 42, name: "Ada" } })
        if (url.pathname === "/echo") return request.text().then((t) => new Response(t, { headers: { "content-type": "application/json" } }))
        if (url.pathname === "/boom") return new Response("err", { status: 500 })
        if (url.pathname === "/gone") return new Response("no", { status: 404 })
        if (url.pathname === "/slow") return new Promise<never>(() => {})
        if (url.pathname === "/big") return new Response("z".repeat(2 * 1024 * 1024), { headers: { "content-length": String(2 * 1024 * 1024) } })
        if (url.pathname === "/hop") return Response.redirect(`http://127.0.0.1:${server.port}/user`, 302)
        if (url.pathname === "/loop") return Response.redirect(`http://127.0.0.1:${server.port}/loop`, 302)
        return new Response("nf", { status: 404 })
      },
    })
    try {
      const base = `http://127.0.0.1:${server.port}`
      const ok = await executeHttpRequest(parseHttpConfig({ method: "GET", url: `${base}/user` }))
      expect(ok.data.status).toBe(200)
      expect((ok.data.body as { user: { id: number } }).user.id).toBe(42)
      const echo = await executeHttpRequest(parseHttpConfig({ method: "POST", url: `${base}/echo`, body: { a: 1 } }))
      expect((echo.data.body as { a: number }).a).toBe(1)
      try { await executeHttpRequest(parseHttpConfig({ method: "GET", url: `${base}/boom` })); expect.unreachable() } catch (e) { expect((e as NodeExecutionError).code).toBe("HTTP_STATUS_ERROR"); expect((e as NodeExecutionError).retryable).toBe(true) }
      try { await executeHttpRequest(parseHttpConfig({ method: "GET", url: `${base}/gone` })); expect.unreachable() } catch (e) { expect((e as NodeExecutionError).code).toBe("HTTP_STATUS_ERROR"); expect((e as NodeExecutionError).retryable).toBe(false) }
      try { await executeHttpRequest(parseHttpConfig({ method: "GET", url: `${base}/slow`, timeoutMs: 50 })); expect.unreachable() } catch (e) { expect((e as NodeExecutionError).code).toBe("HTTP_TIMEOUT") }
      try { await executeHttpRequest(parseHttpConfig({ method: "GET", url: `${base}/big` })); expect.unreachable() } catch (e) { expect((e as NodeExecutionError).code).toBe("HTTP_RESPONSE_TOO_LARGE") }
      const hop = await executeHttpRequest(parseHttpConfig({ method: "GET", url: `${base}/hop` }))
      expect(hop.data.status).toBe(200)
      expect(hop.data.finalUrl.endsWith("/user")).toBe(true)
      try { await executeHttpRequest(parseHttpConfig({ method: "GET", url: `${base}/loop` })); expect.unreachable() } catch (e) { expect((e as NodeExecutionError).code).toBe("HTTP_STATUS_ERROR") }
    } finally {
      server.stop(true)
    }
  })
})
