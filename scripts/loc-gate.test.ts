/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"

const REPO_ROOT = join(import.meta.dir, "..")
const LOC_GATE = join(REPO_ROOT, "scripts", "loc-gate.mjs")
const NODE = process.execPath

describe("Z10 — loc-gate catches injected violations", () => {
  test("the loc-gate exits 1 when a file exceeds the block threshold", () => {
    // Z10 oracle: « violation injectée échoue ». We synthesize a
    // 2 000-LOC .ts file under a temp src root, point the gate
    // at it (the script walks any directory passed as its first
    // positional argument), and assert exit 1 + the violation
    // line in stderr.
    const tmp = mkdtempSync(join(tmpdir(), "loc-gate-"))
    try {
      // Stub the gate's expected layout: a `src/` subdir under
      // the temp root, since the script appends `/src`.
      const src = join(tmp, "src")
      mkdirSync(src, { recursive: true })
      const lines: string[] = []
      for (let i = 0; i < 2000; i += 1) lines.push(`// filler line ${i}`)
      writeFileSync(join(src, "god-file.ts"), lines.join("\n"))
      const result = spawnSync(NODE, [LOC_GATE, tmp], { encoding: "utf8" })
      expect(result.status).toBe(1)
      const combined = `${result.stdout}\n${result.stderr}`
      expect(combined).toMatch(/FAIL/)
      expect(combined).toMatch(/god-file\.ts/)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("the loc-gate exits 0 when every file is under the block threshold", () => {
    // Companion to the failure test: a small-file dir passes.
    // Without this pair, the gate could be silently broken
    // (e.g. a regex that always exits 0).
    const tmp = mkdtempSync(join(tmpdir(), "loc-gate-"))
    try {
      const src = join(tmp, "src")
      mkdirSync(src, { recursive: true })
      writeFileSync(join(src, "ok.ts"), "// 10 lines\n".repeat(10))
      const result = spawnSync(NODE, [LOC_GATE, tmp], { encoding: "utf8" })
      expect(result.status).toBe(0)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
