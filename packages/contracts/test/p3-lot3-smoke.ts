/* SPDX-License-Identifier: MIT */
import assert from "node:assert/strict"
import { P3_CAPABILITIES, P3_CAPABILITY_EFFECTS, PolicyEngineDouble, TaintTrackerDouble } from "../src/p3.ts"
const engine = new PolicyEngineDouble()
let passed = 0
function test(name: string, run: () => void) { run(); passed++; console.log(`PASS ${name}`) }
function deny(value: { kind: string; ruleId: string }, ruleId: string) { assert.equal(value.kind, "deny"); assert.equal(value.ruleId, ruleId) }

// WHY derived instead of a hardcoded count: the assertion used to require
// exactly 14 capabilities and went stale the moment workflow.run was added for
// Phase 14, while the effect table was updated correctly. The invariant that
// matters is that the two stay in bijection, not how many entries there are.
test("C1-capability-effect-table-complete", () => {
  for (const capability of P3_CAPABILITIES) assert.ok(P3_CAPABILITY_EFFECTS[capability], `capability without an effect entry: ${capability}`)
  const declared = new Set<string>(P3_CAPABILITIES)
  for (const capability of Object.keys(P3_CAPABILITY_EFFECTS)) assert.ok(declared.has(capability), `effect entry without a declared capability: ${capability}`)
  assert.equal(Object.keys(P3_CAPABILITY_EFFECTS).length, P3_CAPABILITIES.length)
})
test("C2-taint-veto", () => { const tracker = new TaintTrackerDouble(); tracker.recordSecretRead(); assert.equal(tracker.isTainted(), true); deny(engine.evaluate({ capabilities: ["secret.read", "network.request"], tainted: tracker.isTainted() }), "C2-taint-veto") })
test("C2-desktop-secret-deny", () => deny(engine.evaluate({ capabilities: ["desktop.control", "secret.read"] }), "C2-taint-veto"))
test("C2-remote-terminal-deny", () => deny(engine.evaluate({ capabilities: ["remote.receive", "terminal.run"] }), "C2-remote-terminal"))
test("C2-package-desktop-deny", () => deny(engine.evaluate({ capabilities: ["package.install", "desktop.control"] }), "C2-package-desktop"))
test("C2-global-read-network-deny", () => deny(engine.evaluate({ capabilities: ["workspace.read", "network.request"], resource: "global" }), "C2-global-read-network"))
test("C2-browser-cookie-network-deny", () => deny(engine.evaluate({ capabilities: ["browser.cookies", "network.request"] }), "C2-browser-cookie-network"))
test("C2-unknown-capability-deny", () => deny(engine.evaluate({ capabilities: ["unknown.capability"] }), "C2-unknown-capability"))
assert.equal(passed, 8)
console.log(`P3 Lot 3 foundation: ${passed}/8 passed`)
import { BrowserAutomationBroker, DesktopAutomationBroker, EmergencyStop } from "../src/index.ts"
const driver = { navigate: async () => {}, snapshot: async () => ({ redacted: true }), screenshot: async () => new Uint8Array(), quarantineDownload: async (_p: unknown, filename: string) => `quarantine/${filename}` }
const browser = new BrowserAutomationBroker(driver, ["example.com"])
await browser.navigate("ws-1", "https://example.com/home")
let browserDenied = false; try { await browser.navigate("ws-1", "https://evil.example") } catch { browserDenied = true }; if (!browserDenied) throw new Error("browser host allowlist failed")
const desktop = new DesktopAutomationBroker({ observe: async () => ({ redacted: true }), control: async () => {} }, ["allowed-app"])
await desktop.observe({ appId: "allowed-app" }); let desktopDenied = false; try { await desktop.control({ appId: "other-app" }, "mouse", {}) } catch { desktopDenied = true }; if (!desktopDenied) throw new Error("desktop app allowlist failed")
console.log("BrowserDesktopBroker: 4/4 passed")

const stop = new EmergencyStop()
const stoppable = new DesktopAutomationBroker({ observe: async () => ({}), control: async () => {} }, ["allowed-app"], undefined, stop)
stop.engage(); let stopped = false; try { await stoppable.observe({ appId: "allowed-app" }) } catch { stopped = true }; if (!stopped) throw new Error("emergency stop did not block desktop observation")
console.log("EmergencyStop: 1/1 passed")