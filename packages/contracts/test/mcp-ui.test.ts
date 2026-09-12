/* SPDX-License-Identifier: MIT */
import { strict as assert } from "node:assert"
import { McpUiControlBroker } from "../src/mcp-ui.ts"
const broker = new McpUiControlBroker({ inspect: async (componentId) => ({ componentId, visible: true }), execute: async () => ({}) }, ["panel-main"], { request: () => ({ id: "approval-ui-1" }) })
assert.equal((await broker.execute({ id: "inspect-1", componentId: "panel-main", kind: "inspect" })).status, "accepted")
assert.equal((await broker.execute({ id: "click-1", componentId: "panel-main", kind: "click" })).status, "pending-approval")
assert.equal((await broker.execute({ id: "bad.id", componentId: "panel-main", kind: "inspect" })).status, "denied")
assert.equal((await broker.execute({ id: "inspect-2", componentId: "unknown", kind: "inspect" })).status, "denied")
console.log("McpUiControlBroker: 4/4 passed")
