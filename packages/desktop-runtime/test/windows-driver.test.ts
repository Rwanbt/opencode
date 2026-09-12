/* SPDX-License-Identifier: MIT */
import { strict as assert } from "node:assert"
import { WindowsDesktopDriver } from "../src/windows-driver.ts"
const calls: Array<{ operation: string; appId: string; payload?: unknown }> = []
const driver = new WindowsDesktopDriver(async (operation, target, payload) => { calls.push({ operation, appId: target.appId, payload }); return operation === "observe" ? JSON.stringify({ appId: target.appId, windows: [] }) : "" })
const observed = await driver.observe({ appId: "notepad" }) as { appId: string }
assert.equal(observed.appId, "notepad")
await driver.control({ appId: "notepad", windowId: "Editor" }, "keyboard", { keys: "hello" })
await driver.control({ appId: "notepad", windowId: "Editor" }, "mouse", { x: 1, y: 2, button: "left" })
assert.deepEqual(calls.map((call) => call.operation), ["observe", "keyboard", "mouse"])
console.log("WindowsDesktopDriver: 3/3 passed")
