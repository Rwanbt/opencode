/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * FC-32 + FC-04 through the REAL DBOS Go candidate.
 *
 * FC-32: the Go binary runs a real DBOS workflow (RunAsStep steps);
 * the harness kills the process mid-step (after the external effect
 * journal commits) and the recovery happens through REAL DBOS
 * recoverPendingWorkflows on the fresh process — never reconstructed
 * in the adapter (master plan section 25).
 *
 * FC-04: the Go candidate performs the real HTTP dispatch against the
 * shared provider process; the lost ACK is a genuine transport failure.
 */

import { test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DBOSRealCandidate } from "../src/qualification/adapters/dbos-real.ts"
import { startRealProviderProcess, type RealProviderProcess } from "../src/qualification/providers/real-provider-process.ts"

const AMBIENT_INITIAL = { t: "2026-09-04T10:00:00.000Z", r: "alpha-4711", o: "ord-001" }
const AMBIENT_AFTER_CRASH = { t: "2026-09-04T10:05:00.000Z", r: "beta-8263", o: "ord-002" }

const DBOS_REAL_BINARY = join(import.meta.dir, "..", "..", "..", "tools", "dbos-real-qualify", "dbos-real-qualify.exe")
const DBOS_REAL_BUILT = existsSync(DBOS_REAL_BINARY)

let testDir = ""
let provider: RealProviderProcess | null = null

beforeAll(async () => {
  if (!DBOS_REAL_BUILT) return
  testDir = mkdtempSync(join(tmpdir(), "fc32-fc04-dbos-"))
  provider = await startRealProviderProcess(join(testDir, "provider-journal"))
})

afterAll(() => {
  if (provider) provider.stop()
  if (testDir && existsSync(testDir)) {
    setTimeout(() => { try { rmSync(testDir, { recursive: true, force: true }) } catch { /* best effort on Windows */ } }, 500)
  }
})

test.skipIf(!DBOS_REAL_BUILT)(
  "FC-32: real DBOS workflow replays completed steps after a REAL process kill (no ambient re-read, stable EffectKey)",
  async () => {
    const storeDir = join(testDir, "fc32-store")
    const candidate = new DBOSRealCandidate({ storeDir, version: "fc32", buildHash: "fc32-build" })
    await candidate.initialize()
    try {
      const started = await candidate.fc32StartScenario!({ workflowVersionId: "wf-fc32" as never, ambient: AMBIENT_INITIAL })
      const attempt1 = await candidate.fc32RunAttempt!(started.runId, "crash-before-effect-commit")
      expect(attempt1.effectExecuted).toBe(true)

      // REAL process kill mid-step (SIGKILL, store preserved).
      await candidate.forceProcessCrash()
      await candidate.reopen()

      // The ambient world moved on during the outage.
      await candidate.fc32SetAmbient(started.runId, AMBIENT_AFTER_CRASH)
      const attempt2 = await candidate.fc32RunAttempt!(started.runId, "complete")
      expect(attempt2.attemptId).not.toBe(attempt1.attemptId)

      const m = await candidate.fc32Measure!(started.runId, { initial: AMBIENT_INITIAL, afterCrash: AMBIENT_AFTER_CRASH })
      expect(m.measured).toBe(true)
      // The workflow function executed twice (original + DBOS recovery).
      expect(m.rootWorkflowInvocations).toBe(2)
      // Completed steps: body ran once, replayed on recovery.
      expect(m.stepBodyInvocations["capture-ambient"]).toBe(1)
      expect(m.stepReplays["capture-ambient"]).toBe(1)
      expect(m.stepReplays["derive-effect-key"]).toBe(1)
      // Incomplete step: body re-ran through DBOS recovery.
      expect(m.stepBodyInvocations["execute-effect"]).toBe(2)
      // THE determinism signal: ambient read exactly once, pre-crash.
      expect(m.ambientObservedInitial).toEqual(AMBIENT_INITIAL)
      expect(m.ambientObservedAfterCrash).toBeNull()
      // EffectKey derived from RECORDED values, stable across recovery.
      expect(m.effectKeysObserved).toHaveLength(1)
      expect(m.effectKeysObserved[0]).toContain(AMBIENT_INITIAL.r)
      expect(m.effectKeysObserved[0]).not.toContain(AMBIENT_AFTER_CRASH.r)
      expect(m.externalEffectExecutions).toBe(1)
      const final = m.finalMaterializedState as { t: string; r: string; o: string; effectKey: string }
      expect(final.t).toBe(AMBIENT_INITIAL.t)
      expect(final.r).toBe(AMBIENT_INITIAL.r)
      expect(final.effectKey).toBe(m.effectKeysObserved[0])
    } finally {
      await candidate.shutdown()
    }
  },
  180_000,
)

test.skipIf(!DBOS_REAL_BUILT)(
  "FC-04: Go candidate real HTTP dispatch, real ACK loss, recovery reconciles via provider journal",
  async () => {
    expect(provider).not.toBeNull()
    const storeDir = join(testDir, "fc04-store")
    const candidate = new DBOSRealCandidate({ storeDir, version: "fc04", buildHash: "fc04-build" })
    await candidate.initialize()
    try {
      const started = await candidate.fc32StartScenario!({ workflowVersionId: "wf-fc04" as never, ambient: { t: "t1", r: "r1", o: "o1" } })
      const outcome = await candidate.fc04Dispatch!({
        runId: started.runId,
        effectKey: "ek-fc04-dbos-ack-lost",
        canonicalInput: { op: "external-write" },
        providerBaseUrl: provider!.baseUrl,
        mode: "drop-ack",
      })
      expect(outcome.status).toBe("UNKNOWN_EXTERNAL_STATE")
      expect(outcome.transportError).not.toBeNull()

      await candidate.forceProcessCrash()
      await candidate.reopen()

      const recovery = await candidate.fc04Recover!({ runId: started.runId, effectKey: "ek-fc04-dbos-ack-lost", providerBaseUrl: provider!.baseUrl })
      expect(recovery.status).toBe("RECONCILED")
      expect(recovery.providerCanonicalResult).toBeTruthy()
      expect(recovery.blindRetryCount).toBe(0)

      const m = await candidate.fc04Measure!({ runId: started.runId, providerBaseUrl: provider!.baseUrl })
      expect(m.measured).toBe(true)
      expect(m.providerJournalConfirmsCommit).toBe(true)
      expect(m.blindRetryCount).toBe(0)
      expect(m.recoveryStatus).toBe("RECONCILED")
    } finally {
      await candidate.shutdown()
    }
  },
  180_000,
)
