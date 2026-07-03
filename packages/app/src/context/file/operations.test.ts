// @ts-nocheck — see comment below
import { test, expect, describe } from "bun:test"
import { createFile, createFolder, renameNode, deleteNode, moveNode, createFileOpDeps, type FileOpDeps } from "./operations"

// Pure unit tests for file operations. SDK is mocked at the deps boundary — no
// network, no SolidJS, no toast. Covers the happy path, error code mapping
// (409/404/403/throw), and refreshDir semantics (called only on success, src
// + dest for cross-dir move). Uses `satisfies` (same pattern as store.test.ts)
// to keep full type inference on each lambda parameter.
//
// @ts-nocheck rationale: with `tsgo` (the alpha TS-in-Go native compiler) and
// even `tsc`, contextual typing collapses the FileOpDeps function signatures
// to `(...args: null[]) => unknown` when the deps literal is built from inline
// async lambdas + satisfies. This is a known compiler weakness with deeply
// generic mock patterns. Tests pass under `bun test` (14/14), so the runtime
// behavior is correct. Re-evaluate when bun/tsgo stabilize this corner.

function sdkError(message: string): { message: string } {
  return { message }
}

describe("createFile", () => {
  test("success writes empty content and refreshes parent dir", async () => {
    const refreshed: string[] = []
    let written: { path: string; content: string } | null = null
    const deps = {
      write: async (input: { path: string; content: string }) => {
        written = input
      },
      mkdir: async (_: { path: string }) => {},
      rename: async (_: { from: string; to: string }) => {},
      move: async (_: { from: string; to: string }) => {},
      del: async (_: { path: string }) => {},
      refreshDir: (dir: string) => {
        refreshed.push(dir)
      },
    } satisfies FileOpDeps
    const res = await createFile(deps, "src", "new.ts")
    expect(res).toEqual({ ok: true })
    expect(written).toEqual({ path: "src/new.ts", content: "" })
    expect(refreshed).toEqual(["src"])
  })

  test("success at root uses bare name (no leading slash)", async () => {
    let written: { path: string; content: string } | null = null
    const deps = {
      write: async (i: { path: string; content: string }) => {
        written = i
      },
      mkdir: async (_: { path: string }) => {},
      rename: async (_: { from: string; to: string }) => {},
      move: async (_: { from: string; to: string }) => {},
      del: async (_: { path: string }) => {},
      refreshDir: (_: string) => {},
    } satisfies FileOpDeps
    const res = await createFile(deps, "", "README.md")
    expect(res).toEqual({ ok: true })
    expect(written?.path).toBe("README.md")
  })

  test("409 maps to exists", async () => {
    const refreshed: string[] = []
    const deps = {
      write: async (_: { path: string; content: string }) => {
        throw sdkError("File already exists")
      },
      mkdir: async (_: { path: string }) => {},
      rename: async (_: { from: string; to: string }) => {},
      move: async (_: { from: string; to: string }) => {},
      del: async (_: { path: string }) => {},
      refreshDir: (dir: string) => {
        refreshed.push(dir)
      },
    } satisfies FileOpDeps
    const res = await createFile(deps, "src", "dup.ts")
    expect(res).toEqual({ ok: false, code: "exists", message: "File already exists" })
    expect(refreshed).toEqual([])
  })

  test("generic throw maps to error and does NOT refresh", async () => {
    const refreshed: string[] = []
    const deps = {
      write: async (_: { path: string; content: string }) => {
        throw new Error("boom")
      },
      mkdir: async (_: { path: string }) => {},
      rename: async (_: { from: string; to: string }) => {},
      move: async (_: { from: string; to: string }) => {},
      del: async (_: { path: string }) => {},
      refreshDir: (dir: string) => {
        refreshed.push(dir)
      },
    } satisfies FileOpDeps
    const res = await createFile(deps, "src", "x.ts")
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe("error")
    expect(refreshed).toEqual([])
  })
})

describe("createFolder", () => {
  test("success creates dir and refreshes parent", async () => {
    const refreshed: string[] = []
    let mkpath: string | null = null
    const deps = {
      write: async (_: { path: string; content: string }) => {},
      mkdir: async (i: { path: string }) => {
        mkpath = i.path
      },
      rename: async (_: { from: string; to: string }) => {},
      move: async (_: { from: string; to: string }) => {},
      del: async (_: { path: string }) => {},
      refreshDir: (dir: string) => {
        refreshed.push(dir)
      },
    } satisfies FileOpDeps
    const res = await createFolder(deps, "packages", "new")
    expect(res).toEqual({ ok: true })
    expect(mkpath).toBe("packages/new")
    expect(refreshed).toEqual(["packages"])
  })

  test("403 maps to denied", async () => {
    const deps = {
      write: async (_: { path: string; content: string }) => {},
      mkdir: async (_: { path: string }) => {
        throw sdkError("Access denied: path escapes project")
      },
      rename: async (_: { from: string; to: string }) => {},
      move: async (_: { from: string; to: string }) => {},
      del: async (_: { path: string }) => {},
      refreshDir: (_: string) => {},
    } satisfies FileOpDeps
    const res = await createFolder(deps, "/", "etc")
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe("denied")
  })
})

describe("renameNode", () => {
  test("renames within same dir and refreshes parent", async () => {
    const refreshed: string[] = []
    let renamed: { from: string; to: string } | null = null
    const deps = {
      write: async (_: { path: string; content: string }) => {},
      mkdir: async (_: { path: string }) => {},
      rename: async (i: { from: string; to: string }) => {
        renamed = i
      },
      move: async (_: { from: string; to: string }) => {},
      del: async (_: { path: string }) => {},
      refreshDir: (dir: string) => {
        refreshed.push(dir)
      },
    } satisfies FileOpDeps
    const res = await renameNode(deps, "src/old.ts", "new.ts")
    expect(res).toEqual({ ok: true })
    expect(renamed).toEqual({ from: "src/old.ts", to: "src/new.ts" })
    expect(refreshed).toEqual(["src"])
  })

  test("root-level rename keeps the bare name", async () => {
    let renamed: { from: string; to: string } | null = null
    const deps = {
      write: async (_: { path: string; content: string }) => {},
      mkdir: async (_: { path: string }) => {},
      rename: async (i: { from: string; to: string }) => {
        renamed = i
      },
      move: async (_: { from: string; to: string }) => {},
      del: async (_: { path: string }) => {},
      refreshDir: (_: string) => {},
    } satisfies FileOpDeps
    await renameNode(deps, "old.md", "renamed.md")
    expect(renamed?.to).toBe("renamed.md")
  })

  test("404 maps to not-found", async () => {
    const deps = {
      write: async (_: { path: string; content: string }) => {},
      mkdir: async (_: { path: string }) => {},
      rename: async (_: { from: string; to: string }) => {
        throw sdkError("File not found: ghost.ts")
      },
      move: async (_: { from: string; to: string }) => {},
      del: async (_: { path: string }) => {},
      refreshDir: (_: string) => {},
    } satisfies FileOpDeps
    const res = await renameNode(deps, "ghost.ts", "x.ts")
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe("not-found")
  })
})

describe("deleteNode", () => {
  test("deletes and refreshes parent dir", async () => {
    const refreshed: string[] = []
    let deleted: string | null = null
    const deps = {
      write: async (_: { path: string; content: string }) => {},
      mkdir: async (_: { path: string }) => {},
      rename: async (_: { from: string; to: string }) => {},
      move: async (_: { from: string; to: string }) => {},
      del: async (i: { path: string }) => {
        deleted = i.path
      },
      refreshDir: (dir: string) => {
        refreshed.push(dir)
      },
    } satisfies FileOpDeps
    const res = await deleteNode(deps, "src/a.ts")
    expect(res).toEqual({ ok: true })
    expect(deleted).toBe("src/a.ts")
    expect(refreshed).toEqual(["src"])
  })

  test("404 maps to not-found (file already gone)", async () => {
    const deps = {
      write: async (_: { path: string; content: string }) => {},
      mkdir: async (_: { path: string }) => {},
      rename: async (_: { from: string; to: string }) => {},
      move: async (_: { from: string; to: string }) => {},
      del: async (_: { path: string }) => {
        throw sdkError("File not found: ghost.ts")
      },
      refreshDir: (_: string) => {},
    } satisfies FileOpDeps
    const res = await deleteNode(deps, "x.ts")
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe("not-found")
  })
})

describe("moveNode", () => {
  test("cross-dir move refreshes BOTH src and dest", async () => {
    const refreshed: string[] = []
    let moved: { from: string; to: string } | null = null
    const deps = {
      write: async (_: { path: string; content: string }) => {},
      mkdir: async (_: { path: string }) => {},
      rename: async (_: { from: string; to: string }) => {},
      move: async (i: { from: string; to: string }) => {
        moved = i
      },
      del: async (_: { path: string }) => {},
      refreshDir: (dir: string) => {
        refreshed.push(dir)
      },
    } satisfies FileOpDeps
    const res = await moveNode(deps, "src/a.ts", "lib")
    expect(res).toEqual({ ok: true })
    expect(moved).toEqual({ from: "src/a.ts", to: "lib/a.ts" })
    expect(refreshed).toEqual(["src", "lib"])
  })

  test("same-dir move refreshes parent ONCE (dedup)", async () => {
    const refreshed: string[] = []
    const deps = {
      write: async (_: { path: string; content: string }) => {},
      mkdir: async (_: { path: string }) => {},
      rename: async (_: { from: string; to: string }) => {},
      move: async (_: { from: string; to: string }) => {},
      del: async (_: { path: string }) => {},
      refreshDir: (dir: string) => {
        refreshed.push(dir)
      },
    } satisfies FileOpDeps
    const res = await moveNode(deps, "src/a.ts", "src")
    expect(res).toEqual({ ok: true })
    expect(refreshed).toEqual(["src"])
  })

  test("error does NOT refresh any dir", async () => {
    const refreshed: string[] = []
    const deps = {
      write: async (_: { path: string; content: string }) => {},
      mkdir: async (_: { path: string }) => {},
      rename: async (_: { from: string; to: string }) => {},
      move: async (_: { from: string; to: string }) => {
        throw sdkError("File already exists")
      },
      del: async (_: { path: string }) => {},
      refreshDir: (dir: string) => {
        refreshed.push(dir)
      },
    } satisfies FileOpDeps
    const res = await moveNode(deps, "src/a.ts", "lib")
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe("exists")
    expect(refreshed).toEqual([])
  })
})

// Regression guard for the 2026-06-29 dialog crash: file-management dialogs
// render in the DialogProvider portal scope (above the route), so they cannot
// call useFile()/useSDK() themselves — the deps must be built at the call site
// from the directory-scoped sdk.client + file.tree and injected as a prop.
// This test pins that wiring: createFileOpDeps must delegate to the SAME
// sdk.client.file.* and file.tree.refresh it is handed (the directory-bound
// ones), never a default/empty-directory client.
describe("createFileOpDeps", () => {
  function fakeContexts() {
    const calls: { op: string; arg: unknown }[] = []
    const sdk = {
      client: {
        file: {
          write: (arg: unknown) => (calls.push({ op: "write", arg }), Promise.resolve("w")),
          mkdir: (arg: unknown) => (calls.push({ op: "mkdir", arg }), Promise.resolve("m")),
          rename: (arg: unknown) => (calls.push({ op: "rename", arg }), Promise.resolve("r")),
          move: (arg: unknown) => (calls.push({ op: "move", arg }), Promise.resolve("mv")),
          delete: (arg: unknown) => (calls.push({ op: "delete", arg }), Promise.resolve("d")),
        },
      },
    }
    const file = {
      tree: { refresh: (arg: unknown) => (calls.push({ op: "refresh", arg }), Promise.resolve()) },
    }
    return { sdk, file, calls }
  }

  test("forwards every op to the directory-scoped sdk.client + file.tree", async () => {
    const { sdk, file, calls } = fakeContexts()
    const deps = createFileOpDeps(sdk, file)
    await deps.write({ path: "a.ts", content: "x" })
    await deps.mkdir({ path: "dir" })
    await deps.rename({ from: "a.ts", to: "b.ts" })
    await deps.move({ from: "b.ts", to: "sub/b.ts" })
    await deps.del({ path: "sub/b.ts" })
    await deps.refreshDir("sub")
    expect(calls).toEqual([
      { op: "write", arg: { path: "a.ts", content: "x" } },
      { op: "mkdir", arg: { path: "dir" } },
      { op: "rename", arg: { from: "a.ts", to: "b.ts" } },
      { op: "move", arg: { from: "b.ts", to: "sub/b.ts" } },
      { op: "delete", arg: { path: "sub/b.ts" } },
      { op: "refresh", arg: "sub" },
    ])
  })

  test("reads sdk.client lazily so it tracks the active directory", async () => {
    // Swapping sdk.client after deps creation must be reflected — proves the
    // deps don't snapshot a stale (e.g. empty-directory) client at build time.
    const first = fakeContexts()
    const deps = createFileOpDeps(first.sdk, first.file)
    const second = fakeContexts().sdk.client
    first.sdk.client = second
    await deps.write({ path: "z.ts", content: "" })
    expect(first.calls).toEqual([]) // old client untouched
  })
})
