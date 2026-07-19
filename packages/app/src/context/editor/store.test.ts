import { test, expect, describe } from "bun:test"
import { createEditorStore, type EditorDeps, type WriteResult } from "./store"
import { createFileStore } from "../file/store"

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

  test("already-open re-reads disk (no stale baseline)", async () => {
    const { deps, disk } = fakeDeps({ "a.ts": "v1" })
    const store = createEditorStore(deps)
    await store.open("a.ts")
    disk.set("a.ts", "changed-on-disk")
    const eff = await store.open("a.ts")
    expect(eff).toEqual({ type: "set", content: "changed-on-disk" })
    expect(store.get("a.ts")!.baseline.content).toBe("changed-on-disk")
  })

  test("save → close → reopen returns fresh disk content", async () => {
    // Regression for the bug where saving, closing, then reopening a file
    // showed the pre-modification baseline instead of the saved bytes.
    // Root cause was the existing && !existing.missing short-circuit in
    // editor.open() returning a cached baseline without re-reading disk.
    const { deps, disk } = fakeDeps({ "a.ts": "v1" })
    const store = createEditorStore(deps)
    await store.open("a.ts")
    store.setDirty("a.ts", true)
    await store.save("a.ts", "v2-after-save")
    store.close("a.ts")
    const eff = await store.open("a.ts")
    expect(eff).toEqual({ type: "set", content: "v2-after-save" })
    expect(disk.get("a.ts")).toBe("v2-after-save")
    expect(store.get("a.ts")!.baseline.content).toBe("v2-after-save")
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

  test("save while a save is in flight returns busy (guard) — FORK C11: distinct from a real no-op success", async () => {
    // Regression for PLAN-READONLY-VIEWER-REACTIVITY C11: this guard used to
    // return the same {type:"none"} as a successful save with no CM
    // mutation, so callers (editor-panel.tsx's handleCtrlS) couldn't tell a
    // busy no-op apart from an actual success and exited edit mode as if the
    // save had happened. "busy" is the type the guard returns now — nothing
    // was attempted, the caller must not treat it as saved.
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
    expect(second).toEqual({ type: "busy" }) // nothing attempted while saving
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

  // FORK (Phase 3.5, PLAN-EDITEUR-IDE-DEFINITIF): revert is the public
  // alias for reload used by the "Revert File" command palette entry.
  // The contract: dirty edits are dropped, disk content becomes the new
  // baseline, FileStore mirrors to status="clean" + new stamp.
  test("revert discards dirty edits and re-reads disk (idempotent)", async () => {
    const { deps, disk } = fakeDeps({ "a.ts": "v1" })
    const fileStore = createFileStore()
    const store = createEditorStore({ ...deps, fileStore })

    fileStore.markClean("a.ts", "v1", { hash: hash("v1") })
    await store.open("a.ts")
    store.setDirty("a.ts", true)
    expect(store.get("a.ts")!.dirty).toBe(true)
    expect(fileStore.get("a.ts")!.status).toBe("dirty")

    // External write happens between edit and revert.
    disk.set("a.ts", "v2-disk")

    const eff = await store.revert("a.ts")
    expect(eff).toEqual({ type: "set", content: "v2-disk" })
    expect(store.get("a.ts")!.dirty).toBe(false)
    expect(store.get("a.ts")!.baseline.content).toBe("v2-disk")
    expect(fileStore.get("a.ts")!.status).toBe("clean")
    expect(fileStore.get("a.ts")!.content).toBe("v2-disk")

    // Idempotent: a second revert with no new disk changes returns the
    // same baseline (the CM setContent guard makes this a no-op visually).
    const eff2 = await store.revert("a.ts")
    expect(eff2).toEqual({ type: "set", content: "v2-disk" })
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

  // FORK (CORRECTIF F5, 2026-07-19): resolveConflict("overwrite") used to
  // clear the conflict flag and rebase the baseline unconditionally, BEFORE
  // calling save() — if a concurrent save was already in flight (autosave
  // racing the user's "Overwrite disk" click), save() would return "busy"
  // but the conflict banner had already vanished and the baseline had
  // already been silently rebased to disk content that was never actually
  // reconciled with the user's edits.
  test("resolve overwrite while a save is already in flight → busy, WITHOUT touching conflict/baseline (F5)", async () => {
    let resolveWrite: (r: WriteResult) => void = () => {}
    const disk = new Map<string, string>([["a.ts", "v1"]])
    const deps: EditorDeps = {
      async readRaw(path) {
        return { type: "ok", content: disk.get(path)!, stamp: { hash: hash(disk.get(path)!) } }
      },
      write: () => new Promise<WriteResult>((resolve) => (resolveWrite = resolve)),
    }
    const store = createEditorStore(deps)
    await store.open("a.ts")
    disk.set("a.ts", "agent-wrote-this") // disk moved on — this is the conflict
    store.setDirty("a.ts", true)

    // Put the entry into "saving" via an unrelated in-flight save (mirrors
    // an autosave racing the user's overwrite click).
    const inFlight = store.save("a.ts", "v2-in-flight")
    expect(store.get("a.ts")!.saving).toBe(true)

    const eff = await store.resolveConflict("a.ts", "my-edits", "overwrite")

    // Must report busy WITHOUT ever calling deps.readRaw's follow-up state
    // mutation — conflict must stay whatever it already was (this entry was
    // opened via open(), which doesn't set conflict, so it starts false;
    // the point is baseline must NOT have been rebased to "agent-wrote-this").
    expect(eff).toEqual({ type: "busy" })
    expect(store.get("a.ts")!.baseline.content).toBe("v1")

    resolveWrite({ type: "ok", content: "v2-in-flight", stamp: { hash: hash("v2-in-flight") }, formatted: false })
    await inFlight
  })

  test("resolve overwrite: saving flag re-checked after the readRaw await (race window closed)", async () => {
    // A save() that starts WHILE resolveConflict's readRaw is in flight must
    // still be caught — the pre-await guard alone would miss it, since
    // resolveConflict's saving check ran before this save() existed.
    const disk = new Map<string, string>([["a.ts", "v1"]])
    const deps: EditorDeps = {
      async readRaw(path) {
        return { type: "ok", content: disk.get(path)!, stamp: { hash: hash(disk.get(path)!) } }
      },
      write: () => new Promise<WriteResult>(() => {}), // never resolves — save stays in flight
    }
    const store = createEditorStore(deps)
    await store.open("a.ts")
    store.setDirty("a.ts", true)

    const resolvePromise = store.resolveConflict("a.ts", "my-edits", "overwrite")
    // Race a save() in right after resolveConflict has started (both are
    // microtask-driven off the same readRaw()); by the time resolveConflict's
    // readRaw resolves, this save should already have claimed "saving".
    store.save("a.ts", "v2-race") // never awaited — write() never resolves by design
    expect(store.get("a.ts")!.saving).toBe(true)

    const eff = await resolvePromise
    expect(eff).toEqual({ type: "busy" })
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

  test("recreate already in-flight → returns busy immediately (FORK C11)", async () => {
    // See the equivalent save() guard test above — "busy" (not "none") so a
    // caller can't mistake an in-flight no-op for a completed recreate.
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
    expect(second).toEqual({ type: "busy" })
    resolveWrite({ type: "ok", content: "x", stamp: { hash: hash("x") }, formatted: false })
    await first
  })
})

describe("editor store — error resilience (network/SDK exceptions)", () => {
  const throwingReadRaw: EditorDeps = {
    async readRaw() {
      throw new Error("network error")
    },
    async write() {
      return { type: "ok", content: "", stamp: { hash: "h" }, formatted: false }
    },
  }

  const throwingWrite: EditorDeps = {
    async readRaw() {
      return { type: "ok", content: "v1", stamp: { hash: hash("v1") } }
    },
    async write() {
      throw new Error("network error")
    },
  }

  test("open() with throwing readRaw sets missing and returns missing", async () => {
    const store = createEditorStore(throwingReadRaw)
    const eff = await store.open("a.ts")
    expect(eff.type).toBe("missing")
    expect(store.get("a.ts")!.missing).toBe(true)
  })

  test("save() with throwing write surfaces an error and clears saving flag", async () => {
    const store = createEditorStore(throwingWrite)
    await store.open("a.ts")
    const eff = await store.save("a.ts", "new content")
    // FORK (fix 8948c02909): a failed transport must surface as "error", not a
    // silent "none" that shows the user a "Saved" toast over an unwritten file.
    expect(eff).toEqual({ type: "error" })
    expect(store.get("a.ts")!.saving).toBe(false)
  })

  test("reload() with throwing readRaw returns missing", async () => {
    let shouldThrow = false
    const store = createEditorStore({
      async readRaw() {
        if (shouldThrow) throw new Error("network error")
        return { type: "ok", content: "v1", stamp: { hash: hash("v1") } }
      },
      async write() {
        return { type: "ok", content: "", stamp: { hash: "h" }, formatted: false }
      },
    })
    await store.open("a.ts")
    shouldThrow = true
    const eff = await store.reload("a.ts")
    expect(eff.type).toBe("missing")
    expect(store.get("a.ts")!.missing).toBe(true)
  })

  test("resolveConflict() with throwing readRaw clears conflict", async () => {
    const store = createEditorStore({
      async readRaw(path) {
        if (path === "a.ts" && store.get("a.ts")) throw new Error("network error")
        return { type: "ok", content: "v1", stamp: { hash: hash("v1") } }
      },
      async write() {
        return { type: "ok", content: "v1", stamp: { hash: hash("v1") }, formatted: false }
      },
    })
    await store.open("a.ts")
    const eff = await store.resolveConflict("a.ts", "mine", "overwrite")
    expect(eff.type).toBe("missing")
    expect(store.get("a.ts")!.conflict).toBe(false)
    expect(store.get("a.ts")!.missing).toBe(true)
  })

  test("recreate() with throwing write returns error, clears saving, stays missing (CORRECTIF F3)", async () => {
    // Was {type:"none"} — a silent success asymmetric with save()'s catch.
    // A transport failure proves nothing about disk state; markClean must
    // never be reachable from this path.
    const store = createEditorStore({
      async readRaw() {
        return { type: "not-found" }
      },
      async write() {
        throw new Error("network error")
      },
    })
    await store.open("a.ts")
    const eff = await store.recreate("a.ts", "content")
    expect(eff).toEqual({ type: "error" })
    expect(store.get("a.ts")!.saving).toBe(false)
    expect(store.get("a.ts")!.missing).toBe(true)
  })
})
