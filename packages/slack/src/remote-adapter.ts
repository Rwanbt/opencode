/* SPDX-License-Identifier: MIT */

/**
 * Slack ingress guard — Plan V3 §22.
 *
 * Slack is the one transport whose signature is verified *before* this code
 * runs: Bolt checks `X-Slack-Signature` against the signing secret and drops
 * the request itself, so the raw body and header are gone by the time
 * `app.message` fires. That is a real guarantee, but it used to be recorded as
 * the string `"bolt-verified"` handed to a verifier that compared it against
 * the same constant — indistinguishable from no verification at all, and
 * silently wrong the moment the adapter is mounted anywhere but behind Bolt.
 *
 * It is now a named attestation the caller has to make on purpose.
 */

import { ApprovalBroker, KillSwitchRegistry, PRE_VERIFIED, RemoteBridgeBroker, type RemoteApprovalPort, type RemoteAudit, type RemoteBridgePolicy, type RemoteCommand, type RemoteCommandResult, type RemoteMessage } from "@unifia/contracts"

type SlackIngress = { id: string; channelId: string; userId: string; text: string; timestamp: number }

/** Who checked `X-Slack-Signature`. Only Bolt may be credited for it. */
export type SignatureAttestation = "slack-bolt"

export type SlackAdapterOptions = {
  policy: RemoteBridgePolicy
  audit: RemoteAudit
  signatureVerifiedBy: SignatureAttestation
  now?: () => number
  approvals?: RemoteApprovalPort
  switches?: KillSwitchRegistry
  /** Disables the transport without touching the global kill switch. */
  enabled?: boolean
}

export class SlackRemoteAdapter {
  readonly #broker: RemoteBridgeBroker
  readonly #switches: KillSwitchRegistry
  readonly #paired = new Set<string>()
  #enabled: boolean

  constructor(options: SlackAdapterOptions) {
    if (options.signatureVerifiedBy !== "slack-bolt") throw new Error("Slack ingress requires a signature attestation")
    const now = options.now ?? (() => Date.now())
    this.#switches = options.switches ?? new KillSwitchRegistry()
    this.#enabled = options.enabled ?? true
    this.#broker = new RemoteBridgeBroker({ policy: options.policy, verifier: PRE_VERIFIED, audit: options.audit, now, approvals: options.approvals })
    // Pairing is a host act: being named in the allowlist is that act. Inbound
    // traffic never pairs anyone, so an unknown sender costs no nonce window,
    // no rate-limit window and no audit entry it chose the key of.
    for (const userId of options.policy.allowedUsers) {
      const identityId = `slack:${userId}`
      this.#broker.pair({ id: identityId, providerId: "slack", userId, scopes: ["read"], expiresAt: now() + 30 * 60_000 })
      this.#paired.add(identityId)
    }
  }

  /** Turns this transport off on its own; §22 asks for separate disabling. */
  setEnabled(enabled: boolean): void {
    this.#enabled = enabled
  }

  get enabled(): boolean {
    return this.#enabled && !this.#switches.isEngaged("all-remote")
  }

  revoke(userId: string): boolean {
    const identityId = `slack:${userId}`
    const known = this.#paired.delete(identityId)
    return this.#broker.revoke(identityId) || known
  }

  authorize(input: SlackIngress): boolean {
    if (!this.enabled) return false
    const identityId = `slack:${input.userId}`
    if (!this.#paired.has(identityId)) return false
    const message: RemoteMessage = { id: input.id, channelId: input.channelId, userId: input.userId, text: input.text, timestamp: input.timestamp }
    return this.#broker.authorizeMessage({ identityId, message, signature: "verified", nonce: `${input.channelId}:${input.id}` })
  }

  authorizeCommand(userId: string, command: RemoteCommand): RemoteCommandResult {
    if (!this.enabled) return { commandId: command.id, status: "denied", result: "remote-disabled" }
    return this.#broker.authorizeCommand(`slack:${userId}`, command)
  }

  resolveApproval(id: string, decision: "allow" | "deny"): unknown {
    return this.#broker.resolveApproval(id, decision, "slack-host")
  }
}

export const createSlackRemoteAdapter = (audit: RemoteAudit, now: () => number = () => Date.now()): SlackRemoteAdapter => {
  const list = (name: string): string[] => (process.env[name] ?? "").split(",").map((value) => value.trim()).filter(Boolean)
  const policy: RemoteBridgePolicy = {
    allowedChannels: list("UNIFIA_SLACK_ALLOWED_CHANNELS"),
    allowedUsers: list("UNIFIA_SLACK_ALLOWED_USERS"),
    maxMessageAgeMs: 30_000,
    maxAttachmentBytes: 1_000_000,
    maxMessagesPerMinute: 30,
    readOnlyCommands: ["read"],
  }
  return new SlackRemoteAdapter({ policy, audit, signatureVerifiedBy: "slack-bolt", now, approvals: new ApprovalBroker(now) })
}
