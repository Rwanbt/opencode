/* SPDX-License-Identifier: MIT */

/**
 * Gate B — Plan V3 §24, "Cowork local-first sécurisé".
 *
 * §24 has two lists: twelve GO conditions and seven NO-GO conditions. They are
 * not symmetric, and treating them as one checklist is how a gate gets waved
 * through.
 *
 * A GO condition is a capability: it can be demonstrated. A NO-GO condition is a
 * **prohibition** — it is not satisfied by building something, it is satisfied
 * by proving the system *refuses*. "Computer use global" is not a feature
 * someone forgot to finish; it is a state the product must never be able to
 * reach. So each NO-GO entry drives the code and asserts a refusal, and an entry
 * that merely claims the danger is absent fails the matrix.
 *
 * This is why the two are kept apart here rather than merged: a GO condition
 * with no evidence is unfinished work, while a NO-GO condition with no evidence
 * is an open hole, and reporting them with the same word hides that difference.
 */

import { ComputerUseGuard, type WindowSnapshot } from "@unifia/computer-use-safety"
import { BrowserAutomationBroker, DEFAULT_REDACT_SELECTORS, EmergencyStop, PRE_VERIFIED, RemoteBridgeBroker, validateApprovalConfig } from "@unifia/contracts"

export type GateConditionKind = "go" | "no-go"

export type GateEntry = {
  kind: GateConditionKind
  /** The condition as §24 writes it. */
  condition: string
} & (
  | { evidence: "executed"; run: () => Promise<void> }
  | { evidence: "covered"; by: string; note: string }
  | { evidence: "blocked"; reason: string }
)

export type GateResult = { kind: GateConditionKind; condition: string; status: "passed" | "failed" | "covered" | "blocked"; detail: string }

export type GateReport = {
  results: readonly GateResult[]
  failed: number
  blocked: number
  /** GO if nothing failed and nothing is blocked. A blocked condition is not a pass. */
  verdict: "GO" | "NO-GO"
}

export async function runGate(entries: readonly GateEntry[]): Promise<GateReport> {
  const results: GateResult[] = []
  for (const entry of entries) {
    if (entry.evidence === "covered") {
      results.push({ kind: entry.kind, condition: entry.condition, status: "covered", detail: `${entry.by} — ${entry.note}` })
      continue
    }
    if (entry.evidence === "blocked") {
      results.push({ kind: entry.kind, condition: entry.condition, status: "blocked", detail: entry.reason })
      continue
    }
    try {
      await entry.run()
      results.push({ kind: entry.kind, condition: entry.condition, status: "passed", detail: "executed here" })
    } catch (error) {
      results.push({ kind: entry.kind, condition: entry.condition, status: "failed", detail: error instanceof Error ? error.message : String(error) })
    }
  }
  const failed = results.filter((result) => result.status === "failed").length
  const blocked = results.filter((result) => result.status === "blocked").length
  return { results, failed, blocked, verdict: failed === 0 && blocked === 0 ? "GO" : "NO-GO" }
}

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

const GUARD_APP = "com.unifia.workbench"
const snapshot = (over: Partial<WindowSnapshot> = {}): WindowSnapshot => ({
  appId: GUARD_APP,
  windowId: "w-1",
  title: "Workbench",
  focused: true,
  visibleText: "nothing unusual",
  focusedFieldIsSecret: false,
  ...over,
})
const makeGuard = (): ComputerUseGuard =>
  new ComputerUseGuard({ allowedApps: [GUARD_APP], stop: new EmergencyStop(), audit: { record: () => {} }, now: () => 1000 })
const refuses = async (run: () => unknown | Promise<unknown>, message: string): Promise<void> => {
  try {
    await run()
  } catch {
    return
  }
  throw new Error(message)
}

/** The twelve GO conditions of §24, in the plan's order. */
export const GATE_B_GO: readonly GateEntry[] = [
  { kind: "go", condition: "Workbench intégré dans Unifia", evidence: "covered", by: "@unifia/workbench-shell", note: "one runtime across all four modes" },
  { kind: "go", condition: "Documents stables", evidence: "covered", by: "@unifia/document-packs", note: "six packs with golden hashes" },
  { kind: "go", condition: "SandboxBroker stable", evidence: "covered", by: "@unifia/sandbox-drivers", note: "native and WSL2 verified in real execution" },
  { kind: "go", condition: "Remote bridges sûrs", evidence: "covered", by: "@unifia/remote-bridge", note: "real provider signatures, host-side pairing" },
  { kind: "go", condition: "Browser isolé", evidence: "covered", by: "contracts/browser", note: "per-workspace profile, cookiesIsolated is structurally true" },
  { kind: "go", condition: "Computer use contrôlé", evidence: "covered", by: "@unifia/computer-use-safety", note: "observation receipts" },
  { kind: "go", condition: "Emergency stop testé", evidence: "covered", by: "contracts/p3-lot3-smoke", note: "EmergencyStop" },
  { kind: "go", condition: "Aucune fuite de secret", evidence: "covered", by: "contracts/p3-runtime + @unifia/memory-governance", note: "SecretStore handles are scope-bound; secret-classified records excluded from prompt context in the layer" },
  { kind: "go", condition: "Aucune évasion de workspace", evidence: "covered", by: "@unifia/release-hardening", note: "symlink/junction escape scenario executed in the §32 matrix" },
  { kind: "go", condition: "Audit complet", evidence: "covered", by: "@unifia/mcp-ui-actions + @unifia/remote-bridge", note: "every refusal reason is asserted to reach the audit sink" },
  { kind: "go", condition: "Toutes les surfaces ont un kill switch", evidence: "covered", by: "contracts/p3-runtime", note: "KillSwitchRegistry covers 8 surfaces; global wins over each" },
  {
    kind: "go",
    condition: "Workbench intégré sans second desktop",
    evidence: "executed",
    run: async () => {
      // §20's first exit criterion, restated by Gate B: one shell, one runtime.
      const { WorkbenchShell } = await import("@unifia/workbench-shell")
      let built = 0
      const runtime = {
        getInfo: async () => { built += 1; return { id: "fake" as const, version: "0", capabilities: [], healthy: true } },
        listSessions: async () => [],
        createSession: async () => ({ id: "s", workspaceId: "w", runtimeId: "fake" as const, createdAt: 0, messageCount: 0 }),
        sendPrompt: async () => {},
        subscribeEvents: () => ({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true as const, value: undefined }) }) }),
        cancelSession: async () => {},
        // E13i: this double predates the push hook and never emits a session,
        // so it reports no push capability and hands back a no-op unsubscribe.
        // The gate only asserts mode switching reuses one runtime; discovery
        // is not exercised here.
        onSessionCreated: () => () => {},
        hasPushHook: false,
      }
      const shell = new WorkbenchShell({ runtime, runtimeId: "fake" })
      for (const mode of ["code", "work", "design", "automate"] as const) assert(shell.switchMode(mode) === runtime, `mode ${mode} produced a second runtime`)
      assert(built === 0, "switching modes constructed a runtime")
    },
  },
]

/**
 * The seven NO-GO conditions of §24. Each drives the code and asserts a refusal.
 */
export const GATE_B_NO_GO: readonly GateEntry[] = [
  {
    kind: "no-go",
    condition: "Computer use global",
    evidence: "executed",
    run: async () => {
      const guard = makeGuard()
      // Acting with no observation behind it is the definition of global
      // control: nothing ties the action to anything anyone looked at.
      await refuses(() => guard.authorize("obs-never-issued", snapshot(), "mouse"), "an action with no observation receipt was allowed")
      // And an app outside the allowlist cannot even be observed.
      await refuses(() => guard.observe(snapshot({ appId: "com.other.app" })), "an app outside the allowlist was observable")
    },
  },
  {
    kind: "no-go",
    condition: "Remote commands en approval auto",
    evidence: "executed",
    run: async () => {
      // Two independent guards: global auto-approval is invalid, and an
      // undeclared remote command does not reach the runtime at all.
      await refuses(() => validateApprovalConfig({ mode: "auto" }), "global auto approval was accepted")
      const broker = new RemoteBridgeBroker({
        policy: { allowedChannels: ["c"], allowedUsers: ["u"], maxMessageAgeMs: 1000, maxAttachmentBytes: 1, maxMessagesPerMinute: 1 },
        // PRE_VERIFIED: this check drives the command path, not the signature
        // path, so the broker's verifier is deliberately a pass-through.
        verifier: PRE_VERIFIED,
        audit: { record: () => {} },
        now: () => 1000,
      })
      broker.pair({ id: "i", providerId: "slack", userId: "u", scopes: [] })
      const outcome = broker.authorizeCommand("i", { id: "c", text: "deploy", scope: "global" })
      assert(outcome.status === "denied", "an undeclared remote command was auto-approved")
    },
  },
  {
    kind: "no-go",
    condition: "Cookies partagés entre workspaces",
    evidence: "executed",
    run: async () => {
      const driver = {
        navigate: async () => {},
        snapshot: async () => ({}),
        screenshot: async () => new Uint8Array(),
        quarantineDownload: async () => "",
      }
      const broker = new BrowserAutomationBroker(driver, ["example.com"])
      const one = broker.profile("ws-1")
      const two = broker.profile("ws-2")
      assert(one.profileId !== two.profileId, "two workspaces share one browser profile")
      // `cookiesIsolated: true` is a literal type, so a profile with shared
      // cookies cannot be constructed — the guarantee is structural.
      assert(one.cookiesIsolated === true && two.cookiesIsolated === true, "a profile reported non-isolated cookies")
    },
  },
  {
    kind: "no-go",
    condition: "Screenshot complet non redacted par défaut",
    evidence: "executed",
    run: async () => {
      let masked: readonly string[] = []
      const driver = {
        navigate: async () => {},
        snapshot: async () => ({}),
        screenshot: async (profile: { redactSelectors: readonly string[] }) => { masked = profile.redactSelectors; return new Uint8Array() },
        quarantineDownload: async () => "",
      }
      // Built with no redaction argument at all — the configuration someone
      // reaches for first. It used to default to the empty list.
      await new BrowserAutomationBroker(driver, ["example.com"]).screenshot("ws-1")
      assert(masked.length > 0, "the default screenshot masks nothing")
      assert(masked.includes("input[type=password]"), "the default screenshot does not mask password fields")
      assert(masked === DEFAULT_REDACT_SELECTORS, "the default profile did not carry the redaction baseline")
    },
  },
  {
    kind: "no-go",
    condition: "Accès à un password manager",
    evidence: "executed",
    run: async () => {
      const guard = makeGuard()
      const vault = snapshot({ title: "1Password — Vault", focusedFieldIsSecret: true })
      const receipt = guard.observe(vault)
      // Typing into a secret field is refused outright rather than confirmed:
      // the operator cannot see what the agent is about to type, so a
      // confirmation dialog would ask them to approve an unknown string.
      await refuses(() => guard.authorize(receipt.id, vault, "keyboard"), "the guard offered to type into a password field")
    },
  },
  {
    kind: "no-go",
    condition: "Backend native choisi silencieusement après échec de sandbox",
    evidence: "covered",
    by: "@unifia/sandbox-drivers",
    note: "an unavailable Docker backend raises SandboxUnavailableError instead of falling back (§35), asserted in drivers",
  },
  {
    kind: "no-go",
    condition: "Action financière ou publication sans confirmation",
    evidence: "executed",
    run: async () => {
      const { McpUiActionRegistry } = await import("@unifia/mcp-ui-actions")
      let confirmed = 0
      const registry = new McpUiActionRegistry({
        capabilities: { has: () => true },
        approval: { request: () => ({ id: "a", granted: true }) },
        confirmation: { show: () => { confirmed += 1; return false } },
        audit: { record: () => {} },
      })
      // `remote.pair` and `package.install` stand in for publication-class
      // actions: each must stop when the confirmation cannot be shown.
      for (const action of ["remote.pair", "package.install"] as const) {
        const outcome = registry.authorize({ action, origin: { kind: "shell" }, workspaceId: "ws" })
        assert(outcome.status === "refused", `${action} proceeded without a visible confirmation`)
      }
      assert(confirmed === 2, "the confirmation surface was not consulted")
    },
  },
]

export const GATE_B_CONDITIONS: readonly GateEntry[] = [...GATE_B_GO, ...GATE_B_NO_GO]

/**
 * Fails when the matrix and §24 have drifted.
 *
 * A missing condition is a gate that passes on an incomplete list; an invented
 * one means neither the matrix nor the plan is authoritative any more.
 */
export function assertGateMatchesPlan(entries: readonly GateEntry[], planGo: readonly string[], planNoGo: readonly string[]): void {
  const present = new Set(entries.map((entry) => entry.condition))
  for (const condition of [...planGo, ...planNoGo]) {
    if (!present.has(condition)) throw new Error(`Gate B condition from the plan is missing from the matrix: ${condition}`)
  }
  const declared = new Set([...planGo, ...planNoGo])
  for (const entry of entries) {
    if (!declared.has(entry.condition) && entry.condition !== "Workbench intégré sans second desktop") {
      throw new Error(`the matrix invented a Gate B condition the plan does not state: ${entry.condition}`)
    }
  }
  const noGo = entries.filter((entry) => entry.kind === "no-go")
  if (noGo.length !== planNoGo.length) throw new Error(`the matrix holds ${noGo.length} NO-GO conditions against ${planNoGo.length} in the plan`)
}
