/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// C-PRE1-01 — suite Automate minimale (R-013, Critical, bloquant M1).
//
// Phase 1 : smoke test statique qui pin la forme du fichier de la
// surface. Le module lui-meme ne peut pas etre importe en Node
// (SolidJS router client-only), donc on verifie le code source.
//
// Phase 2 (livree dans `automate-decode.test.ts`) : tests round-trip
// reels sur les helpers extraits (`decodeFile`,
// `parseWorkflowDefinition`).
//
// La phase 3 (a faire en M1, apres ADR-000) :
//   - e2e minimal : 1 parcours approval_required avec horloge Playwright
//   - test des 8 sorties du plan v4 §16.3

const SURFACE = resolve(import.meta.dir, "automate-surface.tsx")
const source = readFileSync(SURFACE, "utf8")

describe("C-PRE1-01 automate-surface smoke test (static)", () => {
  test("exports the AutomateSurface SolidJS component", () => {
    expect(source).toMatch(/export\s+function\s+AutomateSurface\s*\(/)
  })

  test("imports decodeFile and parseWorkflowDefinition from automate-decode", () => {
    // After phase 2 extraction (C-PRE1-01), the surface delegates parsing
    // to ./automate-decode. This pins that contract: a future refactor
    // that re-inlines the parsing breaks this test, which is the point.
    expect(source).toMatch(/from\s+["']\.\/automate-decode["']/)
    expect(source).toMatch(/\bdecodeFile\b/)
    expect(source).toMatch(/\bparseWorkflowDefinition\b/)
  })

  test("calls client.startWorkflow with the workflow definition", () => {
    // The contract is: client.startWorkflow(workspaceId, definition).
    // If this line ever changes, Phase 3 e2e will need to be rewritten.
    expect(source).toMatch(/client\.startWorkflow\(/)
  })

  test("handles the approvalRequired branch explicitly", () => {
    // Phase 3 e2e covers this branch end-to-end.
    expect(source).toMatch(/approvalRequired/)
  })

  test("still uses decodeFile on the file body before parsing", () => {
    // The decoded file body is what we parse. Pin the call order:
    // parseWorkflowDefinition(decodeFile(file)).
    expect(source).toMatch(/parseWorkflowDefinition\(decodeFile\(/)
  })
})
