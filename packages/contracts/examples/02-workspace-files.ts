/* SPDX-License-Identifier: MIT */
/**
 * Example 02: WorkspacePort usage
 *
 * Demonstrates how to use the WorkspacePort for file operations.
 *
 * Run with: bun run examples/02-workspace-files.ts
 */

import type { WorkspacePort, FileReadResult, FileWrite, FileEvent } from "../src/workspace.js"

// === Step 1: In-memory workspace implementation ===
class MemoryWorkspace implements WorkspacePort {
  private files: Map<string, Uint8Array> = new Map()
  private watchers: Map<string, Set<(e: FileEvent) => void>> = new Map()

  async register(input: { name: string; path: string }) {
    return {
      id: `w_${Date.now()}`,
      name: input.name,
      path: input.path,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  }

  async open(id: string) {
    return { id, token: "memory-token" }
  }

  async read(_session: string, paths: string[]): Promise<FileReadResult[]> {
    return paths.map((path) => {
      const content = this.files.get(path) || new Uint8Array()
      return {
        path,
        content,
        mime: "text/plain",
        size: content.length,
      }
    })
  }

  async write(session: string, writes: FileWrite[]) {
    return writes.map((w) => {
      const data = typeof w.content === "string" ? new TextEncoder().encode(w.content) : w.content
      this.files.set(w.path, data)
      // Notify watchers
      const ws = this.watchers.get(session)
      if (ws) {
        const event: FileEvent = {
          type: "modified",
          path: w.path,
          timestamp: Date.now(),
        }
        for (const cb of ws) cb(event)
      }
      return {
        path: w.path,
        bytesWritten: data.length,
        sha: `sha-${Date.now()}`,
      }
    })
  }

  async list() { return [] }
  async search() { return [] }

  async *watch(session: string): AsyncIterable<FileEvent> {
    const callbacks = new Set<(e: FileEvent) => void>()
    this.watchers.set(session, callbacks)
    const queue: FileEvent[] = []
    let resolver: ((e: FileEvent) => void) | null = null

    // Set up callback
    const cb = (e: FileEvent) => {
      if (resolver) {
        resolver(e)
        resolver = null
      } else {
        queue.push(e)
      }
    }
    callbacks.add(cb)

    try {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!
        } else {
          yield await new Promise<FileEvent>((resolve) => {
            resolver = resolve
          })
        }
      }
    } finally {
      callbacks.delete(cb)
    }
  }

  async close(session: string): Promise<void> {
    this.watchers.delete(session)
  }
}

// === Step 2: Use the workspace ===
async function main() {
  const ws = new MemoryWorkspace()

  // Register
  const workspace = await ws.register({ name: "demo", path: "/tmp/demo" })
  console.log("Workspace:", workspace.id)

  // Open
  const handle = await ws.open(workspace.id)
  console.log("Handle:", handle.token)

  // Write files
  await ws.write(handle.id, [
    { path: "hello.txt", content: "Hello, World!" },
    { path: "data.json", content: '{"name": "unifia"}' },
  ])
  console.log("Files written")

  // Read files
  const results = await ws.read(handle.id, ["hello.txt", "data.json"])
  for (const r of results) {
    const text = typeof r.content === "string" ? r.content : new TextDecoder().decode(r.content)
    console.log(`Read ${r.path}: ${text} (${r.size} bytes)`)
  }

  // Watch for changes (in background)
  const watchPromise = (async () => {
    for await (const event of ws.watch(handle.id)) {
      console.log("Watch event:", event)
      break
    }
  })()

  // Trigger a write (will fire the watch event)
  await new Promise((r) => setTimeout(r, 100))
    const update: import("../src/workspace.js").FileWrite = {
    path: "hello.txt",
    content: new TextEncoder().encode("Updated!"),
  }
  await ws.write(handle.id, [update])

  await watchPromise
  await ws.close(handle.id)
  console.log("Done")
}

main().catch(console.error)
