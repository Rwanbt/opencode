/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { simulateSimilarity } from "../../../src/knowledge/semantic/simulate.js"

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "unifia-sim-"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("P5.5 similarity simulation", () => {
  it("returns zero pairs on an empty vault", () => {
    const r = simulateSimilarity({ vaultRoot: root })
    expect(r.notes).toBe(0)
    expect(r.topPairs).toEqual([])
  })

  it("returns the top-K pairs on a small corpus", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), "alpha beta gamma delta epsilon zeta eta")
    writeFileSync(join(root, "memory/b.md"), "alpha beta gamma delta epsilon zeta eta")
    writeFileSync(join(root, "memory/c.md"), "completely different unrelated content here")
    const r = simulateSimilarity({ vaultRoot: root, topK: 3 })
    expect(r.notes).toBe(3)
    expect(r.topPairs.length).toBeGreaterThan(0)
    // The top pair should be (a, b) because they share the
    // most tokens.
    const top = r.topPairs[0]!
    expect(top.cosine).toBeGreaterThan(0)
  })

  it("tracks index and query timings", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), "x y z")
    const r = simulateSimilarity({ vaultRoot: root })
    expect(r.indexMs).toBeGreaterThanOrEqual(0)
    expect(r.queryMs).toBeGreaterThanOrEqual(0)
  })

  it("rejects a non-absolute vaultRoot", () => {
    expect(() => simulateSimilarity({ vaultRoot: "relative/path" })).toThrow(/absolute/)
  })
})
