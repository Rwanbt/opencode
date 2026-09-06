/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * FC-14 + FC-25 through the REAL DBOS Go candidate.
 *
 * Two REAL OS processes of the same binary (M0_AUTHORITY_ONLY mode)
 * race the Unifia authority fencing on the same SQLite system DB:
 * exactly one claim winner; winner mutations/dispatch ACCEPTED, loser
 * REJECTED (with its own stale gen-1 token). The zombie scenario
 * freezes the old owner mid-request (alive, holding its token), takes
 * over, resumes it - the stale token must be rejected on both paths
 * (master plan 31-33).
 */

import { test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DBOSRealCandidate } from "../src/qualification/adapters/dbos-real.ts"

const DBOS_REAL_BINARY = join(import.meta.dir, "..", "..", "..", "tools", "dbos-real-qualify", "dbos-real-qualify.exe")
const DBOS_REAL_BUILT = existsSync(DBOS_REAL_BINARY)

let testDir = ""

beforeAll(() => {
  if (!DBOS_REAL_BUILT) return
  testDir = mkdtempSync(join(tmpdir(), "fc14-fc25-dbos-"))
})

afterAll(() => {
  if (testDir && existsSync(testDir)) {
    setTimeout(() => { try { rmSync(testDir, { recursive: true, force: true }) } catch { /* best effort on Windows */ } }, 500)
  }
})

test.skipIf(!DBOS_REAL_BUILT)(
  "FC-14: two real OS processes race the authority claim - exactly one winner, loser rejected",
  async () => {
    const storeDir = join(testDir, "race-store")
    const candidate = new DBOSRealCandidate({ storeDir, version: "fc14", buildHash: "fc14-build" })
    await candidate.initialize()
    try {
      const runId = `run-fc14-${Date.now()}` as never
      const race = await candidate.raceAuthorities({
        runId,
        participantA: { authorityOwnerId: "race-A" },
        participantB: { authorityOwnerId: "race-B" },
        sharedStore: storeDir,
      })
      expect(race.measured).toBe(true)
      expect(race.distinctOsProcesses).toBe(2)
      const grants = [race.claimA.granted, race.claimB.granted]
      expect(grants.filter((g) => g)).toHaveLength(1)
      // Winner token: the persisted holder. Loser token: the loser s OWN
      // claimed identity at gen 1 (stale by construction).
      const winnerOwnerId = race.claimA.granted ? "race-A" : "race-B"
      const loserOwnerId = race.claimA.granted ? "race-B" : "race-A"
      const winnerGeneration = race.claimA.granted ? race.claimA.currentGeneration : race.claimB.currentGeneration
      const winnerToken = { runId, generation: winnerGeneration, authorityOwnerId: winnerOwnerId }
      const loserToken = { runId, generation: 1 as never, authorityOwnerId: loserOwnerId }
      const winnerMutate = await candidate.attemptAuthoritativeMutation!({ runId, token: winnerToken, mutation: "WINNER_MUTATE" })
      expect(winnerMutate.accepted).toBe(true)
      const loserMutate = await candidate.attemptAuthoritativeMutation!({ runId, token: loserToken, mutation: "LOSER_MUTATE" })
      expect(loserMutate.accepted).toBe(false)
      const winnerDispatch = await candidate.attemptEffectDispatch!({ runId, token: winnerToken, effectKey: "ek-winner" })
      expect(winnerDispatch.accepted).toBe(true)
      const loserDispatch = await candidate.attemptEffectDispatch!({ runId, token: loserToken, effectKey: "ek-loser" })
      expect(loserDispatch.accepted).toBe(false)
    } finally {
      await candidate.shutdown()
    }
  },
  120_000,
)

test.skipIf(!DBOS_REAL_BUILT)(
  "FC-25: zombie owner - freeze barrier, takeover, stale mutations rejected on resume",
  async () => {
    const storeDir = join(testDir, "zombie-store")
    const candidate = new DBOSRealCandidate({ storeDir, version: "fc25", buildHash: "fc25-build" })
    await candidate.initialize()
    try {
      const zombie = await candidate.runZombieFC25Scenario()
      expect(zombie.measured).toBe(true)
      expect(zombie.distinctOsProcesses).toBe(2)
      expect(zombie.oldOwnerAliveDuringTakeover).toBe(true)
      expect(zombie.newGenerationGreaterThanOld).toBe(true)
      expect(zombie.newOwnerCommitAccepted).toBe(true)
      expect(zombie.staleOwnerCommitRejected).toBe(true)
      expect(zombie.staleOwnerDispatchRejected).toBe(true)
    } finally {
      await candidate.shutdown()
    }
  },
  120_000,
)
