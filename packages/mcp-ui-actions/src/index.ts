/* SPDX-License-Identifier: MIT */

/**
 * MCP UI action registry — Plan V3 section 30 (Phase 16).
 *
 * Section 30 names eleven actions a UI may drive and seven it may only drive
 * under four simultaneous guarantees: a dedicated capability, just-in-time
 * approval, audit, and a visible confirmation. It adds one sentence that
 * decides the shape of this module:
 *
 *   « interdiction aux UIs génératives non fiables »
 *
 * A generated interface is model output. If it could reach a critical action by
 * declaring one, prompt injection would be a privilege escalation path with a
 * button on it. So origin is part of every request, and an untrusted origin can
 * never reach a critical action — not by approval, not by capability, not by
 * any combination. That refusal is checked before anything else, because a
 * check that runs after an approval prompt has already shown the user a dialog
 * for something that was never permissible.
 */

import type { P3Capability } from "@unifia/contracts"

/** The eleven actions of section 30 that a UI may drive. */
export const V1_ACTIONS = [
  "workspace.open",
  "workspace.switch",
  "session.create",
  "session.open",
  "composer.setText",
  "composer.send",
  "artifact.open",
  "artifact.create",
  "capability.search",
  "workflow.run",
  "approval.show",
] as const

/** The seven actions of section 30 that require the full set of guarantees. */
export const CRITICAL_ACTIONS = [
  "desktop.control",
  "remote.pair",
  "package.install",
  "secret.read",
  "terminal.run",
  "browser.authenticate",
  "policy.modify",
] as const

export type V1Action = (typeof V1_ACTIONS)[number]
export type CriticalAction = (typeof CRITICAL_ACTIONS)[number]
export type UiActionName = V1Action | CriticalAction

/** Where the request came from. A generative UI is model output. */
export type UiOrigin =
  | { kind: "shell" }
  | { kind: "generative"; trusted: boolean; rendererId: string }
  | { kind: "mcp"; clientId: string; trusted: boolean }

export type UiActionRequest = {
  action: UiActionName
  origin: UiOrigin
  workspaceId: string
  /** Free-form action payload; never interpreted here. */
  payload?: Record<string, unknown>
}

export type UiActionRefusal =
  | { reason: "unknown-action"; action: string }
  | { reason: "untrusted-origin-critical"; action: CriticalAction }
  | { reason: "missing-capability"; capability: P3Capability }
  | { reason: "approval-denied"; approvalId: string }
  | { reason: "confirmation-not-shown" }
  | { reason: "kill-switch" }

export type UiActionOutcome =
  | { status: "allowed"; action: UiActionName; capability?: P3Capability; approvalId?: string }
  | { status: "refused"; refusal: UiActionRefusal }

/** The dedicated capability each critical action requires. */
const CRITICAL_CAPABILITY: Readonly<Record<CriticalAction, P3Capability>> = {
  "desktop.control": "desktop.control",
  "remote.pair": "remote.receive",
  "package.install": "package.install",
  "secret.read": "secret.read",
  "terminal.run": "terminal.run",
  "browser.authenticate": "browser.navigate",
  "policy.modify": "package.install",
}

const V1_SET: ReadonlySet<string> = new Set(V1_ACTIONS)
const CRITICAL_SET: ReadonlySet<string> = new Set(CRITICAL_ACTIONS)

export const isCritical = (action: string): action is CriticalAction => CRITICAL_SET.has(action)
export const isKnownAction = (action: string): action is UiActionName => V1_SET.has(action) || CRITICAL_SET.has(action)

/** Whether an origin may ever reach a critical action. */
export function originMayReachCritical(origin: UiOrigin): boolean {
  switch (origin.kind) {
    case "shell":
      return true
    // A generated interface never reaches a critical action, trusted or not.
    // "Trusted" for a renderer means its markup was allowlisted, which says
    // nothing about the model that produced its contents.
    case "generative":
      return false
    case "mcp":
      return origin.trusted
  }
}

export type CapabilityCheck = { has(workspaceId: string, capability: P3Capability): boolean }
export type JitApproval = { request(action: CriticalAction, workspaceId: string): { id: string; granted: boolean } }
/** Shows the user what is about to happen. Returns false if it could not be shown. */
export type ConfirmationSurface = { show(action: CriticalAction, workspaceId: string): boolean }
export type ActionAudit = { record(action: string, outcome: "allow" | "deny", detail: string): unknown }
export type KillSwitches = { isEngaged(surface: "mcp-ui-control"): boolean }

export type RegistryDependencies = {
  capabilities: CapabilityCheck
  approval: JitApproval
  confirmation: ConfirmationSurface
  audit: ActionAudit
  switches?: KillSwitches
}

export class McpUiActionRegistry {
  readonly #deps: RegistryDependencies

  constructor(deps: RegistryDependencies) {
    this.#deps = deps
  }

  /**
   * Decides whether a UI request may proceed.
   *
   * Order is deliberate: unknown action, then kill switch, then origin, and
   * only then the three guarantees. Asking for approval before establishing
   * that the origin may ever do this would train the user to approve things
   * the system was going to refuse anyway.
   */
  authorize(request: UiActionRequest): UiActionOutcome {
    if (!isKnownAction(request.action)) return this.#refuse(request, { reason: "unknown-action", action: request.action })
    if (this.#deps.switches?.isEngaged("mcp-ui-control")) return this.#refuse(request, { reason: "kill-switch" })

    if (!isCritical(request.action)) {
      this.#deps.audit.record(request.action, "allow", `${request.origin.kind} origin, v1 action`)
      return { status: "allowed", action: request.action }
    }

    if (!originMayReachCritical(request.origin)) return this.#refuse(request, { reason: "untrusted-origin-critical", action: request.action })

    const capability = CRITICAL_CAPABILITY[request.action]
    if (!this.#deps.capabilities.has(request.workspaceId, capability)) return this.#refuse(request, { reason: "missing-capability", capability })

    // The confirmation is shown before the approval is requested: an approval
    // granted for an action the user never saw described is not informed consent.
    if (!this.#deps.confirmation.show(request.action, request.workspaceId)) return this.#refuse(request, { reason: "confirmation-not-shown" })

    const approval = this.#deps.approval.request(request.action, request.workspaceId)
    if (!approval.granted) return this.#refuse(request, { reason: "approval-denied", approvalId: approval.id })

    this.#deps.audit.record(request.action, "allow", `critical, capability=${capability}, approval=${approval.id}`)
    return { status: "allowed", action: request.action, capability, approvalId: approval.id }
  }

  #refuse(request: UiActionRequest, refusal: UiActionRefusal): UiActionOutcome {
    this.#deps.audit.record(request.action, "deny", JSON.stringify(refusal))
    return { status: "refused", refusal }
  }
}

/** Actions a renderer may reference, for `renderGenerativeUi`'s allowlist. */
export function generativeUiAllowlist(): ReadonlySet<string> {
  // Exactly the V1 set: a generated interface may offer these and nothing else,
  // so a critical action cannot even be named in generated markup.
  return new Set(V1_ACTIONS)
}
