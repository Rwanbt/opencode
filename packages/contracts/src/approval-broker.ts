/* SPDX-License-Identifier: MIT */
import type { P3Capability, P3Decision } from "./p3.js"

export type ApprovalRequestState = "pending" | "allow" | "deny" | "cancelled"
// C2-5/D-2: `expiresAt` bounds only the PENDING window (the deadline by
// which the request must be resolved). `resolvedAt` records when the
// request left "pending" — the gate that owns grant-validity policy
// (ApprovalCapabilityGate) uses it to decide how long a granted "allow"
// stays honored, distinct from and typically longer than the pending
// window it replaces.
export type ApprovalRequestRecord = { id: string; capability: P3Capability; resource: string; expiresAt: number; status: ApprovalRequestState; resolvedAt?: number }
type ApprovalObserver = (request: ApprovalRequestRecord, decision: P3Decision) => void

export class ApprovalBroker {
  readonly #requests = new Map<string, ApprovalRequestRecord>()
  readonly #now: () => number
  readonly #observe?: ApprovalObserver
  #nextId = 1

  constructor(now: () => number = Date.now, observe?: ApprovalObserver) {
    this.#now = now
    this.#observe = observe
  }

  request(capability: P3Capability, resource: string, expiresAt: number): ApprovalRequestRecord {
    if (!resource || expiresAt <= this.#now()) throw new Error("approval request must have a non-empty resource and future expiry")
    const request: ApprovalRequestRecord = { id: `approval-${this.#nextId++}`, capability, resource, expiresAt, status: "pending" }
    this.#requests.set(request.id, request)
    return { ...request }
  }

  resolve(id: string, decision: "allow" | "deny", actor: string, grantedResource?: string): P3Decision {
    const request = this.#requests.get(id)
    if (!request || request.status !== "pending") return this.#deny("C3-invalid-request", "unknown-or-closed-request")
    if (this.#now() >= request.expiresAt) return this.#close(request, "deny", this.#deny("C3-timeout-deny", "approval-expired"))
    if (!actor) return this.#close(request, "deny", this.#deny("C3-actor-required", "missing-actor"))
    if (grantedResource !== undefined && grantedResource !== request.resource) return this.#close(request, "deny", this.#deny("C3-narrow-scope", "grant-exceeds-request"))
    const result: P3Decision = decision === "allow" ? { kind: "allow", ruleId: "C3-explicit-approval" } : { kind: "deny", ruleId: "C3-explicit-deny", reason: "actor-denied" }
    return this.#close(request, decision, result)
  }

  cancel(id: string): P3Decision {
    const request = this.#requests.get(id)
    if (!request || request.status !== "pending") return this.#deny("C3-cancel-invalid", "unknown-or-closed-request")
    return this.#close(request, "cancelled", this.#deny("C3-cancel-effective", "approval-cancelled"))
  }

  find(capability: P3Capability, resource: string): ApprovalRequestRecord | undefined {
    const matches = [...this.#requests.values()].filter((request) => request.capability === capability && request.resource === resource)
    const request = matches.at(-1)
    return request ? { ...request } : undefined
  }

  get(id: string): ApprovalRequestRecord | undefined {
    const request = this.#requests.get(id)
    return request ? { ...request } : undefined
  }

  pending(resource?: string): readonly ApprovalRequestRecord[] {
    const now = this.#now()
    return [...this.#requests.values()]
      .filter((request) => request.status === "pending" && request.expiresAt > now && (resource === undefined || request.resource === resource))
      .map((request) => ({ ...request }))
  }

  #close(request: ApprovalRequestRecord, status: ApprovalRequestState, decision: P3Decision): P3Decision {
    request.status = status
    request.resolvedAt = this.#now()
    this.#observe?.({ ...request }, decision)
    return decision
  }

  #deny(ruleId: string, reason: string): P3Decision { return { kind: "deny", ruleId, reason } }
}
