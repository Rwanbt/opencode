import { describe, expect, test } from "bun:test"
import type { FileNode } from "@opencode-ai/sdk/v2"
import { createFileTreeStore } from "./tree-store"

// D-08: pure-logic coverage for the file-explorer tree state. createFileTreeStore
// takes injected deps (scope/normalizeDir/list/onError) so it is testable without
// any rendering — only solid-js/store, which works under the preloaded happy-dom.

function node(path: string, type: "file" | "directory" = "file"): FileNode {
  const name = path.split("/").pop() ?? path
  return { path, name, type } as FileNode
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type ListFn = (dir: string) => Promise<FileNode[]>

function setup(listFn: ListFn, normalizeDir: (input: string) => string = (input) => input) {
  const errors: string[] = []
  const calls: string[] = []
  let scope = "proj"
  const store = createFileTreeStore({
    scope: () => scope,
    normalizeDir,
    list: (dir) => {
      calls.push(dir)
      return listFn(dir)
    },
    onError: (message) => errors.push(message),
  })
  return { store, errors, calls, setScope: (next: string) => (scope = next) }
}

describe("createFileTreeStore.listDir", () => {
  test("loads children, populates the node map, marks loaded", async () => {
    const { store } = setup(async () => [node("a.ts"), node("dir", "directory")])

    await store.listDir("")

    expect(store.isLoaded("")).toBe(true)
    expect(store.children("").map((n) => n.path)).toEqual(["a.ts", "dir"])
    expect(store.node("a.ts")?.type).toBe("file")
    expect(store.dirState("")?.loading).toBe(false)
  })

  test("caches a loaded directory (no second list without force)", async () => {
    const { store, calls } = setup(async () => [node("src/a.ts")])

    await store.listDir("src")
    await store.listDir("src")

    expect(calls).toEqual(["src"])
  })

  test("force re-lists a loaded directory", async () => {
    const { store, calls } = setup(async () => [node("src/a.ts")])

    await store.listDir("src")
    await store.listDir("src", { force: true })

    expect(calls).toEqual(["src", "src"])
  })

  test("coalesces concurrent calls into a single in-flight request", async () => {
    const pending = deferred<FileNode[]>()
    const { store, calls } = setup(() => pending.promise)

    const first = store.listDir("src")
    const second = store.listDir("src")

    expect(first).toBe(second)
    expect(calls).toEqual(["src"])

    pending.resolve([node("src/a.ts")])
    await first

    expect(store.children("src").map((n) => n.path)).toEqual(["src/a.ts"])
  })

  test("ignores a result whose scope changed mid-flight", async () => {
    const pending = deferred<FileNode[]>()
    const ctx = setup(() => pending.promise)

    const promise = ctx.store.listDir("src")
    ctx.setScope("other-project")
    pending.resolve([node("src/a.ts")])
    await promise

    expect(ctx.store.isLoaded("src")).toBe(false)
    expect(ctx.store.children("src")).toEqual([])
  })

  test("prunes a removed directory and its descendants on re-list", async () => {
    const results: Record<string, FileNode[]> = {
      "": [node("x", "directory"), node("y.ts")],
      x: [node("x/deep.ts")],
    }
    const ctx = setup(async (dir) => results[dir] ?? [])

    await ctx.store.listDir("")
    await ctx.store.listDir("x")
    expect(ctx.store.node("x/deep.ts")).toBeTruthy()

    results[""] = [node("y.ts")] // "x" disappears upstream
    await ctx.store.listDir("", { force: true })

    expect(ctx.store.node("x")).toBeUndefined()
    expect(ctx.store.node("x/deep.ts")).toBeUndefined() // descendant pruned too
    expect(ctx.store.node("y.ts")).toBeTruthy()
  })

  test("records the error and notifies onError on failure", async () => {
    const ctx = setup(async () => {
      throw new Error("boom")
    })

    await ctx.store.listDir("src")

    expect(ctx.store.dirState("src")?.error).toBe("boom")
    expect(ctx.store.dirState("src")?.loading).toBe(false)
    expect(ctx.store.isLoaded("src")).toBe(false)
    expect(ctx.errors).toEqual(["boom"])
  })

  test("applies normalizeDir to the requested path", async () => {
    const ctx = setup(
      async () => [node("src/a.ts")],
      (input) => input.replace(/\/+$/, ""),
    )

    await ctx.store.listDir("src/")

    expect(ctx.store.isLoaded("src")).toBe(true)
  })
})

describe("createFileTreeStore expand/collapse", () => {
  test("expandDir marks expanded and triggers a load", async () => {
    const ctx = setup(async () => [node("src/a.ts")])

    ctx.store.expandDir("src")
    expect(ctx.store.dirState("src")?.expanded).toBe(true)
    expect(ctx.calls).toContain("src")

    await ctx.store.listDir("src") // same in-flight promise
    expect(ctx.store.children("src").map((n) => n.path)).toEqual(["src/a.ts"])
  })

  test("collapseDir clears expanded without re-listing", async () => {
    const ctx = setup(async () => [node("src/a.ts")])

    ctx.store.expandDir("src")
    await ctx.store.listDir("src")
    ctx.store.collapseDir("src")

    expect(ctx.store.dirState("src")?.expanded).toBe(false)
  })
})

describe("createFileTreeStore accessors", () => {
  test("children returns [] for an unknown directory", () => {
    const { store } = setup(async () => [])
    expect(store.children("nope")).toEqual([])
  })

  test("children skips ids that have no node entry", async () => {
    // list reports a child path, but if its node is later evicted the accessor
    // must not return undefined holes.
    const ctx = setup(async () => [node("src/a.ts"), node("src/b.ts")])
    await ctx.store.listDir("src")
    expect(ctx.store.children("src").map((n) => n.path)).toEqual(["src/a.ts", "src/b.ts"])
  })

  test("reset clears state and re-expands the root", async () => {
    const ctx = setup(async () => [node("src/a.ts")])
    await ctx.store.listDir("src")

    ctx.store.reset()

    expect(ctx.store.isLoaded("src")).toBe(false)
    expect(ctx.store.children("src")).toEqual([])
    expect(ctx.store.dirState("")?.expanded).toBe(true)
  })
})
