/* SPDX-License-Identifier: MIT */
import { strict as assert } from "node:assert"
import { InMemoryMemoryStore, MemoryRuntime } from "../src/index.ts"
const store = new InMemoryMemoryStore()
const memory = new MemoryRuntime(store, { promptInjectionEnabled: false, maxRecordsPerWorkspace: 2, maxContentLength: 100 }, () => 1_000)
await memory.remember({ workspaceId: "ws", content: "architecture decision", source: "user", tags: ["architecture"], id: "m1" })
assert.equal(await memory.promptContext({ workspaceId: "ws" }), "")
assert.equal((await memory.search({ workspaceId: "ws", text: "decision" })).length, 1)
assert.equal(await memory.remove("ws", "m1"), true)
assert.equal((await memory.search({ workspaceId: "ws" })).length, 0)
console.log("MemoryRuntime: 4/4 passed")
