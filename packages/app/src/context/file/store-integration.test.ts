import { test, expect, describe } from "bun:test"
import { createFileStore } from "./store"
import { createEditorStore, type EditorDeps, type WriteResult } from "../editor/store"

// Integration test for Phase 2.4g (PLAN-EDITEUR-IDE-DEFINITIF R1). After the
// viewer (file.tsx) and the editor (editor/store.ts) both mirror into the
// shared FileStore, the open→edit→save→close→reopen loop MUST guarantee
// `disk ≡ FileStore.content ≡ editor.baseline.content` at every stable point.
//
// The test does NOT exercise the Solid context wrapper or the SDK — only the
// two pure stores wired together against an in-memory fake disk. Real-world
// reactivity / SDK are covered by the app-level E2E suite, not here.

const hash = (s: string) => `h:${s.length}:${s}`

function fakeDeps(initial: Record<string, string> = {}): {
  deps: EditorDeps
  disk: Map<string, string>
  simulateDiskWrite: (path: string, content: string) => void
} {
  const disk = new Map<string, string>(Object.entries(initial))

  const deps: EditorDeps = {
    async readRaw(p) {
      if (!disk.has(p)) return { type: "not-found" }
      const content = disk.get(p)!
      return { type: "ok", content, stamp: { hash: hash(content) } }
    },
    async write({ path: p, content, expectedHash }): Promise<WriteResult> {
      const exists = disk.has(p)
      if (exists && expectedHash !== undefined && hash(disk.get(p)!) !== expectedHash) {
        return { type: "conflict" }
      }
      disk.set(p, content)
      return { type: "ok", content, stamp: { hash: hash(content) }, formatted: false }
    },
  }

  return {
    deps,
    disk,
    // WHY: an external writer (agent, git pull, second IDE) does not go
    // through EditorDeps.write — it just lands on disk. The viewer/editor
    // watcher must observe it via readRaw.
    simulateDiskWrite: (p, content) => {
      disk.set(p, content)
    },
  }
}

describe("file store + editor store — open/edit/save/close/reopen loop", () => {
  test("disk ≡ FileStore.content ≡ editor.baseline at every stable point", async () => {
    const { deps, disk } = fakeDeps({ "a.ts": "v1" })
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })

    // 1. open — viewer (mock) populates FileStore; editor.open seeds baseline.
    fileStore.markClean("a.ts", "v1", { hash: hash("v1") })
    const openEff = await editor.open("a.ts")
    expect(openEff).toEqual({ type: "set", content: "v1" })
    expect(fileStore.get("a.ts")!.content).toBe("v1")
    expect(editor.get("a.ts")!.baseline.content).toBe("v1")

    // 2. edit — CM reports dirty → editor mirrors markDirty.
    editor.setDirty("a.ts", true)
    expect(editor.get("a.ts")!.dirty).toBe(true)
    expect(fileStore.get("a.ts")!.status).toBe("dirty")

    // 3. save — write succeeds → both stores return to clean.
    const saveEff = await editor.save("a.ts", "v2")
    expect(saveEff.type).toBe("none")
    expect(disk.get("a.ts")).toBe("v2")
    expect(editor.get("a.ts")!.dirty).toBe(false)
    expect(editor.get("a.ts")!.baseline.content).toBe("v2")
    expect(fileStore.get("a.ts")!.status).toBe("clean")
    expect(fileStore.get("a.ts")!.content).toBe("v2")

    // 4. close — editor removes entry, FileStore mirrors via close().
    editor.close("a.ts")
    expect(editor.get("a.ts")).toBeUndefined()
    expect(fileStore.get("a.ts")).toBeUndefined()

    // 5. reopen — viewer re-loads disk content; editor seeds fresh baseline.
    const diskAfter = disk.get("a.ts")!
    fileStore.markClean("a.ts", diskAfter, { hash: hash(diskAfter) })
    const reopenEff = await editor.open("a.ts")
    expect(reopenEff).toEqual({ type: "set", content: "v2" })
    expect(fileStore.get("a.ts")!.content).toBe("v2")
    expect(editor.get("a.ts")!.baseline.content).toBe("v2")
  })

  test("external disk write while editor is clean → both stores reload", async () => {
    const { deps, disk, simulateDiskWrite } = fakeDeps({ "a.ts": "v1" })
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })

    fileStore.markClean("a.ts", "v1", { hash: hash("v1") })
    await editor.open("a.ts")

    // Agent writes externally (not through editor.save).
    simulateDiskWrite("a.ts", "agent-v2")
    disk.set("a.ts", "agent-v2")

    // editor.onExternalChange on a clean buffer → reload → markClean.
    const eff = await editor.onExternalChange("a.ts")
    expect(eff).toEqual({ type: "set", content: "agent-v2" })
    expect(editor.get("a.ts")!.baseline.content).toBe("agent-v2")
    expect(fileStore.get("a.ts")!.content).toBe("agent-v2")
    expect(fileStore.get("a.ts")!.status).toBe("clean")
  })

  test("external disk write while editor is dirty → conflict sticky in FileStore", async () => {
    const { deps, simulateDiskWrite } = fakeDeps({ "a.ts": "v1" })
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })

    fileStore.markClean("a.ts", "v1", { hash: hash("v1") })
    await editor.open("a.ts")
    editor.setDirty("a.ts", true)
    expect(fileStore.get("a.ts")!.status).toBe("dirty")

    // Agent writes externally while the user has unsaved edits.
    simulateDiskWrite("a.ts", "agent-v2")

    // editor.onExternalChange on a dirty buffer → mark stale + markConflict.
    // The conflict MUST NOT be cleared by a subsequent viewer re-read.
    const eff = await editor.onExternalChange("a.ts")
    expect(eff).toEqual({ type: "none" })
    expect(editor.get("a.ts")!.stale).toBe(true)
    expect(fileStore.get("a.ts")!.status).toBe("conflict")

    // Viewer attempts a re-read (file.load(force:true)) — guard from 2.4d
    // must keep the conflict sticky. Replay the file.tsx guard here.
    const fs = fileStore.get("a.ts")
    const guarded = fs?.status === "conflict" ? null : fs
    expect(guarded).toBeNull() // guard skips the overwrite
    expect(fileStore.get("a.ts")!.status).toBe("conflict")
  })

  test("save hits 409 → FileStore markConflict; resolveConflict('reload') → clean", async () => {
    // WHY: stale + conflict surface together. After a 409 the user's save
    // is rejected; the editor stays on its baseline but flags conflict. The
    // viewer must continue to render the disk content (not the baseline) so
    // the user can see what to discard/overwrite against.
    const disk = new Map<string, string>(Object.entries({ "a.ts": "v1" }))
    const deps: EditorDeps = {
      async readRaw(p) {
        const content = disk.get(p)
        if (content === undefined) return { type: "not-found" }
        return { type: "ok", content, stamp: { hash: hash(content) } }
      },
      async write({ path: p, content: next, expectedHash }) {
        const exists = disk.has(p)
        if (exists && expectedHash !== undefined && hash(disk.get(p)!) !== expectedHash) {
          return { type: "conflict" }
        }
        disk.set(p, next)
        return { type: "ok", content: next, stamp: { hash: hash(next) }, formatted: false }
      },
    }
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })

    fileStore.markClean("a.ts", "v1", { hash: hash("v1") })
    await editor.open("a.ts")
    editor.setDirty("a.ts", true)

    // Disk gets a concurrent write with a different hash → expectedHash mismatches.
    disk.set("a.ts", "external-v2")

    const eff = await editor.save("a.ts", "user-v2")
    expect(eff).toEqual({ type: "conflict" })
    expect(fileStore.get("a.ts")!.status).toBe("conflict")

    // User picks "reload" — fetch disk, seed baseline, markClean.
    const reloadEff = await editor.resolveConflict("a.ts", "user-v2", "reload")
    expect(reloadEff).toEqual({ type: "set", content: "external-v2" })
    expect(fileStore.get("a.ts")!.status).toBe("clean")
    expect(fileStore.get("a.ts")!.content).toBe("external-v2")
  })
})