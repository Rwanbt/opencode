/* SPDX-License-Identifier: MIT */
/**
 * Example 07: Fake implementations for tests
 *
 * Demonstrates how to use the 6 Unifia core ports with in-memory fake
 * implementations for testing purposes.
 *
 * Run with: bun run examples/07-fake-impl.ts
 */

import type {
  RuntimeAdapter,
  WorkspacePort,
} from "../src/index.js"

// === FakeRuntimeAdapter ===
class FakeRuntimeAdapter implements RuntimeAdapter {
  private sessions: Map<string, any> = new Map()
  async getInfo() {
    return { id: "fake" as const, version: "1.0.0", capabilities: ["*"], healthy: true }
  }
  async listSessions() {
    return Array.from(this.sessions.values())
  }
  async createSession(input: { workspaceId: string }) {
    const s = {
      id: `s_${Date.now()}`,
      workspaceId: input.workspaceId,
      runtimeId: "fake" as const,
      createdAt: Date.now(),
      messageCount: 0,
    }
    this.sessions.set(s.id, s)
    return s
  }
  async sendPrompt(input: { sessionId: string; prompt: string }) {
    const s = this.sessions.get(input.sessionId)
    if (s) s.messageCount++
  }
  async *subscribeEvents(input: { sessionId: string }) {
    yield {
      sessionId: input.sessionId,
      type: "text" as const,
      data: `Echo: ${input.sessionId}`,
      timestamp: Date.now(),
    }
  }
  async cancelSession(id: string) {
    this.sessions.delete(id)
  }
}

// === FakeWorkspacePort ===
class FakeWorkspacePort implements WorkspacePort {
  private files: Map<string, string> = new Map()
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
    return { id, token: "fake-token" }
  }
  async read(_session: string, paths: string[]) {
    return paths.map((p) => ({
      path: p,
      content: this.files.get(p) || "",
      mime: "text/plain",
      size: (this.files.get(p) || "").length,
    }))
  }
  async write(_session: string, writes: any[]) {
    return writes.map((w) => {
      const content = typeof w.content === "string" ? w.content : new TextDecoder().decode(w.content)
      this.files.set(w.path, content)
      return { path: w.path, bytesWritten: content.length, sha: "fake-sha" }
    })
  }
  async create(_session: string, creates: any[]) {
    return creates.map((w) => {
      if (this.files.has(w.path)) throw new Error(`already exists: ${w.path}`)
      const content = typeof w.content === "string" ? w.content : new TextDecoder().decode(w.content)
      this.files.set(w.path, content)
      return { path: w.path, bytesWritten: content.length, sha: "fake-sha" }
    })
  }
  async remove(_session: string, paths: string[]) {
    return paths.map((p) => ({ path: p, removed: this.files.delete(p) }))
  }
  async rename(_session: string, from: string, to: string) {
    const content = this.files.get(from) ?? ""
    this.files.delete(from)
    this.files.set(to, content)
    return { path: to, bytesWritten: content.length, sha: "fake-sha" }
  }
  async list() { return [] }
  async search() { return [] }
  async *watch(_session: string) {
    // No events in fake
  }
  async close(_session: string) {}
}

// === Demo ===
async function main() {
  console.log("=== FakeRuntimeAdapter ===")
  const runtime = new FakeRuntimeAdapter()
  const info = await runtime.getInfo()
  console.log("Info:", info)
  const session = await runtime.createSession({ workspaceId: "test" })
  console.log("Session:", session.id)
  await runtime.sendPrompt({ sessionId: session.id, prompt: "Hello" })
  for await (const event of runtime.subscribeEvents({ sessionId: session.id })) {
    console.log("Event:", event)
    break
  }

  console.log("\n=== FakeWorkspacePort ===")
  const workspace = new FakeWorkspacePort()
  const ws = await workspace.register({ name: "test", path: "/tmp" })
  const handle = await workspace.open(ws.id)
  await workspace.write(handle.id, [{ path: "test.txt", content: "Hello, fake!" }])
  const files = await workspace.read(handle.id, ["test.txt"])
  console.log("Files:", files)

  console.log("\nDone!")
}

main().catch(console.error)
