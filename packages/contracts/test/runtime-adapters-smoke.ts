/* SPDX-License-Identifier: MIT */
import { strict as assert } from "node:assert"
import { FakeRuntimeAdapter, OpenCodeRuntimeAdapter, UnifiaRuntimeAdapter, type OpenCodeRuntimeBackend } from "../src/runtime-adapters.ts"
const test = async (name: string, run: () => Promise<void>) => { await run(); console.log(`PASS ${name}`) }
await test("runtime-info-is-healthy", async () => { const runtime = new FakeRuntimeAdapter(() => 10); assert.deepEqual(await runtime.getInfo(), { id: "fake", version: "p3-contract-test", capabilities: [], healthy: true }) })
await test("session-is-scoped-and-prompt-emits-event", async () => { const runtime = new FakeRuntimeAdapter(() => 10); const session = await runtime.createSession({ workspaceId: "workspace-a" }); const other = await runtime.createSession({ workspaceId: "workspace-b" }); assert.equal((await runtime.listSessions({ workspaceId: "workspace-a" })).length, 1); const events = runtime.subscribeEvents({ sessionId: session.id })[Symbol.asyncIterator](); await runtime.sendPrompt({ sessionId: session.id, prompt: "hello" }); assert.deepEqual(await events.next(), { done: false, value: { sessionId: session.id, type: "text", data: "hello", timestamp: 10, sequence: 1 } }); assert.equal((await runtime.listSessions({ workspaceId: "workspace-b" }))[0].id, other.id) })
await test("cancel-closes-event-stream-and-rejects-prompt", async () => { const runtime = new FakeRuntimeAdapter(); const session = await runtime.createSession({ workspaceId: "workspace-a" }); const events = runtime.subscribeEvents({ sessionId: session.id })[Symbol.asyncIterator](); await runtime.cancelSession(session.id); assert.deepEqual(await events.next(), { done: true, value: undefined }); await assert.rejects(runtime.sendPrompt({ sessionId: session.id, prompt: "late" }), /session-cancelled/) })
await test("opencode-adapter-delegates-through-backend", async () => {
  const fake = new FakeRuntimeAdapter(() => 20)
  const backend: OpenCodeRuntimeBackend = {
    listSessions: (workspaceId) => fake.listSessions({ workspaceId }),
    createSession: (workspaceId) => fake.createSession({ workspaceId }),
    sendPrompt: (input) => fake.sendPrompt(input),
    subscribeEvents: (sessionId) => fake.subscribeEvents({ sessionId }),
    cancelSession: (sessionId) => fake.cancelSession(sessionId),
  }
  const runtime = new OpenCodeRuntimeAdapter(backend, "1.0-test")
  assert.deepEqual(await runtime.getInfo(), { id: "opencode", version: "1.0-test", capabilities: [], healthy: true })
  const session = await runtime.createSession({ workspaceId: "workspace-a" })
  assert.equal((await runtime.listSessions({ workspaceId: "workspace-a" }))[0].id, session.id)
})
console.log("Runtime adapter: 4/4 passed")
await test("unifia-adapter-delegates-through-backend", async () => {
  const backend = { listSessions: async () => [], createSession: async (workspaceId: string) => ({ id: "u-1", workspaceId, runtimeId: "unifia" as const, createdAt: 1, messageCount: 0 }), sendPrompt: async () => {}, subscribeEvents: () => ({ [Symbol.asyncIterator]: async function* () {} }), cancelSession: async () => {} }
  const runtime = new UnifiaRuntimeAdapter(backend, "test")
  assert.equal((await runtime.getInfo()).id, "unifia")
  assert.equal((await runtime.createSession({ workspaceId: "ws" })).workspaceId, "ws")
})