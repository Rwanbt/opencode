/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import {
  MIGRATION_V1_TO_V2,
  dryRunMigration,
  planRollback,
  applyMigration,
} from "../../../src/knowledge/hardening/migration.js"

describe("P11.5 migration — dry run", () => {
  it("reports 2 steps in the V1 to V2 migration", () => {
    const r = dryRunMigration(MIGRATION_V1_TO_V2)
    expect(r.totalOps).toBe(2)
    expect(r.stepLabels).toHaveLength(2)
  })

  it("classifies every V1->V2 op as reconstructible", () => {
    const r = dryRunMigration(MIGRATION_V1_TO_V2)
    expect(r.allReconstructible).toBe(true)
    expect(r.destructiveReconstructible).toBe(true)
  })

  it("counts additive vs destructive ops", () => {
    const r = dryRunMigration(MIGRATION_V1_TO_V2)
    expect(r.additiveOps).toBe(1)
    expect(r.destructiveOps).toBe(1)
  })
})

describe("P11.5 migration — rollback", () => {
  it("produces a reverse-ordered plan for V1->V2", () => {
    const p = planRollback(MIGRATION_V1_TO_V2)
    expect(p.reverseOps).toHaveLength(2)
    // The last step (rebuild-class-d) is NOT reversible, so the
    // rollback is reconstructible-but-not-full.
    expect(p.nonReversibleOps).toBe(1)
    expect(p.reversibleOps).toBe(1)
  })

  it("full rollback is true when every op is reversible", () => {
    const p = planRollback([
      {
        label: "additive only",
        ops: [
          {
            kind: "update-frontmatter",
            target: "x",
            details: "set unifia_id",
            reversible: true,
            reconstructible: true,
          },
        ],
      },
    ])
    expect(p.fullRollback).toBe(true)
    expect(p.reversibleOps).toBe(1)
  })
})

describe("P11.5 migration — apply (in-memory)", () => {
  it("dry-run never mutates state", () => {
    const state = { applied: [], log: [] }
    const r = applyMigration(MIGRATION_V1_TO_V2, state, true)
    expect(r.applied).toEqual([])
    expect(r.log).toEqual(["DRY-RUN"])
    // Original state untouched.
    expect(state.applied).toEqual([])
  })

  it("real run appends every op to the state", () => {
    const state = { applied: [], log: [] }
    const r = applyMigration(MIGRATION_V1_TO_V2, state, false)
    expect(r.applied).toHaveLength(2)
    expect(r.log).toHaveLength(2)
  })
})
