/* SPDX-License-Identifier: MIT */
import { renderGenerativeUi } from "@unifia/contracts"
import {
  CRITICAL_ACTIONS,
  McpUiActionRegistry,
  V1_ACTIONS,
  generativeUiAllowlist,
  isCritical,
  originMayReachCritical,
  type UiActionOutcome,
  type UiActionRequest,
  type UiOrigin,
} from "../src/index.js"

let checks = 0
const check = (condition: boolean, message: string): void => {
  checks += 1
  if (!condition) throw new Error(message)
}
const refusedFor = (outcome: UiActionOutcome, reason: string, message: string): void => {
  checks += 1
  if (outcome.status !== "refused" || outcome.refusal.reason !== reason) {
    throw new Error(`${message} (got ${outcome.status === "refused" ? outcome.refusal.reason : "allowed"})`)
  }
}

const audited: Array<{ action: string; outcome: string; detail: string }> = []
const shown: string[] = []
const approvalsAsked: string[] = []
let grantApproval = true
let hasCapability = true
let killSwitch = false

const registry = new McpUiActionRegistry({
  capabilities: { has: () => hasCapability },
  approval: { request: (action) => { approvalsAsked.push(action); return { id: `appr-${approvalsAsked.length}`, granted: grantApproval } } },
  confirmation: { show: (action) => { shown.push(action); return true } },
  audit: { record: (action, outcome, detail) => audited.push({ action, outcome, detail }) },
  switches: { isEngaged: () => killSwitch },
})

const shell: UiOrigin = { kind: "shell" }
const request = (over: Partial<UiActionRequest> = {}): UiActionRequest => ({ action: "session.create", origin: shell, workspaceId: "ws-1", ...over })

// --- The action lists match the plan -------------------------------------------
check(V1_ACTIONS.length === 11, `the V1 list holds ${V1_ACTIONS.length} actions instead of 11`)
check(CRITICAL_ACTIONS.length === 7, `the critical list holds ${CRITICAL_ACTIONS.length} actions instead of 7`)
for (const action of ["workspace.open", "workspace.switch", "session.create", "session.open", "composer.setText", "composer.send", "artifact.open", "artifact.create", "capability.search", "workflow.run", "approval.show"]) {
  check((V1_ACTIONS as readonly string[]).includes(action), `V1 action from the plan is missing: ${action}`)
}
for (const action of ["desktop.control", "remote.pair", "package.install", "secret.read", "terminal.run", "browser.authenticate", "policy.modify"]) {
  check((CRITICAL_ACTIONS as readonly string[]).includes(action), `critical action from the plan is missing: ${action}`)
}
check(V1_ACTIONS.every((action) => !isCritical(action)), "a V1 action was classified critical")
check(CRITICAL_ACTIONS.every((action) => isCritical(action)), "a critical action was not classified critical")

// --- V1 actions pass without ceremony ---------------------------------------------
for (const action of V1_ACTIONS) {
  const outcome = registry.authorize(request({ action }))
  check(outcome.status === "allowed", `V1 action ${action} was refused`)
}
check(approvalsAsked.length === 0, "a V1 action triggered an approval prompt")
check(shown.length === 0, "a V1 action triggered a confirmation dialog")

// --- A generative UI can never reach a critical action ------------------------------
for (const trusted of [false, true]) {
  const origin: UiOrigin = { kind: "generative", trusted, rendererId: "panel-1" }
  check(!originMayReachCritical(origin), `a generative origin with trusted=${trusted} was allowed to reach critical actions`)
  for (const action of CRITICAL_ACTIONS) {
    refusedFor(registry.authorize(request({ action, origin })), "untrusted-origin-critical", `generative UI (trusted=${trusted}) reached ${action}`)
  }
}
check(approvalsAsked.length === 0, "a generative UI request reached the approval prompt before being refused")
check(shown.length === 0, "a generative UI request showed a confirmation for something never permissible")

// An untrusted MCP client is refused the same way; a trusted one proceeds.
refusedFor(registry.authorize(request({ action: "terminal.run", origin: { kind: "mcp", clientId: "c1", trusted: false } })), "untrusted-origin-critical", "an untrusted MCP client reached a critical action")
check(registry.authorize(request({ action: "terminal.run", origin: { kind: "mcp", clientId: "c1", trusted: true } })).status === "allowed", "a trusted MCP client was refused a critical action")

// --- Critical actions need all four guarantees -----------------------------------------
approvalsAsked.length = 0
shown.length = 0
const critical = registry.authorize(request({ action: "desktop.control" }))
check(critical.status === "allowed", "a fully guaranteed critical action was refused")
check(critical.status === "allowed" && critical.capability === "desktop.control", "the dedicated capability was not reported")
check(critical.status === "allowed" && typeof critical.approvalId === "string", "the approval id was not reported")
check(shown.includes("desktop.control"), "no visible confirmation was shown for a critical action")
check(approvalsAsked.includes("desktop.control"), "no JIT approval was requested for a critical action")
// The confirmation precedes the approval: consent to something undescribed is not consent.
check(shown.length > 0 && approvalsAsked.length > 0, "confirmation and approval were not both exercised")

hasCapability = false
refusedFor(registry.authorize(request({ action: "secret.read" })), "missing-capability", "a critical action ran without its dedicated capability")
hasCapability = true

grantApproval = false
refusedFor(registry.authorize(request({ action: "package.install" })), "approval-denied", "a denied approval did not stop a critical action")
grantApproval = true

const noConfirmation = new McpUiActionRegistry({
  capabilities: { has: () => true },
  approval: { request: () => ({ id: "appr-x", granted: true }) },
  confirmation: { show: () => false },
  audit: { record: (action, outcome, detail) => audited.push({ action, outcome, detail }) },
})
refusedFor(noConfirmation.authorize(request({ action: "remote.pair" })), "confirmation-not-shown", "a critical action ran without a visible confirmation")

// --- Unknown actions and the kill switch -------------------------------------------------
refusedFor(registry.authorize(request({ action: "workspace.destroy" as never })), "unknown-action", "an action outside both lists was accepted")
killSwitch = true
refusedFor(registry.authorize(request({ action: "session.create" })), "kill-switch", "the kill switch did not stop a V1 action")
refusedFor(registry.authorize(request({ action: "terminal.run" })), "kill-switch", "the kill switch did not stop a critical action")
killSwitch = false

// --- The generative allowlist cannot even name a critical action ---------------------------
const allowlist = generativeUiAllowlist()
check(allowlist.size === V1_ACTIONS.length, "the generative allowlist is not exactly the V1 set")
for (const action of CRITICAL_ACTIONS) check(!allowlist.has(action), `the generative allowlist exposes critical action ${action}`)
checks += 1
renderGenerativeUi({ type: "button", id: "run", props: { label: "Run", actionId: "workflow.run" } }, allowlist)
checks += 1
try {
  renderGenerativeUi({ type: "button", id: "evil", props: { label: "Install", actionId: "package.install" } }, allowlist)
  throw new Error("generated markup was able to name a critical action")
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("not allowlisted")) throw error
}

// --- Every decision is audited ---------------------------------------------------------------
check(audited.some((entry) => entry.outcome === "allow"), "no allowed action was audited")
for (const reason of ["untrusted-origin-critical", "missing-capability", "approval-denied", "confirmation-not-shown", "unknown-action", "kill-switch"]) {
  check(audited.some((entry) => entry.outcome === "deny" && entry.detail.includes(reason)), `refusal reason "${reason}" was never audited`)
}

console.log(`McpUiActions: ${checks}/${checks} passed`)
