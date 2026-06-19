import { test, expect, describe } from "bun:test"
import { createEditorStore, type EditorDeps, type WriteResult } from "./store"

// Pure state-machine tests for the editor store (ADR-0005, 1b-core). No
// CodeMirror, no SDK — deps are an in-memory "disk". Runs under the app
// happy-dom preload (solid-js/store only).

const hash = (s: string) => `h:${s.length}:${s}`

function fakeDeps(initial: Record<string, string> = {}) {
  const disk = new Map<string, string>(Object.entries(initial))
  let format: ((s: string) => string) | null = null
  const deps: EditorDeps = {
    async readRaw(path) {
      if (!disk.has(path)) return { type: "not-found" }
      const content = disk.get(path)!
      return { type: "ok", content, stamp: { hash: hash(content) } }
    },
    async write({ path, content, expectedHash, format: doFormat }) {
      const exists = disk.has(path)
      if (exists && expectedHash !== undefined && hash(disk.get(path)!) !== expectedHash) {
        return { type: "conflict" }
      }
      const final = doFormat && format ? format(content) : content
      disk.set(path, final)
      return { type: "ok", content: final, stamp: { hash: hash(final) }, formatted: final !== content }
    },
  }
  return { deps, disk, setFormat: (f: (s: string) => string) => (format = f) }
}

describe("editor store — open", () => {
  test("loads baseline and returns content to seed CM", async () => {
    const { deps } = fakeDeps({ "a.ts": "hello" })
    const store = createEditorStore(deps)
    const eff = await store.open("a.ts")
    expect(eff).toEqual({ type: "set", content: "hello" })
    const e = store.get("a.ts")!
    expect(e.baseline).toEqual({ content: "hello", hash: hash("hello") })
    expect(e.dirty).toBe(false)
  })

  test("missing file → missing effect + entry flagged", async () => {
    const { deps } = fakeDeps()
    const store = createEditorStore(deps)
    const eff = await store.open("ghost.ts")
    expect(eff.type).toBe("missing")
    expect(store.get("ghost.ts")!.missing).toBe(true)
  })

  test("already-open returns baseline without re-reading", async () => {
    const { deps, disk } = fakeDeps({ "a.ts": "v1" })
    const store = createEditorStore(deps)
    await store.open("a.ts")
    disk.set("a.ts", "changed-on-disk")
    const eff = await store.open("a.ts")
    expect(eff).toEqual({ type: "set", content: "v1" }) // not re-read
  })
})

describe("editor store — dirty + save", () => {
  test("setDirty toggles", async () => {
    const { deps } = fakeDeps({ "a.ts": "x" })
    const store = createEditorStore(deps)
    await store.open("a.ts")
    store.setDirty("a.ts", true)
    expect(store.get("a.ts")!.dirty).toBe(true)
    store.setDirty("a.ts", false)
    expect(store.get("a.ts")!.dirty).toBe(false)
  })

  test("save success updates baseline, clears dirty, no reconcile when unformatted", async () => {
    const { deps, disk } = fakeDeps({ "a.ts": "v1" })
    const store = createEditorStore(deps)
    await store.open("a.ts")
    store.setDirty("a.ts", true)
    const eff = await store.save("a.ts", "v2")
    expect(eff).toEqual({ type: "none" })
    expect(disk.get("a.ts")).toBe("v2")
    const e = store.get("a.ts")!
    expect(e.baseline).toEqual({ content: "v2", hash: hash("v2") })
    expect(e.dirty).toBe(false)
  })

  test("save with format reconciles buffer to formatted content", async () => {
    const fake = fakeDeps({ "a.ts": "v1" })
    fake.setFormat((s) => s.trim() + "\n")
    const store = createEditorStore(fake.deps)
    await store.open("a.ts")
    const eff = await store.save("a.ts", "  v2  ", true)
    expect(eff).toEqual({ type: "set", content: "v2\n" })
    expect(store.get("a.ts")!.baseline.content).toBe("v2\n")
  })

  test("save 409 → conflict effect, baseline unchanged", async () => {
    const conflictDeps: EditorDeps = {
      async readRaw() {
        return { type: "ok", content: "v1", stamp: { hash: hash("v1") } }
      },
      async write() {
        return { type: "conflict" } satisfies WriteResult
      },
    }
    const store = createEditorStore(conflictDeps)
    await store.open("a.ts")
    const eff = await store.save("a.ts", "mine")
    expect(eff.type).toBe("conflict")
    const e = store.get("a.ts")!
    expect(e.conflict).toBe(true)
    expect(e.saving).toBe(false)
    expect(e.baseline.content).toBe("v1") // not overwritten
  })

  test("save not-found → missing", async () => {
    const deps: EditorDeps = {
      async readRaw() {
        return { type: "ok", content: "v1", stamp: { hash: hash("v1") } }
      },
      async write() {
        return { type: "not-found" }
      },
    }
    const store = createEditorStore(deps)
    await store.open("a.ts")
    const eff = await store.save("a.ts", "mine")
    expect(eff.type).toBe("missing")
    expect(store.get("a.ts")!.missing).toBe(true)
  })

  test("save while a save is in flight is ignored (guard)", async () => {
    let resolveWrite: (r: WriteResult) => void = () => {}
    const deps: EditorDeps = {
      async readRaw() {
        return { type: "ok", content: "v1", stamp: { hash: hash("v1") } }
      },
      write: () => new Promise<WriteResult>((r) => (resolveWrite = r)),
    }
    const store = createEditorStore(deps)
    await store.open("a.ts")
    const first = store.save("a.ts", "a")
    expect(store.get("a.ts")!.saving).toBe(true)
    const second = await store.save("a.ts", "b")
    expect(second).toEqual({ type: "none" }) // ignored while saving
    resolveWrite({ type: "ok", content: "a", stamp: { hash: hash("a") }, formatted: false })
    await first
    expect(store.get("a.ts")!.saving).toBe(false)
  })
})

describe("editor store — discard / reload", () => {
  test("discard resets to baseline and clears dirty", async () => {
    const { deps } = fakeDeps({ "a.ts": "base" })
    const store = createEditorStore(deps)
    await store.open("a.ts")
    store.setDirty("a.ts", true)
    const eff = store.discard("a.ts")
    expect(eff).toEqual({ type: "set", content: "base" })
    expect(store.get("a.ts")!.dirty).toBe(false)
  })

  test("reload re-reads disk and replaces baseline", async () => {
    const { deps, disk } = fakeDeps({ "a.ts": "v1" })
    const store = createEditorStore(deps)
    await store.open("a.ts")
    disk.set("a.ts", "v2-disk")
    const eff = await store.reload("a.ts")
    expect(eff).toEqual({ type: "set", content: "v2-disk" })
    expect(store.get("a.ts")!.baseline.content).toBe("v2-disk")
  })
})

describe("editor store — conflict resolution", () => {
  test("resolve reload discards local and takes disk", async () => {
    const { deps, disk } = fakeDeps({ "a.ts": "v1" })
    const store = createEditorStore(deps)
    await store.open("a.ts")
    disk.set("a.ts", "agent-wrote-this")
    const eff = await store.resolveConflict("a.ts", "my-edits", "reload")
    expect(eff).toEqual({ type: "set", content: "agent-wrote-this" })
    expect(store.get("a.ts")!.conflict).toBe(false)
  })

  test("resolve overwrite re-reads disk hash then forces my content", async () => {
    const { deps, disk } = fakeDeps({ "a.ts": "v1" })
    const store = createEditorStore(deps)
    await store.open("a.ts")
    disk.set("a.ts", "agent-wrote-this") // disk moved on; baseline hash now stale
    const eff = await store.resolveConflict("a.ts", "my-edits", "overwrite")
    expect(eff).toEqual({ type: "none" }) // unformatted save → no reconcile
    expect(disk.get("a.ts")).toBe("my-edits") // mine won
    const e = store.get("a.ts")!
    expect(e.conflict).toBe(false)
    expect(e.baseline.content).toBe("my-edits")
  })
})

describe("editor store — watcher protocol (anti data-loss)", () => {
  test("clean + external change → reload", async () => {
    const { deps, disk } = fakeDeps({ "a.ts": "v1" })
    const store = createEditorStore(deps)
    await store.open("a.ts")
    disk.set("a.ts", "v2")
    const eff = await store.onExternalChange("a.ts")
    expect(eff).toEqual({ type: "set", content: "v2" })
  })

  test("dirty + external change → stale, buffer NEVER touched", async () => {
    const { deps, disk } = fakeDeps({ "a.ts": "v1" })
    const store = createEditorStore(deps)
    await store.open("a.ts")
    store.setDirty("a.ts", true)
    disk.set("a.ts", "agent-edit")
    const eff = await store.onExternalChange("a.ts")
    expect(eff).toEqual({ type: "none" }) // CM doc untouched
    const e = store.get("a.ts")!
    expect(e.stale).toBe(true)
    expect(e.baseline.content).toBe("v1") // baseline not moved → save will 409
  })

  test("saving + external change → ignored (our own write echo)", async () => {
    let resolveWrite: (r: WriteResult) => void = () => {}
    const deps: EditorDeps = {
      async readRaw() {
        return { type: "ok", content: "v1", stamp: { hash: hash("v1") } }
      },
      write: () => new Promise<WriteResult>((r) => (resolveWrite = r)),
    }
    const store = createEditorStore(deps)
    await store.open("a.ts")
    const saving = store.save("a.ts", "x")
    const eff = await store.onExternalChange("a.ts")
    expect(eff).toEqual({ type: "none" })
    expect(store.get("a.ts")!.stale).toBe(false) // not marked stale by our own write
    resolveWrite({ type: "ok", content: "x", stamp: { hash: hash("x") }, formatted: false })
    await saving
  })

  test("external delete → missing, entry kept for recovery", async () => {
    const { deps } = fakeDeps({ "a.ts": "v1" })
    const store = createEditorStore(deps)
    await store.open("a.ts")
    store.setDirty("a.ts", true)
    const eff = store.onExternalDelete("a.ts")
    expect(eff.type).toBe("missing")
    expect(store.get("a.ts")!.missing).toBe(true)
    expect(store.get("a.ts")!.dirty).toBe(true) // edits preserved
  })
})

describe("editor store — close", () => {
  test("close removes the entry", async () => {
    const { deps } = fakeDeps({ "a.ts": "v1" })
    const store = createEditorStore(deps)
    await store.open("a.ts")
    store.close("a.ts")
    expect(store.get("a.ts")).toBeUndefined()
  })
})

describe("editor store — recreate", () => {
  test("saves without expectedHash, clears missing flag on success", async () => {
    const { deps, disk } = fakeDeps() // file doesn't exist on disk
    const store = createEditorStore(deps)
    // Simulate: file was open, then deleted externally.
    await store.open("a.ts") // returns missing
    const eff = await store.recreate("a.ts", "new content")
    expect(eff).toEqual({ type: "none" }) // no format change
    const e = store.get("a.ts")!
    expect(e.missing).toBe(false)
    expect(e.dirty).toBe(false)
    expect(e.baseline.content).toBe("new content")
    expect(disk.get("a.ts")).toBe("new content")
  })

  test("formatted response → returns set effect for CM reconcile", async () => {
    const { deps, setFormat } = fakeDeps()
    setFormat((s) => s.trimEnd() + "\n")
    const store = createEditorStore(deps)
    await store.open("a.ts") // missing → entry flagged
    const eff = await store.recreate("a.ts", "hello  ", true)
    expect(eff).toEqual({ type: "set", content: "hello\n" })
    expect(store.get("a.ts")!.baseline.content).toBe("hello\n")
  })

  test("save already in-flight → returns none immediately", async () => {
    let resolveWrite: (r: WriteResult) => void = () => {}
    const deps: EditorDeps = {
      async readRaw() {
        return { type: "not-found" }
      },
      write: () => new Promise<WriteResult>((r) => (resolveWrite = r)),
    }
    const store = createEditorStore(deps)
    await store.open("a.ts") // missing
    const first = store.recreate("a.ts", "x")
    const second = await store.recreate("a.ts", "x") // in-flight guard
    expect(second).toEqual({ type: "none" })
    resolveWrite({ type: "ok", content: "x", stamp: { hash: hash("x") }, formatted: false })
    await first
  })
})
