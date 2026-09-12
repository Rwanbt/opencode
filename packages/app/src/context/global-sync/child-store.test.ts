import { describe, expect, test } from "bun:test"
import { createRoot, getOwner } from "solid-js"
import { createStore } from "solid-js/store"
import type { State } from "./types"
import { createChildStoreManager } from "./child-store"

const child = () => createStore({} as State)

function makeOwner() {
  return createRoot((dispose) => {
    const current = getOwner()
    dispose()
    return current
  })
}

describe("createChildStoreManager", () => {
  test("does not evict the active directory during mark", () => {
    const owner = makeOwner()
    if (!owner) throw new Error("owner required")

    const manager = createChildStoreManager({
      owner,
      isBooting: () => false,
      isLoadingSessions: () => false,
      onBootstrap() {},
      onDispose() {},
      translate: (key) => key,
    })

    Array.from({ length: 30 }, (_, index) => `/pinned-${index}`).forEach((directory) => {
      manager.children[directory] = child()
      manager.pin(directory)
    })

    const directory = "/active"
    manager.children[directory] = child()
    manager.mark(directory)

    expect(manager.children[directory]).toBeDefined()
  })

  // C13: server-side dispose notification. When the frontend evicts a
  // directory, the manager calls `onServerDispose(directory)` so the server
  // can drop its lease. This is the hook for `/instance/dispose` from
  // global-sync.tsx.
  test("disposeDirectory calls onServerDispose when eviction succeeds (C13)", () => {
    const owner = makeOwner()
    if (!owner) throw new Error("owner required")
    const onServerDispose = (dir: string) => calls.push(dir)
    const calls: string[] = []

    const manager = createChildStoreManager({
      owner,
      isBooting: () => false,
      isLoadingSessions: () => false,
      onBootstrap() {},
      onDispose() {},
      onServerDispose,
      translate: (key) => key,
    })

    const directory = "/evict-me"
    manager.children[directory] = child()
    const result = manager.disposeDirectory(directory)
    expect(result).toBe(true)
    expect(calls).toEqual([directory])
  })

  // C13: tâche active protégée — when a directory is still booting or
  // loading sessions, disposeDirectory returns false and does NOT call
  // onServerDispose (the server is not notified because the eviction was
  // rejected locally).
  test("disposeDirectory skips onServerDispose when active (C13)", () => {
    const owner = makeOwner()
    if (!owner) throw new Error("owner required")
    const calls: string[] = []

    const manager = createChildStoreManager({
      owner,
      isBooting: () => true, // active
      isLoadingSessions: () => false,
      onBootstrap() {},
      onDispose() {},
      onServerDispose: (dir) => calls.push(dir),
      translate: (key) => key,
    })

    const directory = "/active"
    manager.children[directory] = child()
    const result = manager.disposeDirectory(directory)
    expect(result).toBe(false)
    expect(calls).toEqual([])
    expect(manager.children[directory]).toBeDefined()
  })
})
