import { test, expect, describe } from "bun:test"
import { createFileStore } from "./store"

// Pure unit tests for the FileStore shape (Phase 2.1 foundation). No SDK,
// no CodeMirror, no filesystem. Just round-trip + state-machine transitions.

const stamp = (h: string, size?: number) => ({ hash: h, size })

describe("file store — shape", () => {
  test("starts empty", () => {
    const s = createFileStore()
    expect(s.state.docs).toEqual({})
    expect(s.get("nope")).toBeUndefined()
  })

  test("upsert + get round-trip preserves every FileDoc field", () => {
    const s = createFileStore()
    const doc = {
      content: "hello\n",
      stamp: stamp("h:hello", 6),
      status: "clean" as const,
      draft: undefined,
      vcs: undefined,
    }
    s.upsert("a.ts", doc)
    expect(s.get("a.ts")).toEqual(doc)
  })

  test("remove deletes the entry", () => {
    const s = createFileStore()
    s.upsert("a.ts", { content: "x", stamp: stamp("x"), status: "clean" })
    s.remove("a.ts")
    expect(s.get("a.ts")).toBeUndefined()
  })

  test("set patches existing entry, leaves untouched fields alone", () => {
    const s = createFileStore()
    s.upsert("a.ts", { content: "x", stamp: stamp("x"), status: "clean" })
    s.set("a.ts", { status: "saving" })
    expect(s.get("a.ts")!.status).toBe("saving")
    expect(s.get("a.ts")!.content).toBe("x")
  })

  test("set is a no-op when the path is unknown", () => {
    const s = createFileStore()
    s.set("ghost.ts", { status: "dirty" })
    expect(s.get("ghost.ts")).toBeUndefined()
  })
})

describe("file store — status transitions", () => {
  test("markClean sets content + stamp + status='clean' AND clears the draft", () => {
    const s = createFileStore()
    s.upsert("a.ts", {
      content: "old",
      stamp: stamp("old"),
      status: "dirty",
      draft: "user edits",
    })
    s.markClean("a.ts", "new", stamp("new"))
    const d = s.get("a.ts")!
    expect(d.content).toBe("new")
    expect(d.stamp.hash).toBe("new")
    expect(d.status).toBe("clean")
    expect(d.draft).toBeUndefined()
  })

  test("markClean with vcs populates the git payload", () => {
    const s = createFileStore()
    s.upsert("a.ts", { content: "x", stamp: stamp("x"), status: "clean" })
    s.markClean("a.ts", "y", stamp("y"), { diff: "@@ -1 +1 @@\n-x\n+y\n" })
    expect(s.get("a.ts")!.vcs?.diff).toContain("+y")
  })

  test("markClean without vcs strips any previous vcs payload", () => {
    const s = createFileStore()
    s.upsert("a.ts", {
      content: "x",
      stamp: stamp("x"),
      status: "clean",
      vcs: { diff: "old diff" },
    })
    s.markClean("a.ts", "y", stamp("y"))
    expect(s.get("a.ts")!.vcs).toBeUndefined()
  })

  test("markDirty sets draft + status='dirty'; no-op when doc is absent", () => {
    const s = createFileStore()
    s.upsert("a.ts", { content: "x", stamp: stamp("x"), status: "clean" })
    s.markDirty("a.ts", "user edits")
    const d = s.get("a.ts")!
    expect(d.draft).toBe("user edits")
    expect(d.status).toBe("dirty")

    s.markDirty("ghost.ts", "x")
    expect(s.get("ghost.ts")).toBeUndefined()
  })

  test("markSaving transitions status without touching the draft", () => {
    // WHY: the live CM buffer is the source of truth during the save round-trip.
    // Clearing it would force the component to re-seed CM after every save ack.
    const s = createFileStore()
    s.upsert("a.ts", { content: "x", stamp: stamp("x"), status: "dirty", draft: "d" })
    s.markSaving("a.ts")
    expect(s.get("a.ts")!.status).toBe("saving")
    expect(s.get("a.ts")!.draft).toBe("d")
  })

  test("markConflict transitions status to 'conflict'", () => {
    const s = createFileStore()
    s.upsert("a.ts", { content: "x", stamp: stamp("x"), status: "saving" })
    s.markConflict("a.ts")
    expect(s.get("a.ts")!.status).toBe("conflict")
  })

  test("markMissing transitions status to 'missing'", () => {
    const s = createFileStore()
    s.upsert("a.ts", { content: "x", stamp: stamp("x"), status: "clean" })
    s.markMissing("a.ts")
    expect(s.get("a.ts")!.status).toBe("missing")
  })
})

describe("file store — content + vcs split (PLAN Phase 2 contract)", () => {
  test("content is ALWAYS a string for known files", () => {
    const s = createFileStore()
    s.upsert("a.ts", { content: "raw bytes\n", stamp: stamp("raw"), status: "clean" })
    expect(typeof s.get("a.ts")!.content).toBe("string")
  })

  test("vcs is OPTIONAL — present only for git-tracked files with a diff", () => {
    const s = createFileStore()
    s.upsert("plain.ts", { content: "x", stamp: stamp("x"), status: "clean" })
    s.upsert("git.ts", {
      content: "y",
      stamp: stamp("y"),
      status: "clean",
      vcs: { diff: "diff" },
    })
    expect(s.get("plain.ts")!.vcs).toBeUndefined()
    expect(s.get("git.ts")!.vcs?.diff).toBe("diff")
  })
})