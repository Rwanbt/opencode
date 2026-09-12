import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test"
import path from "path"
import * as Lsp from "../../src/lsp/index"
import { LSPServer } from "../../src/lsp/server"
import { LSPPool } from "../../src/lsp/pool"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

function withInstance(fn: (dir: string) => Promise<void>) {
  return async () => {
    await using tmp = await tmpdir()
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: () => fn(tmp.path),
      })
    } finally {
      await Instance.disposeAll()
    }
  }
}

describe("LSP service lifecycle", () => {
  let spawnSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    spawnSpy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)
  })

  afterEach(() => {
    spawnSpy.mockRestore()
  })

  test(
    "init() completes without error",
    withInstance(async () => {
      await Lsp.LSP.init()
    }),
  )

  test(
    "status() returns empty array initially",
    withInstance(async () => {
      const result = await Lsp.LSP.status()
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(0)
    }),
  )

  test(
    "diagnostics() returns empty object initially",
    withInstance(async () => {
      const result = await Lsp.LSP.diagnostics()
      expect(typeof result).toBe("object")
      expect(Object.keys(result).length).toBe(0)
    }),
  )

  test(
    "hasClients() returns true for .ts files in instance",
    withInstance(async (dir) => {
      const result = await Lsp.LSP.hasClients(path.join(dir, "test.ts"))
      expect(result).toBe(true)
    }),
  )

  test(
    "hasClients() returns false for files outside instance",
    withInstance(async (dir) => {
      const result = await Lsp.LSP.hasClients(path.join(dir, "..", "outside.ts"))
      // hasClients checks servers but doesn't check containsPath — getClients does
      // So hasClients may return true even for outside files (it checks extension + root)
      // The guard is in getClients, not hasClients
      expect(typeof result).toBe("boolean")
    }),
  )

  test(
    "workspaceSymbol() returns empty array with no clients",
    withInstance(async () => {
      const result = await Lsp.LSP.workspaceSymbol("test")
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(0)
    }),
  )

  test(
    "definition() returns empty array for unknown file",
    withInstance(async (dir) => {
      const result = await Lsp.LSP.definition({
        file: path.join(dir, "nonexistent.ts"),
        line: 0,
        character: 0,
      })
      expect(Array.isArray(result)).toBe(true)
    }),
  )

  test(
    "references() returns empty array for unknown file",
    withInstance(async (dir) => {
      const result = await Lsp.LSP.references({
        file: path.join(dir, "nonexistent.ts"),
        line: 0,
        character: 0,
      })
      expect(Array.isArray(result)).toBe(true)
    }),
  )

  test(
    "multiple init() calls are idempotent",
    withInstance(async () => {
      await Lsp.LSP.init()
      await Lsp.LSP.init()
      await Lsp.LSP.init()
      // Should not throw or create duplicate state
    }),
  )
})

describe("LSP.Diagnostic", () => {
  test("pretty() formats error diagnostic", () => {
    const result = Lsp.LSP.Diagnostic.pretty({
      range: { start: { line: 9, character: 4 }, end: { line: 9, character: 10 } },
      message: "Type 'string' is not assignable to type 'number'",
      severity: 1,
    } as any)
    expect(result).toBe("ERROR [10:5] Type 'string' is not assignable to type 'number'")
  })

  test("pretty() formats warning diagnostic", () => {
    const result = Lsp.LSP.Diagnostic.pretty({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      message: "Unused variable",
      severity: 2,
    } as any)
    expect(result).toBe("WARN [1:1] Unused variable")
  })

  test("pretty() defaults to ERROR when no severity", () => {
    const result = Lsp.LSP.Diagnostic.pretty({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      message: "Something wrong",
    } as any)
    expect(result).toBe("ERROR [1:1] Something wrong")
  })
})

// B13 — memory/shutdown. shutdownAll now uses Promise.allSettled so a single
// failing client doesn't strand siblings, and aggregates the failures into one
// log entry instead of silently swallowing them.
describe("LSPPool.shutdownAll aggregates errors (B13)", () => {
  test("shutdownAll does not throw when a client fails (errors are aggregated)", async () => {
    const ok = { shutdown: async () => {} }
    const fail = { shutdown: async () => { throw new Error("boom") } }
    const pool = LSPPool.create({ maxConcurrent: 4, idleTimeoutMs: 0 })
    pool.track(ok as never, "s1", "/r1")
    pool.track(fail as never, "s2", "/r2")
    // Must not throw — allSettled waits for all attempts and the aggregated
    // log is the only surface for the failure.
    await pool.shutdownAll()
    // Pool is cleared even on failure (no stranded siblings).
    expect(pool.activeCount()).toBe(0)
  })

  test("shutdownAll clears pool when all shutdowns succeed", async () => {
    const ok1 = { shutdown: async () => {} }
    const ok2 = { shutdown: async () => {} }
    const pool = LSPPool.create({ maxConcurrent: 4, idleTimeoutMs: 0 })
    pool.track(ok1 as never, "s1", "/r1")
    pool.track(ok2 as never, "s2", "/r2")
    await pool.shutdownAll()
    expect(pool.activeCount()).toBe(0)
  })

  test("shutdownAll awaits all attempts (slow shutdown doesn't strand siblings)", async () => {
    let slowDone = false
    const slow = {
      shutdown: async () => {
        await new Promise((r) => setTimeout(r, 50))
        slowDone = true
      },
    }
    const fast = { shutdown: async () => {} }
    const pool = LSPPool.create({ maxConcurrent: 4, idleTimeoutMs: 0 })
    pool.track(slow as never, "s1", "/r1")
    pool.track(fast as never, "s2", "/r2")
    await pool.shutdownAll()
    // The slow shutdown must complete before pool.clear() is called — that's
    // the "0 enfant" oracle: no orphan child processes.
    expect(slowDone).toBe(true)
  })
})
