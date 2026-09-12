/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * V1 fixture corpus runner (plan V2.3.1 §185, ADR-017).
 *
 * Each V1 fixture is parsed and migrated; the V2 IR is then compared
 * to a known-good expectation (per-fixture, hand-written). This is
 * the migration CI gate (gates.yaml §12).
 *
 * Locked invariants (regression net):
 *   (1) Every V1 fixture in `fixtures/v1/*.json` parses without
 *       throwing.
 *   (2) The migration result is acceptable (no block-severity
 *       warning) — except for the explicitly blocked fixtures
 *       (here: 04-shell-block.json), which must produce a block
 *       warning and abort the rest of the mapping.
 *   (3) The V2 IR has the expected node count and structure for
 *       each fixture.
 *   (4) The V2 IR is deterministic: re-migrating the same fixture
 *       with the same timestamps yields an equal result.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import {
  isAcceptableMigration,
  migrateV1ToV2,
  V1WorkflowDefinitionSchema,
  type V1WorkflowDefinition,
  type V2NodeFamily,
} from "../src/index.ts"

const FIXTURES_DIR = join(import.meta.dir, "..", "fixtures", "v1")
const NOW = 1_700_000_000_000

interface FixtureExpectation {
  /** Name of the file (without `.json`). */
  file: string
  /** Expected acceptable? `false` only for fixtures designed to
   * trigger a block warning (e.g. unsupported capability). */
  acceptable: boolean
  /** Expected total node count (trigger + steps + approvals). */
  expectedNodeCount: number
  /** Expected total edge count. */
  expectedEdgeCount: number
  /** Expected block-warning code, if any. */
  expectedBlockCode?: string
  /** Expected `requiresApproval` insertion count. */
  expectedApprovals: number
  /** Expected trigger family. */
  expectedTriggerFamily: V2NodeFamily
}

const EXPECTATIONS: ReadonlyArray<FixtureExpectation> = [
  {
    file: "01-sequential-http",
    acceptable: true,
    expectedNodeCount: 3, // explicit trigger (default manual) + 2 http steps
    expectedEdgeCount: 2, // trigger→fetch-user, fetch-user→log-result
    expectedApprovals: 0,
    expectedTriggerFamily: "trigger.manual", // first step is http, default = manual
  },
  {
    file: "02-approval-gate",
    acceptable: true,
    expectedNodeCount: 5, // explicit trigger (default manual) + 3 steps + 1 approval gate
    expectedEdgeCount: 4, // trigger→fetch, fetch→approval, approval→process, process→send
    expectedApprovals: 1,
    expectedTriggerFamily: "trigger.manual",
  },
  {
    file: "03-schedule-trigger",
    acceptable: true,
    expectedNodeCount: 4, // absorbed trigger (schedule) + 3 steps
    expectedEdgeCount: 3, // schedule→fetch, fetch→wait, wait→rollup
    expectedApprovals: 0,
    expectedTriggerFamily: "trigger.schedule",
  },
  {
    file: "04-shell-block",
    acceptable: false, // shell is in the V1-unsupported set
    expectedNodeCount: 0, // blocked, no nodes emitted
    expectedEdgeCount: 0,
    expectedBlockCode: "v1-unsupported-capability",
    expectedApprovals: 0,
    expectedTriggerFamily: "trigger.manual",
  },
  {
    file: "05-manual-multistep",
    acceptable: true,
    expectedNodeCount: 7, // absorbed trigger (manual) + 3 steps + 2 approval gates
    expectedEdgeCount: 6, // manual→fetch, fetch→step-a__approval, step-a__approval→step-a, step-a→step-b__approval, step-b__approval→step-b, step-b→finalize
    expectedApprovals: 2,
    expectedTriggerFamily: "trigger.manual",
  },
]

function loadFixture(name: string): V1WorkflowDefinition {
  const path = join(FIXTURES_DIR, `${name}.json`)
  const raw = readFileSync(path, "utf-8")
  const json = JSON.parse(raw)
  return V1WorkflowDefinitionSchema.parse(json)
}

describe("V1 fixture corpus", () => {
  test("all expected fixtures exist on disk", () => {
    const files = readdirSync(FIXTURES_DIR).map((f) => f.replace(/\.json$/, ""))
    for (const exp of EXPECTATIONS) {
      expect(files).toContain(exp.file)
    }
  })

  for (const exp of EXPECTATIONS) {
    describe(`fixture: ${exp.file}`, () => {
      test("parses without throwing", () => {
        const v1 = loadFixture(exp.file)
        expect(v1.id).toBeTruthy()
        expect(v1.steps.length).toBeGreaterThan(0)
      })

      test("migrates to a V2 IR matching the expectation", () => {
        const v1 = loadFixture(exp.file)
        const r = migrateV1ToV2(v1, { createdAt: NOW, updatedAt: NOW })
        if (exp.acceptable) {
          expect(isAcceptableMigration(r)).toBe(true)
          expect(r.definition.nodes).toHaveLength(exp.expectedNodeCount)
          expect(r.definition.edges).toHaveLength(exp.expectedEdgeCount)
          // Count `human.approval` nodes
          const approvalCount = r.definition.nodes.filter((n) => n.family === "human.approval").length
          expect(approvalCount).toBe(exp.expectedApprovals)
          // The trigger is either the absorbed first step (when the
          // first step is `schedule` or `manual`) or the explicit
          // `${v1.id}__trigger` node (default `trigger.manual`).
          const absorbedTrigger = r.definition.nodes.find(
            (n) => (n.family === "trigger.schedule" || n.family === "trigger.manual") &&
                   n.id === v1.steps[0]?.id,
          )
          const explicitTrigger = r.definition.nodes.find((n) => n.id === `${v1.id}__trigger`)
          const trigger = absorbedTrigger ?? explicitTrigger
          expect(trigger?.family).toBe(exp.expectedTriggerFamily)
        } else {
          expect(isAcceptableMigration(r)).toBe(false)
          if (exp.expectedBlockCode) {
            expect(r.warnings.some((w) => w.code === exp.expectedBlockCode && w.severity === "block")).toBe(true)
          }
        }
      })

      test("migration is deterministic (same V1 + same timestamps -> same V2 IR)", () => {
        const v1 = loadFixture(exp.file)
        const a = migrateV1ToV2(v1, { createdAt: NOW, updatedAt: NOW })
        const b = migrateV1ToV2(v1, { createdAt: NOW, updatedAt: NOW })
        expect(a.definition).toEqual(b.definition)
        expect(a.warnings).toEqual(b.warnings)
      })
    })
  }
})
