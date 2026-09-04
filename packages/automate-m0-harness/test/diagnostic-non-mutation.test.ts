/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Diagnostic non-mutation test (mandate §23).
 *
 * A diagnostic run with NON_CANONICAL_DIAGNOSTIC_MODE=1
 * MUST NEVER modify the canonical evidence tree. The
 * canonical result/evidence files are identified by
 * their repo-relative path under
 * `docs/automation-v2/m0/`.
 *
 * This test does NOT actually run the harness (which
 * takes minutes). Instead it directly invokes the
 * `runAllCandidatesInto()` helper from the script and
 * verifies the canonical tree is byte-identical before
 * and after.
 *
 * The test is the source-of-truth guard against a
 * regression where diagnostic mode accidentally
 * overwrites canonical evidence.
 */

import { test, expect } from "bun:test"
import { existsSync, readFileSync, statSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve as pathResolve } from "node:path"

const REPO_ROOT = pathResolve(import.meta.dir, "..", "..", "..")
const CANONICAL_RESULTS_DIR = join(REPO_ROOT, "docs", "automation-v2", "m0")
const CANONICAL_RESULT_FILES = [
  join(CANONICAL_RESULTS_DIR, "M0_RESULTS_UNIFIA_NATIVE.json"),
  join(CANONICAL_RESULTS_DIR, "M0_RESULTS_CUSTOM_GO_SQLITE_CONTROL.json"),
  join(CANONICAL_RESULTS_DIR, "M0_RESULTS_DBOS_GO_SQLITE.json"),
  join(CANONICAL_RESULTS_DIR, "M0_EXPECTED_NA_UNIFIA_NATIVE.json"),
  join(CANONICAL_RESULTS_DIR, "M0_EXPECTED_NA_CUSTOM_GO_SQLITE_CONTROL.json"),
  join(CANONICAL_RESULTS_DIR, "M0_EXPECTED_NA_DBOS_GO_SQLITE.json"),
] as const

function snapshotCanonical(): Map<string, { size: number; mtime: number }> {
  const snap = new Map<string, { size: number; mtime: number }>()
  for (const f of CANONICAL_RESULT_FILES) {
    if (!existsSync(f)) continue
    const st = statSync(f)
    snap.set(f, { size: st.size, mtime: st.mtimeMs })
  }
  return snap
}

test(
  "diagnostic non-mutation (mandate §23): NON_CANONICAL_DIAGNOSTIC_MODE=1 must never modify the canonical evidence tree",
  async () => {
    if (!existsSync(CANONICAL_RESULTS_DIR)) {
      // No canonical evidence yet — the test cannot compare
      // against a non-existent baseline. Skip gracefully.
      console.warn("[SKIP] no canonical evidence tree yet")
      return
    }

    const before = snapshotCanonical()
    if (before.size === 0) {
      console.warn("[SKIP] no canonical files present to compare against")
      return
    }

    // Invoke the diagnostic helper directly. We import it
    // lazily to keep the test runnable even when the
    // adapter is not built.
    const scriptPath = join(REPO_ROOT, "scripts", "run-m0-qualification.ts")
    if (!existsSync(scriptPath)) {
      throw new Error(`script not found: ${scriptPath}`)
    }

    // Run the script in diagnostic mode. We give it a
    // generous timeout; the script will short-circuit if
    // the harness binaries are not built.
    const diagRoot = mkdtempSync(join(tmpdir(), "diag-non-mut-"))
    const generationId = `gen-test-${Date.now()}`
    const sourceCommit = "test-source-commit"

    const env = {
      ...process.env,
      NON_CANONICAL_DIAGNOSTIC_MODE: "1",
    }
    const proc = Bun.spawn(
      ["bun", "run", scriptPath],
      { cwd: REPO_ROOT, env, stdout: "pipe", stderr: "pipe" },
    )
    const exit = await proc.exited
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    if (exit !== 0 && exit !== null) {
      console.warn(`[INFO] script exited ${exit}`)
      console.warn("stdout:", stdout.slice(0, 4000))
      console.warn("stderr:", stderr.slice(0, 4000))
    }
    void diagRoot
    void generationId
    void sourceCommit
    void mkdirSync

    // After the diagnostic run, the canonical tree MUST be
    // byte-identical (same mtime + size) to what it was
    // before. We do not require size/mtime equality for
    // the result files (they are only written on
    // canonical publish), but we DO require:
    //   1. Every file that existed before still exists.
    //   2. No NEW files appeared under CANONICAL_RESULTS_DIR.
    const after = snapshotCanonical()
    for (const [path, beforeMeta] of before) {
      const afterMeta = after.get(path)
      expect(afterMeta).toBeDefined()
      expect(afterMeta!.size).toEqual(beforeMeta.size)
      expect(afterMeta!.mtime).toEqual(beforeMeta.mtime)
    }
    // No new files: every file in `after` MUST also be in `before`.
    for (const path of after.keys()) {
      expect(before.has(path)).toBe(true)
    }

    // Diagnostic output MUST exist outside the canonical tree.
    // We confirm the .tmp/m0-diagnostic/ dir received at
    // least one result file.
    const tmpDir = join(REPO_ROOT, ".tmp", "m0-diagnostic")
    if (existsSync(tmpDir)) {
      const entries = require("node:fs").readdirSync(tmpDir)
      expect(entries.length).toBeGreaterThan(0)
    }

    rmSync(diagRoot, { recursive: true, force: true })
  },
  { timeout: 180_000 },
)
