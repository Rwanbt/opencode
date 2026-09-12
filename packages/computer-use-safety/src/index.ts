/* SPDX-License-Identifier: MIT */

/**
 * Computer-use safety — Plan V3 section 23 (Phase 10) exit criteria.
 *
 * `DesktopAutomationBroker` already refuses a non-allowlisted app, an engaged
 * emergency stop and a disengaged kill switch. Four exit criteria had nothing
 * behind them: visual prompt injection, clickjacking and window swap, focus
 * loss, and password fields.
 *
 * All four share one shape. The agent decides what to do by looking at a
 * screen, then acts on that screen a moment later. Everything dangerous lives
 * in that gap: the window can be swapped, focus can move, the pixels can carry
 * instructions, and the field under the cursor can be a password box. So the
 * guard is built around an **observation receipt**: observing mints a receipt
 * describing exactly what was seen, and acting requires presenting it. An act
 * whose receipt no longer matches the screen is refused.
 */

import type { DesktopTarget, EmergencyStop } from "@unifia/contracts"

export type WindowSnapshot = {
  appId: string
  windowId: string
  title: string
  focused: boolean
  /** Text visible in the window, from OCR or an accessibility tree. */
  visibleText: string
  /** Whether the element that would receive input is a secret entry field. */
  focusedFieldIsSecret: boolean
}

export type ObservationReceipt = {
  readonly id: string
  readonly target: DesktopTarget
  readonly observedAt: number
  /** Identity of what was seen. Any change invalidates the receipt. */
  readonly identity: string
  readonly injectionFindings: readonly string[]
}

export type SafetyRefusal =
  | { reason: "emergency-stop" }
  | { reason: "not-allowlisted"; appId: string }
  | { reason: "receipt-expired"; ageMs: number }
  | { reason: "window-swapped"; expected: string; actual: string }
  | { reason: "focus-lost" }
  | { reason: "secret-field" }
  | { reason: "visual-injection"; findings: readonly string[] }

export class ComputerUseRefused extends Error {
  readonly refusal: SafetyRefusal
  constructor(refusal: SafetyRefusal) {
    super(`computer use refused: ${refusal.reason}`)
    this.name = "ComputerUseRefused"
    this.refusal = refusal
  }
}

export type SafetyAudit = { record(action: string, outcome: "allow" | "deny", detail: string): unknown }

/**
 * Phrases that turn observed pixels into an instruction aimed at the agent.
 *
 * Detection is intentionally shallow and listed in one place: this decides when
 * a screen is refused, and an unreadable heuristic is one nobody can review.
 * It is a tripwire, not a classifier — a finding refuses the screen, it does
 * not try to sanitise it.
 */
const INJECTION_PATTERNS: readonly { id: string; pattern: RegExp }[] = [
  { id: "ignore-instructions", pattern: /\bignore (?:all )?(?:previous|prior|above) instructions\b/i },
  { id: "role-override", pattern: /\byou are now\b|\bnew system prompt\b|\bdisregard your\b/i },
  { id: "exfiltration", pattern: /\b(?:send|post|upload|email)\b[^.\n]{0,40}\b(?:token|password|secret|api[ _-]?key|credential)/i },
  { id: "destructive", pattern: /\brm\s+-rf\b|\bformat\s+c:|\bdrop\s+database\b/i },
  { id: "approval-bypass", pattern: /\b(?:approve|confirm|accept)\b[^.\n]{0,30}\bwithout (?:asking|confirmation)\b/i },
  { id: "agent-address", pattern: /\b(?:AI|agent|assistant|claude|gpt)[,:]?\s+(?:please\s+)?(?:run|execute|open|delete|send)\b/i },
]

export function detectVisualInjection(text: string): readonly string[] {
  return INJECTION_PATTERNS.filter((entry) => entry.pattern.test(text)).map((entry) => entry.id)
}

/** Identity of a window at a point in time. Any component changing invalidates it. */
function identityOf(snapshot: WindowSnapshot): string {
  return `${snapshot.appId}::${snapshot.windowId}::${snapshot.title}`
}

const DEFAULT_RECEIPT_TTL_MS = 5_000

export type GuardOptions = {
  allowedApps: readonly string[]
  stop: EmergencyStop
  /** How long an observation stays actionable. */
  receiptTtlMs?: number
  audit?: SafetyAudit
  now?: () => number
}

/**
 * Gate between observing a window and acting on it.
 *
 * Observation is always allowed to *report* an injection finding — refusing to
 * look would leave the operator blind. Acting on a screen that carried one is
 * refused, because the danger is not seeing the text, it is obeying it.
 */
export class ComputerUseGuard {
  readonly #allowed: ReadonlySet<string>
  readonly #stop: EmergencyStop
  readonly #ttl: number
  readonly #audit?: SafetyAudit
  readonly #now: () => number
  readonly #receipts = new Map<string, ObservationReceipt>()
  #sequence = 0

  constructor(options: GuardOptions) {
    this.#allowed = new Set(options.allowedApps)
    this.#stop = options.stop
    this.#ttl = options.receiptTtlMs ?? DEFAULT_RECEIPT_TTL_MS
    this.#audit = options.audit
    this.#now = options.now ?? Date.now
  }

  /** Records what was seen and returns the receipt an action must present. */
  observe(snapshot: WindowSnapshot): ObservationReceipt {
    this.#assertOperable({ appId: snapshot.appId, windowId: snapshot.windowId }, "desktop.observe")
    const findings = detectVisualInjection(snapshot.visibleText)
    const receipt: ObservationReceipt = {
      id: `obs-${++this.#sequence}`,
      target: { appId: snapshot.appId, windowId: snapshot.windowId },
      observedAt: this.#now(),
      identity: identityOf(snapshot),
      injectionFindings: findings,
    }
    this.#receipts.set(receipt.id, receipt)
    this.#audit?.record("desktop.observe", "allow", findings.length > 0 ? `injection findings: ${findings.join(",")}` : "clean")
    return receipt
  }

  /**
   * Authorises an action against the screen as it is *now*.
   *
   * @throws ComputerUseRefused — every refusal names its reason so the caller
   * cannot collapse them into a generic failure and retry blindly.
   */
  authorize(receiptId: string, current: WindowSnapshot, action: "keyboard" | "mouse"): ObservationReceipt {
    const receipt = this.#receipts.get(receiptId)
    if (!receipt) throw this.#refuse("desktop.control", { reason: "receipt-expired", ageMs: -1 })
    this.#assertOperable(receipt.target, "desktop.control")

    const age = this.#now() - receipt.observedAt
    if (age > this.#ttl) throw this.#refuse("desktop.control", { reason: "receipt-expired", ageMs: age })

    // Clickjacking and window swap: the thing on screen is no longer the thing
    // that was reasoned about.
    const actual = identityOf(current)
    if (actual !== receipt.identity) throw this.#refuse("desktop.control", { reason: "window-swapped", expected: receipt.identity, actual })

    // Focus loss: input would land somewhere nobody looked at.
    if (!current.focused) throw this.#refuse("desktop.control", { reason: "focus-lost" })

    // A keystroke into a secret field is refused outright rather than confirmed:
    // the operator cannot see what the agent is about to type.
    if (action === "keyboard" && current.focusedFieldIsSecret) throw this.#refuse("desktop.control", { reason: "secret-field" })

    if (receipt.injectionFindings.length > 0) throw this.#refuse("desktop.control", { reason: "visual-injection", findings: receipt.injectionFindings })

    this.#audit?.record("desktop.control", "allow", `${action} on ${actual}`)
    return receipt
  }

  /** Invalidates a receipt after use, so one observation authorises one action. */
  consume(receiptId: string): void {
    this.#receipts.delete(receiptId)
  }

  #assertOperable(target: DesktopTarget, action: string): void {
    if (this.#stop.isStopped()) throw this.#refuse(action, { reason: "emergency-stop" })
    if (!this.#allowed.has(target.appId)) throw this.#refuse(action, { reason: "not-allowlisted", appId: target.appId })
  }

  #refuse(action: string, refusal: SafetyRefusal): ComputerUseRefused {
    this.#audit?.record(action, "deny", JSON.stringify(refusal))
    return new ComputerUseRefused(refusal)
  }
}
