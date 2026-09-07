/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { ExpressionError } from "@unifia/expression-runtime"
import { NodeRegistry, NodeRegistryError } from "../src/nodes/registry.js"
import { ALL_FAMILY_MANIFESTS_V1, BUILTIN_NODE_DEFINITIONS } from "../src/nodes/builtins.js"
import { NodeFamilySchema } from "@unifia/contracts"
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

  test("version selection is numeric, not lexical: v10 beats v2 and v9", () => {
    const registry = new NodeRegistry()
    for (const def of BUILTIN_NODE_DEFINITIONS) registry.register(def)
    for (const version of ["v2", "v9", "v10"]) registry.register({ ...BUILTIN_NODE_DEFINITIONS[0]!, version })
    // Lexical ordering would answer "v9" here; the picker must not drift.
    expect(registry.get("tool.http").version).toBe("v10")
    expect(registry.get("tool.http", "v2").version).toBe("v2")
  })

  test("every family the IR schema admits carries a manifest", () => {
    const registry = new NodeRegistry()
    for (const def of [...BUILTIN_NODE_DEFINITIONS, ...ALL_FAMILY_MANIFESTS_V1]) registry.register(def)
    // WHY this guard: the registry is the SINGLE source the runtime, the API,
    // the picker and the builder read. A family added to the IR schema without
    // a manifest would surface as an unknown type at dispatch time instead.
    const registered = new Set(registry.list().map((def) => def.type))
    expect([...NodeFamilySchema.options].filter((family) => !registered.has(family))).toEqual([])
    expect(registry.get("control.if").executor).toBe("internal")
    expect(registry.get("human.approval").executor).toBe("external")
    expect(registry.get("trigger.manual").executor).toBe("external")
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

describe("http executor hardening (Phase 1 review)", () => {
  test("cross-origin redirect strips authorization; same-origin keeps it", async () => {
    let attackerAuth: string | null = "unset"
    const attacker = Bun.serve({ port: 0, fetch: (request) => { attackerAuth = request.headers.get("authorization"); return Response.json({ ok: true }) } })
    const inner = Bun.serve({
      port: 0,
      fetch: (request) => {
        const url = new URL(request.url)
        if (url.pathname === "/go-evil") return Response.redirect(`http://127.0.0.1:${attacker.port}/collect`, 302)
        if (url.pathname === "/go-local") return Response.redirect(`/land`, 302)
        if (url.pathname === "/land") return Response.json({ auth: request.headers.get("authorization") })
        return new Response("nf", { status: 404 })
      },
    })
    try {
      const base = `http://127.0.0.1:${inner.port}`
      const evil = await executeHttpRequest(parseHttpConfig({ method: "GET", url: `${base}/go-evil`, headers: { authorization: "Bearer s3cret" } }))
      expect(evil.data.status).toBe(200)
      expect(attackerAuth).toBeNull()
      const local = await executeHttpRequest(parseHttpConfig({ method: "GET", url: `${base}/go-local`, headers: { authorization: "Bearer s3cret" } }))
      expect((local.data.body as { auth: string }).auth).toBe("Bearer s3cret")
    } finally {
      inner.stop(true)
      attacker.stop(true)
    }
  })

  test("chunked over-limit body without content-length aborts before materializing", async () => {
    const big = "z".repeat(64 * 1024)
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        const enc = new TextEncoder()
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            for (let i = 0; i < 32; i++) controller.enqueue(enc.encode(big))
            controller.close()
          },
        })
        return new Response(stream, { headers: { "content-type": "text/plain" } })
      },
    })
    try {
      const base = `http://127.0.0.1:${server.port}`
      try { await executeHttpRequest(parseHttpConfig({ method: "GET", url: `${base}/stream` })); expect.unreachable() } catch (e) { expect((e as NodeExecutionError).code).toBe("HTTP_RESPONSE_TOO_LARGE") }
    } finally {
      server.stop(true)
    }
  })

  test("stalled body still times out; timeoutMs 0 disables the timer", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Promise<Response>(() => {}),
    })
    const quick = Bun.serve({
      port: 0,
      fetch: async () => { await new Promise((r) => setTimeout(r, 150)); return Response.json({ slow: true }) },
    })
    try {
      try { await executeHttpRequest(parseHttpConfig({ method: "GET", url: `http://127.0.0.1:${server.port}/stall`, timeoutMs: 100 })); expect.unreachable() } catch (e) { expect((e as NodeExecutionError).code).toBe("HTTP_TIMEOUT") }
      const ok = await executeHttpRequest(parseHttpConfig({ method: "GET", url: `http://127.0.0.1:${quick.port}/slow`, timeoutMs: 0 }))
      expect(ok.data.status).toBe(200)
      expect((ok.data.body as { slow: boolean }).slow).toBe(true)
    } finally {
      server.stop(true)
      quick.stop(true)
    }
  })

  test("connection failures without provable cause codes are UNKNOWN (non-retryable); mid-flight reset is UNKNOWN", async () => {
    try { await executeHttpRequest(parseHttpConfig({ method: "POST", url: "http://127.0.0.1:1/gone" })); expect.unreachable() } catch (e) {
      const err = e as NodeExecutionError
      expect(err.code).toBe("HTTP_NETWORK_ERROR")
      expect(err.retryable).toBe(false)
    }
    const cut = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data() {},
        open(socket) { socket.write("HTTP/1.1 200 OK\r\nContent-Length: 100\r\nContent-Type: text/plain\r\n\r\npartial"); socket.end() },
        error() {},
      },
    })
    try {
      try { await executeHttpRequest(parseHttpConfig({ method: "GET", url: `http://127.0.0.1:${cut.port}/cut` })); expect.unreachable() } catch (e) {
        const err = e as NodeExecutionError
        expect(err.retryable).toBe(false)
      }
    } finally {
      cut.stop(true)
    }
  })
})
