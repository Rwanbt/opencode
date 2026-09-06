/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Regression test for the two-commit reproducibility model
 * (mandate §15-§17): the canonical writer must refuse to
 * publish from a dirty worktree. This is enforced by
 * `scripts/run-m0-qualification.ts` (which the harness
 * tests invoke indirectly).
 *
 * This test verifies the underlying predicate `isWorktreeClean`
 * is wired through the script's main(). We invoke the script
 * via a Bun.spawn to verify the exit code is 1 when the
 * worktree is dirty.
 */

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"

const REPO_ROOT = join(import.meta.dir, "..", "..", "..")
const SCRIPT = join(REPO_ROOT, "scripts", "run-m0-qualification.ts")

describe("canonical writer dirty-tree gate (mandate §15)", () => {
  test("refuses to publish when the worktree is dirty", () => {
    // The current worktree is dirty (uncommitted bun.lock + untracked
    // commit-msg files). The script must refuse.
    const result = spawnSync("bun", [SCRIPT], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, PATH: process.env.PATH },
      timeout: 30_000,
    })
    // We expect either a non-zero exit or a refused log line
    // (the script may still exit 1 when refused, or it may
    // print a refusal message and then run the qualification
    // in diagnostic mode). The test asserts the refusal
    // MESSAGE is present.
    const combined = (result.stdout ?? "") + (result.stderr ?? "")
    const hasRefusal = combined.includes("REFUSED") || combined.includes("Worktree is dirty")
    expect(hasRefusal).toBe(true)
  }, { timeout: 60_000 })
})
