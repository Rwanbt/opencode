import { describe, expect, test } from "bun:test"
import { createEditorStore, type EditorDeps, type WriteResult } from "./store"
import { createScopeEpochTracker } from "../file/scope-epoch"

const hash = (value: string) => `h:${value}`

describe("corrective race proofs", () => {
  test("F5 keeps a real conflict visible while overwrite races with saving", async () => {
    let writeCalls = 0
    let resolveSecondWrite: (result: WriteResult) => void = () => {}
    const disk = new Map([["a.ts", "v1"]])
    const deps: EditorDeps = {
      async readRaw(path) {
        const content = disk.get(path)
        if (content === undefined) return { type: "not-found" }
        return { type: "ok", content, stamp: { hash: hash(content) } }
      },
      write: async ({ path, content }) => {
        writeCalls += 1
        if (writeCalls === 1) return { type: "conflict" }
        await new Promise<WriteResult>((resolve) => (resolveSecondWrite = resolve))
        disk.set(path, content)
        return { type: "ok", content, stamp: { hash: hash(content) }, formatted: false }
      },
    }
    const store = createEditorStore(deps)
    await store.open("a.ts")
    disk.set("a.ts", "external")
    store.setDirty("a.ts", true)
    expect(await store.save("a.ts", "mine")).toEqual({ type: "conflict" })
    expect(store.get("a.ts")!.conflict).toBe(true)

    const saving = store.save("a.ts", "autosave")
    expect(store.get("a.ts")!.saving).toBe(true)
    const baseline = store.get("a.ts")!.baseline
    expect(await store.resolveConflict("a.ts", "overwrite", "overwrite")).toEqual({ type: "busy" })
    expect(store.get("a.ts")!.conflict).toBe(true)
    expect(store.get("a.ts")!.baseline).toEqual(baseline)

    resolveSecondWrite({ type: "ok", content: "autosave", stamp: { hash: hash("autosave") }, formatted: false })
    await saving
  })

  test("F8 rejects an old A response after the new A response already applied", () => {
    const tracker = createScopeEpochTracker()
    const applied: string[] = []
    const oldEpoch = tracker.capture()
    tracker.bump()
    tracker.bump()
    const newEpoch = tracker.capture()
    const applyIfCurrent = (epoch: number, value: string) => {
      if (tracker.isCurrent(epoch)) applied.push(value)
    }

    applyIfCurrent(newEpoch, "new-A")
    applyIfCurrent(oldEpoch, "old-A")
    expect(applied).toEqual(["new-A"])
  })
})
