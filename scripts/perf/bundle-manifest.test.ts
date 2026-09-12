/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const REPO_ROOT = join(import.meta.dir, "..", "..")
const MANIFEST = join(REPO_ROOT, "docs", "perf-baselines", "bundle-manifest.json")

describe("H10 — bundle manifest", () => {
  test("manifest exists and is valid JSON", () => {
    expect(existsSync(MANIFEST)).toBe(true)
    const parsed = JSON.parse(readFileSync(MANIFEST, "utf8"))
    expect(parsed.totalBytes).toBeGreaterThan(0)
    expect(parsed.totalFiles).toBeGreaterThan(0)
    expect(parsed.byKind).toBeDefined()
    expect(parsed.budgets).toBeDefined()
  })

  test("mode chunks stay under the per-surface budget (F10 lazy boundary proof)", () => {
    // H10 oracle: « lazy locales/terminal/modes prouvé ». The mode
    // category covers Work / Design / Automate chunks. If the lazy
    // boundary regressed (e.g. a top-level import re-introduced
    // Design/Automate into the entry), this number would balloon.
    const parsed = JSON.parse(readFileSync(MANIFEST, "utf8"))
    const mode = parsed.byKind["mode"]
    expect(mode).toBeDefined()
    expect(mode.maxGzipBytes).toBeLessThan(parsed.budgets["mode"])
  })

  test("the Work/Design/Automate surfaces are present as separate chunks (no monolithic mode bundle)", () => {
    // The F10 lazy boundary promises one chunk per surface. If
    // the bundler collapsed them back into a single chunk, the
    // mode category would still be under budget but the F10
    // oracle would be violated.
    const parsed = JSON.parse(readFileSync(MANIFEST, "utf8"))
    const mode = parsed.byKind["mode"]
    const names = mode.files.map((f: { name: string }) => f.name)
    expect(mode.count).toBeGreaterThanOrEqual(3)
    expect(names.length).toBe(mode.count)
    expect(names.some((name) => /work/i.test(name))).toBe(true)
    expect(names.some((name) => /design/i.test(name))).toBe(true)
    expect(names.some((name) => /automate/i.test(name))).toBe(true)
  })
})
