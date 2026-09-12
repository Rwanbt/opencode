/* SPDX-License-Identifier: MIT */
/**
 * Example 01: Basic RuntimeAdapter usage
 *
 * Demonstrates how to implement and use the RuntimeAdapter interface.
 *
 * Run with: bun run examples/01-runtime-basic.ts
 */

import type { RuntimeAdapter, RuntimeInfo, Session, RuntimeEvent } from "../src/runtime.js"

// === Step 1: Define a custom runtime ===
class CustomRuntime implements RuntimeAdapter {
  private sessions: Map<string, Session> = new Map()

  async getInfo(): Promise<RuntimeInfo> {
    return {
      id: "unifia",
      version: "1.0.0",
      capabilities: ["file.read", "file.write", "code.generate"],
      healthy: true,
    }
  }

  async listSessions(): Promise<Session[]> {
    return Array.from(this.sessions.values())
  }

  async createSession(input: { workspaceId: string }): Promise<Session> {
    const session: Session = {
      id: `s_${Date.now()}`,
      workspaceId: input.workspaceId,
      runtimeId: "unifia",
      createdAt: Date.now(),
      messageCount: 0,
    }
    this.sessions.set(session.id, session)
    return session
  }

  async sendPrompt(input: { sessionId: string; prompt: string }): Promise<void> {
    const session = this.sessions.get(input.sessionId)
    if (!session) throw new Error("Session not found")
    session.messageCount++
  }

  async *subscribeEvents(input: { sessionId: string }): AsyncIterable<RuntimeEvent> {
    // Simulate events
    yield {
      sessionId: input.sessionId,
      type: "text",
      data: "Hello from custom runtime",
      timestamp: Date.now(),
    }
  }

  async cancelSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId)
  }
}

// === Step 2: Use the runtime ===
async function main() {
  const runtime = new CustomRuntime()

  // Get info
  const info = await runtime.getInfo()
  console.log("Runtime info:", info)

  // Create session
  const session = await runtime.createSession({ workspaceId: "my-project" })
  console.log("Created session:", session.id)

  // Send prompt
  await runtime.sendPrompt({ sessionId: session.id, prompt: "Hello!" })
  console.log("Prompt sent")

  // Subscribe to events
  for await (const event of runtime.subscribeEvents({ sessionId: session.id })) {
    console.log("Event:", event)
    break // Just first event for demo
  }

  // Cleanup
  await runtime.cancelSession(session.id)
  console.log("Session cancelled")
}

main().catch(console.error)
