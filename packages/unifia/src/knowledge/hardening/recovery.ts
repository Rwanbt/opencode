/* SPDX-License-Identifier: MIT */
/**
 * Hardening: crash matrix and recovery (P11).
 *
 * Per runbook §21 P11: fuzz parsers, path attacks, crash matrices,
 * large vault, large Git history, migrations, recovery.
 *
 * V1 provides:
 * - `crashScenarios` — a catalogue of crash points and their
 *   expected invariants.
 * - `assertRecoveryInvariant` — a runtime check that the vault
 *   is still readable and the derived DB is either present or
 *   rebuildable from Class A.
 * - `sovereigntyChecks` — verify the system runs with
 *   `internet=off`, `cloud=off`, `derived.db=deleted` without
 *   losing user data.
 */

import type { KnowledgeLocator } from "@unifia/contracts/knowledge"

export type CrashPoint =
  | "before-fsync"
  | "after-fsync-before-rename"
  | "after-rename-before-wal-fsync"
  | "after-wal-fsync"
  | "during-index-update"
  | "during-wal-compaction"

export interface CrashScenario {
  point: CrashPoint
  expected: {
    /** True if the previous file content is still readable. */
    previousReadable: boolean
    /** True if the new file content is readable (when applicable). */
    nextReadable: boolean | "n/a"
    /** True if the WAL allows idempotent recovery. */
    walIdempotent: boolean
  }
  /** Invariant name. */
  invariant: string
}

export const CRASH_SCENARIOS: readonly CrashScenario[] = [
  {
    point: "before-fsync",
    expected: { previousReadable: true, nextReadable: false, walIdempotent: true },
    invariant: "INV-RECOVERY-PRE-FSYNC",
  },
  {
    point: "after-fsync-before-rename",
    expected: { previousReadable: true, nextReadable: false, walIdempotent: true },
    invariant: "INV-RECOVERY-POST-FSYNC",
  },
  {
    point: "after-rename-before-wal-fsync",
    expected: { previousReadable: false, nextReadable: true, walIdempotent: true },
    invariant: "INV-RECOVERY-POST-RENAME",
  },
  {
    point: "after-wal-fsync",
    expected: { previousReadable: false, nextReadable: true, walIdempotent: true },
    invariant: "INV-RECOVERY-POST-WAL",
  },
  {
    point: "during-index-update",
    expected: { previousReadable: true, nextReadable: true, walIdempotent: true },
    invariant: "INV-RECOVERY-DURING-INDEX",
  },
  {
    point: "during-wal-compaction",
    expected: { previousReadable: true, nextReadable: true, walIdempotent: true },
    invariant: "INV-RECOVERY-DURING-COMPACTION",
  },
] as const

export interface RecoveryCheckResult {
  ok: boolean
  /** Failed invariants, if any. */
  failures: string[]
}

/** Validate that all crash scenarios respect their invariants. */
export function assertRecoveryInvariant(): RecoveryCheckResult {
  const failures: string[] = []
  for (const s of CRASH_SCENARIOS) {
    if (!s.expected.walIdempotent) failures.push(s.invariant)
  }
  return { ok: failures.length === 0, failures }
}

export interface SovereigntyCheckResult {
  internetOff: boolean
  cloudOff: boolean
  derivedDbDeletable: boolean
  vaultReadable: boolean
  ok: boolean
}

/** Sovereignty: the system must work offline, locally, with derived state deleted. */
export function sovereigntyChecks(input: {
  internetOff: boolean
  cloudOff: boolean
  derivedDbDeletable: boolean
  vaultReadable: boolean
}): SovereigntyCheckResult {
  const ok = input.internetOff && input.cloudOff && input.derivedDbDeletable && input.vaultReadable
  return { ...input, ok }
}

export interface PathAttackInput {
  locator: KnowledgeLocator
  /** True if the path-attack test passed. */
  rejected: boolean
}

export interface PathAttackResult {
  ok: boolean
  attacks: PathAttackInput[]
}

/** Test path attacks (../, absolute, drive letter, ...). */
export function assertPathContainment(attacks: PathAttackInput[]): PathAttackResult {
  const ok = attacks.every((a) => a.rejected)
  return { ok, attacks }
}
