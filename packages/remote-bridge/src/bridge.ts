/* SPDX-License-Identifier: MIT */

/**
 * RemoteBridge — the §22 chain, in the order §22 states it:
 *
 *   signature → pairing identity → command parser → PolicyEngine
 *   → ApprovalBroker local → RuntimeAdapter
 *
 * Two properties are load-bearing and easy to lose:
 *
 * 1. **Pairing is an act on the host, never a side effect of traffic.** The
 *    adapters this replaces paired any sender on their first message, then
 *    denied them. The denial was correct; the pairing was not. It created a
 *    map entry, a nonce window and a rate-limit window keyed by an
 *    attacker-chosen user id, so unauthenticated traffic grew host memory and
 *    wrote `pair` into the audit log for someone who was never paired.
 *
 * 2. **Revocation is local and synchronous.** §22 gives it a one-second
 *    budget; nothing here waits on I/O, so the budget is met by construction
 *    rather than by being fast enough.
 */

import { PRE_VERIFIED, RemoteBridgeBroker, type KillSwitchRegistry, type RemoteApprovalPort, type RemoteAudit, type RemoteBridgePolicy, type RemoteCommand, type RemoteCommandResult, type RemoteIdentity, type RemoteMessage, type RemoteProviderId } from "@unifia/contracts"
import { RemoteTransportRegistry } from "./registry.js"
import { verifyFeishuSignature, verifySlackSignature, type SecretReference, type SignatureRefusal, type SignedRequest } from "./signatures.js"

export type IngressRefusal =
  | { kind: "transport-disabled"; state: "disabled" | "killed" }
  | { kind: "signature"; reason: SignatureRefusal }
  | { kind: "not-paired" }
  | { kind: "policy" }

export type IngressResult = { accepted: true; identity: RemoteIdentity } | { accepted: false; refusal: IngressRefusal }

export type Ingress = {
  provider: RemoteProviderId
  message: RemoteMessage
  request: SignedRequest
  /** Anti-replay token; defaults to the signed nonce, then to the message id. */
  nonce?: string
}

export type BridgeOptions = {
  policy: RemoteBridgePolicy
  audit: RemoteAudit
  switches: KillSwitchRegistry
  /** One signing secret per transport, held by reference so revocation bites. */
  secrets: Partial<Record<RemoteProviderId, SecretReference>>
  approvals?: RemoteApprovalPort
  now?: () => number
  maxSkewMs?: number
}

const DEFAULT_MAX_SKEW_MS = 5 * 60_000

export class RemoteBridge {
  readonly transports: RemoteTransportRegistry
  readonly #broker: RemoteBridgeBroker
  readonly #paired = new Map<string, RemoteProviderId>()
  readonly #options: BridgeOptions
  readonly #now: () => number

  constructor(options: BridgeOptions) {
    this.#options = options
    this.#now = options.now ?? (() => Date.now())
    this.transports = new RemoteTransportRegistry(options.switches)
    this.#broker = new RemoteBridgeBroker({ policy: options.policy, verifier: PRE_VERIFIED, audit: options.audit, now: this.#now, approvals: options.approvals })
  }

  /** Pairs an identity. Called by the host, never by inbound traffic. */
  pair(identity: Omit<RemoteIdentity, "pairedAt">): RemoteIdentity {
    const paired = this.#broker.pair(identity)
    this.#paired.set(paired.id, paired.providerId)
    return paired
  }

  /**
   * Drops an identity everywhere it is remembered.
   *
   * The broker and this map are cleared together: leaving the local set
   * populated would make a revoked id still look "known" to `ingest`, which is
   * how a revocation turns into a slow leak of accepted-then-denied traffic.
   */
  revoke(identityId: string): boolean {
    const known = this.#paired.delete(identityId)
    return this.#broker.revoke(identityId) || known
  }

  isPaired(identityId: string): boolean {
    return this.#paired.has(identityId)
  }

  /**
   * Runs the §22 chain for one inbound message.
   *
   * Signature first: an unsigned request is not evidence of anything, so it
   * must not be allowed to name an identity, consume a rate-limit slot, or
   * decide which branch of this method it visits.
   */
  ingest(ingress: Ingress, identityId: string): IngressResult {
    const state = this.transports.state(ingress.provider)
    if (state !== "enabled") return this.#refuse(identityId, { kind: "transport-disabled", state })

    const signature = this.#verify(ingress)
    if (!signature.ok) return this.#refuse(identityId, { kind: "signature", reason: signature.reason })

    // Checked before the broker so an unknown id allocates no nonce window and
    // no rate-limit window — the sender chooses that id.
    if (this.#paired.get(identityId) !== ingress.provider) return this.#refuse(identityId, { kind: "not-paired" })

    const nonce = ingress.nonce ?? ingress.request.nonce ?? ingress.message.id
    if (!this.#broker.authorizeMessage({ identityId, message: ingress.message, signature: "verified", nonce })) {
      return { accepted: false, refusal: { kind: "policy" } }
    }
    return { accepted: true, identity: { id: identityId, providerId: ingress.provider, userId: ingress.message.userId, scopes: [], pairedAt: this.#now() } }
  }

  /** Delegates to the broker, which is default-deny for undeclared commands. */
  authorizeCommand(identityId: string, command: RemoteCommand): RemoteCommandResult {
    const provider = this.#paired.get(identityId)
    if (!provider) return { commandId: command.id, status: "denied", result: "not-paired" }
    if (!this.transports.isEnabled(provider)) return { commandId: command.id, status: "denied", result: "transport-disabled" }
    return this.#broker.authorizeCommand(identityId, command)
  }

  resolveApproval(id: string, decision: "allow" | "deny", actor: string): unknown {
    return this.#broker.resolveApproval(id, decision, actor)
  }

  #verify(ingress: Ingress): { ok: true } | { ok: false; reason: SignatureRefusal } {
    const secret = this.#options.secrets[ingress.provider]
    if (!secret) return { ok: false, reason: "missing-secret" }
    const input = { request: ingress.request, secret, now: this.#now(), maxSkewMs: this.#options.maxSkewMs ?? DEFAULT_MAX_SKEW_MS }
    return ingress.provider === "slack" ? verifySlackSignature(input) : verifyFeishuSignature(input)
  }

  #refuse(identityId: string, refusal: IngressRefusal): IngressResult {
    this.#options.audit.record({ type: "deny", identityId, reason: refusal.kind === "signature" ? `signature:${refusal.reason}` : refusal.kind })
    return { accepted: false, refusal }
  }
}
