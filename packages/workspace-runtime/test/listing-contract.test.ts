/* SPDX-License-Identifier: MIT */

// C1-4/C5-1/FUNC-004: WorkspaceRuntime.list() is paginated (opaque cursor
// bound to workspace + prefix), a missing prefix returns an empty page
// instead of throwing ENOENT, and a symlink/junction escaping the
// workspace root is skipped (counted in `skipped`) instead of aborting the
// whole traversal. Each test builds its own fixture via fs.mkdtemp — no
// dependency on pre-existing machine state.

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect, test } from "bun:test"
import { WorkspaceRuntime } from "../src/index.js"

async function fixture(): Promise<{ root: string; runtime: WorkspaceRuntime; token: string; workspaceId: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "unifia-listing-contract-"))
  const runtime = new WorkspaceRuntime({ now: () => 1_000 })
  const workspace = await runtime.register({ name: "fixture", path: root })
  const handle = await runtime.open(workspace.id)
  return { root, runtime, token: handle.token, workspaceId: workspace.id }
}

test("more than maxEntries files: list() returns a bounded first page instead of throwing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "unifia-listing-contract-"))
  try {
    const bounded = new WorkspaceRuntime({ now: () => 1_000, maxEntries: 50, pageSize: 20 })
    const workspace = await bounded.register({ name: "bounded", path: root })
    const handle = await bounded.open(workspace.id)
    for (let i = 0; i < 80; i += 1) await writeFile(path.join(root, `file-${i}.txt`), String(i))

    let threw: unknown
    let page: Awaited<ReturnType<WorkspaceRuntime["list"]>> | undefined
    try {
      page = await bounded.list(handle.token, ".")
    } catch (error) {
      threw = error
    }
    expect(threw).toBeUndefined()
    expect(page?.entries.length).toBe(20)
    expect(page?.nextCursor).toBeDefined()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("pagination walks the full tree exactly once, in a stable order, across pages", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "unifia-listing-contract-"))
  try {
    const runtime = new WorkspaceRuntime({ now: () => 1_000, pageSize: 7 })
    const workspace = await runtime.register({ name: "paged", path: root })
    const handle = await runtime.open(workspace.id)
    for (let i = 0; i < 23; i += 1) await writeFile(path.join(root, `file-${String(i).padStart(2, "0")}.txt`), String(i))

    const seen: string[] = []
    let cursor: string | undefined
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await runtime.list(handle.token, ".", cursor)
      seen.push(...page.entries.map((entry) => entry.path))
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }
    expect(seen.length).toBe(23)
    expect(new Set(seen).size).toBe(23) // no duplicates
    expect(seen).toEqual([...seen].sort()) // stable, deterministic order

    // Same walk repeated end to end returns the identical sequence.
    const repeat: string[] = []
    let repeatCursor: string | undefined
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await runtime.list(handle.token, ".", repeatCursor)
      repeat.push(...page.entries.map((entry) => entry.path))
      if (!page.nextCursor) break
      repeatCursor = page.nextCursor
    }
    expect(repeat).toEqual(seen)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a cursor is refused against a different workspace or a different prefix", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "unifia-listing-contract-"))
  try {
    await mkdir(path.join(root, "sub"))
    await writeFile(path.join(root, "sub", "a.txt"), "a")
    const paged = new WorkspaceRuntime({ now: () => 1_000, pageSize: 1 })
    const ws = await paged.register({ name: "cursor-scope", path: root })
    const handle = await paged.open(ws.id)
    const first = await paged.list(handle.token, ".")
    expect(first.nextCursor).toBeDefined()

    await expect(paged.list(handle.token, "sub", first.nextCursor)).rejects.toThrow(/cursor is invalid/)

    const otherWorkspaceDir = await mkdtemp(path.join(os.tmpdir(), "unifia-listing-other-"))
    try {
      const otherWs = await paged.register({ name: "other", path: otherWorkspaceDir })
      const otherHandle = await paged.open(otherWs.id)
      await expect(paged.list(otherHandle.token, ".", first.nextCursor)).rejects.toThrow(/cursor is invalid/)
    } finally {
      await rm(otherWorkspaceDir, { recursive: true, force: true })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a non-existent prefix returns an empty page instead of throwing ENOENT", async () => {
  const { runtime, token, root } = await fixture()
  try {
    let threw: unknown
    let page: Awaited<ReturnType<WorkspaceRuntime["list"]>> | undefined
    try {
      page = await runtime.list(token, "does-not-exist")
    } catch (error) {
      threw = error
    }
    expect(threw).toBeUndefined()
    expect(page).toEqual({ entries: [], skipped: 0 })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a symlink escaping the workspace root is skipped and counted, not fatal to the whole listing", async () => {
  const { runtime, token, root } = await fixture()
  const outside = await mkdtemp(path.join(os.tmpdir(), "unifia-listing-outside-"))
  try {
    await writeFile(path.join(root, "inside.txt"), "kept")
    let symlinked = true
    try {
      await symlink(outside, path.join(root, "escape-link"), "dir")
    } catch {
      symlinked = false // no symlink privilege on this machine (Windows without Developer Mode/admin) — covered by the junction case below
    }
    if (symlinked) {
      let threw: unknown
      let page: Awaited<ReturnType<WorkspaceRuntime["list"]>> | undefined
      try {
        page = await runtime.list(token, ".")
      } catch (error) {
        threw = error
      }
      expect(threw).toBeUndefined()
      expect(page?.entries.some((entry) => entry.path === "inside.txt")).toBe(true)
      expect(page?.skipped).toBe(1)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test("a Windows junction escaping the workspace root is skipped and counted, not fatal to the whole listing", async () => {
  if (process.platform !== "win32") return
  const { runtime, token, root } = await fixture()
  const outside = await mkdtemp(path.join(os.tmpdir(), "unifia-listing-outside-"))
  try {
    await mkdir(outside, { recursive: true })
    await writeFile(path.join(root, "inside.txt"), "kept")
    await symlink(outside, path.join(root, "escape-junction"), "junction")

    let threw: unknown
    let page: Awaited<ReturnType<WorkspaceRuntime["list"]>> | undefined
    try {
      page = await runtime.list(token, ".")
    } catch (error) {
      threw = error
    }
    expect(threw).toBeUndefined()
    expect(page?.entries.some((entry) => entry.path === "inside.txt")).toBe(true)
    expect(page?.skipped).toBe(1)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test("excluded directory names (node_modules, .git, dist, build) are neither listed nor descended into", async () => {
  const { runtime, token, root } = await fixture()
  try {
    await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true })
    await writeFile(path.join(root, "node_modules", "pkg", "index.js"), "")
    await writeFile(path.join(root, "kept.txt"), "kept")

    const page = await runtime.list(token, ".")
    expect(page.entries.some((entry) => entry.path.startsWith("node_modules"))).toBe(false)
    expect(page.entries.some((entry) => entry.path === "kept.txt")).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
