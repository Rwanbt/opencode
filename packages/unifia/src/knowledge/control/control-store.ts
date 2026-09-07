/* SPDX-License-Identifier: MIT */
/**
 * TS adapter for the Class C ControlStore (P2.5).
 */

export interface PolicyGrant {
  id: string
  subject: string
  action: string
  grantedAt: string
  expiresAt?: string
  revoked: boolean
}

export interface EgressGrant {
  id: string
  contentHash: string
  destination: string
  grantedAt: string
  consumed: boolean
}

export interface ControlEvent {
  id: string
  kind: string
  timestamp: string
  payload: string
}

export class ControlValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ControlValidationError"
  }
}

export class ControlStore {
  private policyGrants = new Map<string, PolicyGrant>()
  private egressGrants = new Map<string, EgressGrant>()
  private events: ControlEvent[] = []

  constructor(public readonly deviceId: string) {
    if (deviceId.length === 0) {
      throw new ControlValidationError("deviceId must be non-empty")
    }
  }

  upsertPolicyGrant(g: PolicyGrant): void {
    if (g.id.length === 0) throw new ControlValidationError("policy grant id required")
    this.policyGrants.set(g.id, { ...g })
  }

  getPolicyGrant(id: string): PolicyGrant | undefined {
    const g = this.policyGrants.get(id)
    return g ? { ...g } : undefined
  }

  revokePolicyGrant(id: string): boolean {
    const g = this.policyGrants.get(id)
    if (g === undefined) return false
    g.revoked = true
    return true
  }

  upsertEgressGrant(g: EgressGrant): void {
    if (g.id.length === 0) throw new ControlValidationError("egress grant id required")
    if (g.contentHash.length === 0 || g.destination.length === 0) {
      throw new ControlValidationError("egress grant requires contentHash and destination")
    }
    this.egressGrants.set(g.id, { ...g })
  }

  consumeEgressGrant(id: string): boolean {
    const g = this.egressGrants.get(id)
    if (g === undefined || g.consumed) return false
    g.consumed = true
    return true
  }

  appendEvent(e: ControlEvent): void {
    this.events.push(e)
  }

  controlLog(): readonly ControlEvent[] {
    return [...this.events]
  }
}
