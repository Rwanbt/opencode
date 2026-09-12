/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * CP6.2: real FC-14 multi-process test.
 *
 * Per pack gelé §25-§29 (CP6.1) and §26-§27 (CP6.2): spawns 2
 * real `dbos-qualify.exe` processes on the same M0_STORE_DIR,
 * races them on /authority/claim via Promise.all after a
 * barrier, then both processes attempt /authority/mutate and
 * /authority/dispatch. PASS only if:
 *   - winnerMutate = ACCEPTED (200-299)
 *   - loserMutate  = REJECTED (403)
 *   - winnerDispatch = ACCEPTED
 *   - loserDispatch  = REJECTED
 */

import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join, resolve as pathResolve } from "node:path"

const DBOS_GO_TOOL_DIR = pathResolve(import.meta.dir, "..", "..", "..", "tools", "dbos-qualify")
const DBOS_GO_BINARY = join(DBOS_GO_TOOL_DIR, "dbos-qualify.exe")
const DBOS_GO_BUILT = existsSync(DBOS_GO_BINARY)

describe("CP6.2: real FC-14 multi-process (DBOS Go)", () => {
  if (!DBOS_GO_BUILT) {
    test("binary not built — skipped", () => {
      // eslint-disable-next-line no-console
      console.log(`[SKIP] ${DBOS_GO_BINARY} not found`)
      expect(DBOS_GO_BUILT).toBe(false)
    })
    return
  }
  test("2 real OS processes race for authority; winner mutate+dispatch ACCEPTED, loser REJECTED", async () => {
    const { runDbosGoFC14RealConcurrentRace } = await import("../src/qualification/multiprocess-fc14-real.ts")
    const { mkdtempSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { rmSync } = await import("node:fs")
    const root = mkdtempSync(join(tmpdir(), "m0-fc14-real-test-"))
    try {
      const result = await runDbosGoFC14RealConcurrentRace(root)
      expect(result.passConditions.winnerMutateAccepted).toBe(true)
      expect(result.passConditions.loserMutateRejected).toBe(true)
      expect(result.passConditions.winnerDispatchAccepted).toBe(true)
      expect(result.passConditions.loserDispatchRejected).toBe(true)
      // Real multi-process evidence: distinct PIDs.
      expect(result.processAPid).not.toBe(result.processBPid)
      expect(result.winnerPid).not.toBe(result.loserPid)
      // The winner is the holder of the run_authority row
      // (its ownerId is the one stored after the race).
      expect(result.winnerOwnerId).toBe(result.claimWinner.authorityOwnerId)
    } finally {
      for (let i = 0; i < 5; i++) {
        try { rmSync(root, { recursive: true, force: true }); break }
        catch { await new Promise((r) => setTimeout(r, 200)) }
      }
    }
  }, { timeout: 120_000 })
})
