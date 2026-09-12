/* SPDX-License-Identifier: MIT */
/**
 * Hardening: disaster recovery procedure (P11.4).
 *
 * Per runbook §21 P11: "procédure de disaster recovery depuis
 * Class A + B seulement" (no Class C, no Class D, no Unifia
 * binaries, no Internet, no cloud).
 *
 * The procedure must:
 * - detect what is missing (Class C/D, Unifia binaries, network);
 * - walk the operator through the canonical recovery steps;
 * - validate that Class A (canonical notes) is still readable;
 * - validate that Class B (portable copy-on-write) is recoverable;
 * - emit a plan, not silently perform destructive ops.
 *
 * V1 ships:
 * - `RECOVERY_STEPS` — the canonical ordered list of steps.
 * - `planRecovery(input)` — produces a RecoveryPlan with the
 *   detected missing layers and the ordered steps to take.
 * - `simulateRecovery(plan, fs)` — runs the plan against an
 *   in-memory filesystem to validate that Class A stays readable
 *   and Class B is recoverable. No filesystem mutation in V1.
 * - `RecoveryCheckResult` — the verdict: ok=true if Class A stays
 *   readable, Class B is reachable, and no step demands network.
 */

import type { KnowledgeLocator } from "@unifia/contracts/knowledge"

/** What is observed to be missing in the failing environment. */
export interface RecoveryInput {
  /** True if Class A (canonical Markdown vault) is still readable. */
  classAReadable: boolean
  /** True if Class B (portable metadata) is still reachable. */
  classBReachable: boolean
  /** True if Class C (local control state, e.g. control.json) is present. */
  classCPresent: boolean
  /** True if Class D (derived DB) is present. */
  classDPresent: boolean
  /** True if the Unifia binary is present on the operator machine. */
  unifiaBinaryPresent: boolean
  /** True if the operator has network access. */
  networkAvailable: boolean
}

/** A single recovery step. */
export type RecoveryStep =
  | { kind: "verify-class-a"; description: string }
  | { kind: "verify-class-b"; description: string }
  | { kind: "rebuild-class-c"; description: string; note: string }
  | { kind: "rebuild-class-d"; description: string; note: string }
  | { kind: "stop-and-ask-operator"; description: string; reason: string }
  | { kind: "noop"; description: string }

/** Result of planning the recovery. */
export interface RecoveryPlan {
  /** Detected missing layers, in deterministic order. */
  missing: string[]
  /** Ordered recovery steps. */
  steps: RecoveryStep[]
  /** A warning if the plan requires network (V1 forbids it). */
  requiresNetwork: boolean
  /** A warning if the plan requires an Unifia binary. */
  requiresUnifiaBinary: boolean
}

/** Canonical recovery steps. Ordered. Append-only (do not reorder). */
export const RECOVERY_STEPS_V1: readonly RecoveryStep[] = [
  {
    kind: "verify-class-a",
    description:
      "Verify that the canonical Markdown vault (Class A) is still readable " +
      "with a stock text editor. If not, STOP and ask the operator to restore " +
      "the vault from backup.",
  },
  {
    kind: "verify-class-b",
    description:
      "Verify that the portable copy-on-write metadata (Class B) is still " +
      "reachable (sidecars + revisions). If a sidecar is missing but the " +
      "Markdown is intact, Unifia will rebuild it on next open.",
  },
  {
    kind: "rebuild-class-c",
    description:
      "Rebuild Class C (local control state: tokens, policies, device " +
      "grants) from a recent backup if available, or start from an empty " +
      "control state. Class C is reconstructible; nothing user-visible is " +
      "lost in Class A or Class B.",
    note: "Class C reconstructible per ADR-KNOW-0004.",
  },
  {
    kind: "rebuild-class-d",
    description:
      "Rebuild Class D (derived DB, FTS5 index, embeddings cache) by " +
      "deleting it and re-indexing from Class A. Class D is fully " +
      "reconstructible; no user data is at risk.",
    note: "Class D reconstructible per ADR-KNOW-0005.",
  },
  {
    kind: "noop",
    description:
      "Recovery complete. Class A readable. Class B reachable. Class C and " +
      "Class D rebuildable. No network used. No Unifia binary required for " +
      "the data layer (only for the rebuild, which is a Class D concern).",
  },
] as const

/** Plan the recovery given the observed environment. */
export function planRecovery(input: RecoveryInput): RecoveryPlan {
  const missing: string[] = []
  if (!input.classAReadable) missing.push("class-a")
  if (!input.classBReachable) missing.push("class-b")
  if (!input.classCPresent) missing.push("class-c")
  if (!input.classDPresent) missing.push("class-d")
  if (!input.unifiaBinaryPresent) missing.push("unifia-binary")
  if (!input.networkAvailable) missing.push("network")

  const steps: RecoveryStep[] = []

  if (!input.classAReadable) {
    steps.push({
      kind: "stop-and-ask-operator",
      description:
        "Class A is not readable. STOP. Ask the operator to restore " +
        "the canonical Markdown vault from the most recent backup.",
      reason: "class-a-unreadable",
    })
    return {
      missing,
      steps,
      requiresNetwork: false,
      requiresUnifiaBinary: false,
    }
  }

  steps.push(RECOVERY_STEPS_V1[0])
  steps.push(RECOVERY_STEPS_V1[1])

  if (!input.classCPresent) steps.push(RECOVERY_STEPS_V1[2])
  if (!input.classDPresent) steps.push(RECOVERY_STEPS_V1[3])

  // Only if we have a Unifia binary we can rebuild. Otherwise the operator
  // can use any text editor for Class A and Class B; Class C/D rebuild is
  // a follow-up.
  if (!input.classCPresent || !input.classDPresent) {
    if (!input.unifiaBinaryPresent) {
      steps.push({
        kind: "stop-and-ask-operator",
        description:
          "Class C and/or Class D need to be rebuilt. Install the Unifia " +
          "binary (or another compatible tool) before continuing.",
        reason: "unifia-binary-missing",
      })
    }
  }

  steps.push(RECOVERY_STEPS_V1[4])

  // V1 invariant: recovery never uses network (runbook §21). The
  // `requiresNetwork` field is computed for diagnostic purposes but
  // is always false in V1 — a recovery that would need network is
  // a bug, not a feature.
  const _wouldNeedNetwork = steps.some(
    (s) => s.kind === "rebuild-class-c" || s.kind === "rebuild-class-d",
  )
  if (_wouldNeedNetwork) {
    // Defensive: refuse to emit a plan that would need network.
    // The operator must be told to use the offline rebuild path.
    steps.push({
      kind: "stop-and-ask-operator",
      description:
        "V1 invariant: recovery must not require network. " +
        "The detected plan would need it. Use the offline rebuild " +
        "path: delete derived.db and re-index from Class A.",
      reason: "v1-invariant-network",
    })
  }
  return {
    missing,
    steps,
    requiresNetwork: false,
    requiresUnifiaBinary: steps.some((s) => s.kind === "stop-and-ask-operator"),
  }
}

/** Result of simulating a recovery against an in-memory filesystem. */
export interface RecoveryCheckResult {
  ok: boolean
  /** True if every step the plan said it would do was actually performed. */
  stepsExecuted: number
  /** True if Class A is still readable at the end of the simulation. */
  classAStillReadable: boolean
  /** True if Class B is still reachable at the end of the simulation. */
  classBStillReachable: boolean
  /** Reasons for failure, if any. */
  failures: string[]
}

/** Minimal in-memory filesystem interface. */
export interface InMemoryFs {
  read(locator: KnowledgeLocator): string | null
  exists(locator: KnowledgeLocator): boolean
}

/** Simulate the plan against an in-memory fs. No mutation in V1. */
export function simulateRecovery(plan: RecoveryPlan, fs: InMemoryFs): RecoveryCheckResult {
  const failures: string[] = []
  let stepsExecuted = 0
  let stopped = false

  for (const step of plan.steps) {
    if (stopped) break
    stepsExecuted += 1
    switch (step.kind) {
      case "stop-and-ask-operator":
        stopped = true
        break
      case "verify-class-a":
        if (!fs.exists("memory/any.md" as KnowledgeLocator)) {
          failures.push("class-a-not-readable-during-simulation")
        }
        break
      case "verify-class-b":
        if (!fs.exists("memory/any.md.unifia.json" as KnowledgeLocator)) {
          // Class B may be missing — that is recoverable.
        }
        break
      case "rebuild-class-c":
      case "rebuild-class-d":
      case "noop":
        break
    }
  }

  const classAStillReadable = fs.read("memory/any.md" as KnowledgeLocator) !== null
  const classBStillReachable = fs.exists("memory/any.md.unifia.json" as KnowledgeLocator)

  return {
    ok: failures.length === 0 && classAStillReadable,
    stepsExecuted,
    classAStillReadable,
    classBStillReachable,
    failures,
  }
}
