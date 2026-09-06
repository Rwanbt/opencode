/* SPDX-License-Identifier: MIT */
/**
 * ApprovalCapabilityGate — the default `CapabilityGate` implementation.
 *
 * The gate fronts an `ApprovalBroker`: an `allow` decision is returned if
 * the capability is in the server-wide allowlist or if a recently-resolved
 * `allow` exists in the broker (C2-5/D-2 — granted decisions expire after
 * `grantTtlMs`, otherwise one approval would authorise the capability for
 * the rest of the session, defeating step-up). A pending approval is
 * surfaced as `approval_required`; otherwise a fresh request is filed.
 */
import type { ApprovalBroker, P3Capability } from "@unifia/contracts"
import { DEFAULT_GRANT_TTL_MS } from "./constants.js"
import type { CapabilityDecision, CapabilityGate } from "./types.js"

export class ApprovalCapabilityGate implements CapabilityGate {
  readonly #broker: ApprovalBroker
  readonly #allowlisted: ReadonlySet<P3Capability>
  readonly #ttlMs: number
  readonly #grantTtlMs: number
  readonly #now: () => number

  constructor(
    broker: ApprovalBroker,
    allowlisted: ReadonlySet<P3Capability> = new Set(),
    ttlMs = 30_000,
    grantTtlMs = DEFAULT_GRANT_TTL_MS,
    now: () => number = Date.now,
  ) {
    this.#broker = broker
    this.#allowlisted = allowlisted
    this.#ttlMs = ttlMs
    this.#grantTtlMs = grantTtlMs
    this.#now = now
  }

  async check(capability: P3Capability, resource: string, _actor: string): Promise<CapabilityDecision> {
    if (this.#allowlisted.has(capability)) return "allow"
    const existing = this.#broker.find(capability, resource)
    // C2-5/D-2: a granted decision only stays honored for grantTtlMs from
    // when it was resolved — otherwise one approval would authorize the
    // capability for the rest of the session, defeating step-up (C2-3).
    // An expired grant falls through to request a fresh approval, same as
    // if none had ever existed.
    if (
      existing?.status === "allow" &&
      existing.resolvedAt !== undefined &&
      this.#now() - existing.resolvedAt < this.#grantTtlMs
    )
      return "allow"
    if (existing?.status === "pending") return { kind: "approval_required", approvalId: existing.id }
    const request = this.#broker.request(capability, resource, this.#now() + this.#ttlMs)
    return { kind: "approval_required", approvalId: request.id }
  }

  getApproval(id: string) {
    return this.#broker.get(id)
  }

  listApprovals(resource: string) {
    return this.#broker.pending(resource)
  }

  resolve(id: string, decision: "allow" | "deny", actor: string, grantedResource?: string) {
    return this.#broker.resolve(id, decision, actor, grantedResource)
  }

  cancel(id: string) {
    return this.#broker.cancel(id)
  }
}
