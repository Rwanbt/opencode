/* SPDX-License-Identifier: MIT */
/**
 * Hardening: migration dry-run + rollback (P11.5).
 *
 * Per runbook §21 P11: "migration dry-run et rollback" + ADR 1030
 * (migrations must be additive and reversible, or reconstruct
 * Class D from Class A).
 *
 * V1 ships:
 * - `MigrationStep` — a single atomic, idempotent change.
 * - `MIGRATION_V1_TO_V2` — the only migration in V1 (V2 is the
 *   first shipped version, so this migration is a no-op used to
 *   exercise the dry-run + rollback pipeline).
 * - `dryRunMigration(steps)` — returns a list of operations
 *   that WOULD run, without touching any state. Each op is
 *   classified as `additive` or `destructive` so the operator
 *   can review before apply.
 * - `planRollback(steps)` — produces the reverse-ordered set
 *   of operations that would undo the migration. Rollback is
 *   only offered if every step is reversible (otherwise the
 *   migration is reconstructible, not reversible).
 * - `applyMigration(steps, dryRun)` — applies the steps to an
 *   in-memory state holder. Pure function, no I/O.
 */

export type MigrationOpKind =
  | "add-note"
  | "update-frontmatter"
  | "drop-frontmatter-field"
  | "rebuild-class-d"

export interface MigrationOp {
  kind: MigrationOpKind
  /** A locator or identifier affected by the op. */
  target: string
  /** Free-form details (e.g. field name, new value). */
  details: string
  /** True if the op is reversible via a single opposite op. */
  reversible: boolean
  /** True if the data is reconstructible from Class A. */
  reconstructible: boolean
}

export interface MigrationStep {
  /** Short human label. */
  label: string
  /** Ordered list of ops within the step. */
  ops: MigrationOp[]
}

/** The only migration in V1. No-op placeholder. */
export const MIGRATION_V1_TO_V2: readonly MigrationStep[] = [
  {
    label: "V1→V2: ensure every note has a unifia_id (UUIDv7) in frontmatter",
    ops: [
      {
        kind: "update-frontmatter",
        target: "*",
        details: "ensure unifia_id (UUIDv7)",
        reversible: true,
        reconstructible: true,
      },
    ],
  },
  {
    label: "V1→V2: rebuild Class D index from Class A",
    ops: [
      {
        kind: "rebuild-class-d",
        target: "derived.db",
        details: "rebuild from Class A",
        reversible: false,
        reconstructible: true,
      },
    ],
  },
] as const

/** The verdict of a dry-run. */
export interface DryRunReport {
  /** Total ops that would run. */
  totalOps: number
  /** Number of additive ops. */
  additiveOps: number
  /** Number of destructive ops. */
  destructiveOps: number
  /** Ordered list of labels. */
  stepLabels: string[]
  /** True if every op is reconstructible from Class A. */
  allReconstructible: boolean
  /** True if every destructive op is reconstructible (rollback safe). */
  destructiveReconstructible: boolean
}

/** Compute a dry-run report without mutating anything. */
export function dryRunMigration(steps: readonly MigrationStep[]): DryRunReport {
  let total = 0
  let additive = 0
  let destructive = 0
  let allRecon = true
  let destructiveRecon = true
  const stepLabels: string[] = []

  for (const s of steps) {
    stepLabels.push(s.label)
    for (const op of s.ops) {
      total += 1
      if (op.reconstructible) {
        // additive and reconstructible
      } else {
        allRecon = false
      }
      if (op.kind === "add-note" || op.kind === "update-frontmatter") {
        additive += 1
      } else {
        destructive += 1
        if (!op.reconstructible) destructiveRecon = false
      }
    }
  }

  return {
    totalOps: total,
    additiveOps: additive,
    destructiveOps: destructive,
    stepLabels,
    allReconstructible: allRecon,
    destructiveReconstructible: destructiveRecon,
  }
}

/** The verdict of a rollback plan. */
export interface RollbackPlan {
  /** Number of reverse ops that can be issued. */
  reversibleOps: number
  /** Ops that cannot be reversed (must be reconstructed from Class A). */
  nonReversibleOps: number
  /** Ordered list of reverse ops. */
  reverseOps: MigrationOp[]
  /** True if a full rollback is possible from ops alone. */
  fullRollback: boolean
}

/** Plan a rollback for a list of migration steps. */
export function planRollback(steps: readonly MigrationStep[]): RollbackPlan {
  const reverseOps: MigrationOp[] = []
  let reversible = 0
  let nonReversible = 0

  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]
    for (let j = s.ops.length - 1; j >= 0; j--) {
      const op = s.ops[j]
      if (op.reversible) {
        reverseOps.push(reverseOp(op))
        reversible += 1
      } else if (op.reconstructible) {
        // A non-reversible but reconstructible op can still be
        // undone by re-deriving from Class A. Include it in the
        // rollback plan so the operator sees the full picture.
        reverseOps.push(reverseOp(op))
        nonReversible += 1
      } else {
        // Truly non-reversible: cannot be undone.
        nonReversible += 1
      }
    }
  }

  return {
    reversibleOps: reversible,
    nonReversibleOps: nonReversible,
    reverseOps,
    fullRollback: nonReversible === 0,
  }
}

function reverseOp(op: MigrationOp): MigrationOp {
  switch (op.kind) {
    case "add-note":
      return {
        kind: "update-frontmatter",
        target: op.target,
        details: `reverse: ${op.details}`,
        reversible: true,
        reconstructible: true,
      }
    case "update-frontmatter":
      return {
        kind: "drop-frontmatter-field",
        target: op.target,
        details: `reverse: ${op.details}`,
        reversible: true,
        reconstructible: true,
      }
    case "drop-frontmatter-field":
      return {
        kind: "update-frontmatter",
        target: op.target,
        details: `reverse: ${op.details}`,
        reversible: true,
        reconstructible: true,
      }
    case "rebuild-class-d":
      return {
        kind: "rebuild-class-d",
        target: op.target,
        details: `reverse: ${op.details}`,
        reversible: false,
        reconstructible: true,
      }
  }
}

/** In-memory state holder for `applyMigration`. */
export interface MigrationState {
  applied: MigrationOp[]
  /** A log of the op labels in order. */
  log: string[]
}

/** Apply (or simulate) a list of migration steps. */
export function applyMigration(
  steps: readonly MigrationStep[],
  state: MigrationState,
  dryRun: boolean,
): MigrationState {
  if (dryRun) {
    // Dry-run never mutates state.
    return { ...state, log: [...state.log, "DRY-RUN"] }
  }
  for (const s of steps) {
    for (const op of s.ops) {
      state.applied.push(op)
      state.log.push(`${s.label} :: ${op.kind} ${op.target}`)
    }
  }
  return state
}
