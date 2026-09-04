/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * FC-32 replay conformance through the Native candidate's own
 * orchestration (frozen pack §44, master plan §23-§27).
 *
 * The harness drives: ambient T1/R1/O1 -> partial checkpoint ->
 * crash (forceProcessCrash) -> reopen -> ambient T2/R2/O2 ->
 * complete. Every measured number comes from the candidate's
 * durable journals; nothing is declared.
 */

import { test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NativeSqliteCandidate } from "../src/qualification/adapters/native-sqlite.ts"
import { FakeExternalEffectProvider } from "../src/qualification/providers/fake-external.ts"

const AMBIENT_INITIAL = { t: "2026-09-04T10:00:00.000Z", r: "alpha-4711", o: "ord-001" }
const AMBIENT_AFTER_CRASH = { t: "2026-09-04T10:05:00.000Z", r: "beta-8263", o: "ord-002" }

let testDir = ""

beforeAll(() => {
  testDir = mkdtempSync(join(tmpdir(), "fc32-native-"))
})

afterAll(() => {
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true })
  }
})

test("FC-32 (frozen §44): completed steps replay, ambient never re-read, EffectKey stable across crash recovery", async () => {
  const storeDir = join(testDir, "store")
  const candidate = new NativeSqliteCandidate({
    storeDir,
    provider: new FakeExternalEffectProvider({ storeDir: join(testDir, "provider"), dropAckToCandidate: false }),
    version: "fc32-test",
    buildHash: "fc32-build",
  })
  await candidate.initialize()
  try {
    expect(candidate.fc32StartScenario).toBeDefined()
    const started = await candidate.fc32StartScenario!({ workflowVersionId: "wf-fc32" as never, ambient: AMBIENT_INITIAL })
    const attempt1 = await candidate.fc32RunAttempt!(started.runId, "crash-before-effect-commit")
    expect(attempt1.committedThroughStep).toBe("derive-effect-key")
    expect(attempt1.effectExecuted).toBe(true)

    // Crash: durable handle dies with the effect journal committed but
    // the execute-effect step output absent.
    await candidate.forceProcessCrash()
    await candidate.reopen()

    // The ambient world moved on during the outage.
    await candidate.fc32SetAmbient(started.runId, AMBIENT_AFTER_CRASH)
    const attempt2 = await candidate.fc32RunAttempt!(started.runId, "complete")
    expect(attempt2.attemptId).not.toBe(attempt1.attemptId)

    const m = await candidate.fc32Measure!(started.runId, { initial: AMBIENT_INITIAL, afterCrash: AMBIENT_AFTER_CRASH })
    expect(m.measured).toBe(true)
    expect(m.rootWorkflowInvocations).toBe(2)
    // Completed steps: captured once, replayed once — bodies never re-ran.
    expect(m.stepBodyInvocations["capture-ambient"]).toBe(1)
    expect(m.stepBodyInvocations["derive-effect-key"]).toBe(1)
    expect(m.stepReplays["capture-ambient"]).toBe(1)
    expect(m.stepReplays["derive-effect-key"]).toBe(1)
    // Incomplete step: body re-ran on the recovery attempt.
    expect(m.stepBodyInvocations["execute-effect"]).toBe(2)
    // THE determinism signal: ambient was read exactly once, pre-crash.
    expect(m.ambientObservedInitial).toEqual(AMBIENT_INITIAL)
    expect(m.ambientObservedAfterCrash).toBeNull()
    // EffectKey derived from RECORDED values, stable across the crash.
    expect(m.effectKeysObserved).toHaveLength(1)
    expect(m.effectKeysObserved[0]).toContain(AMBIENT_INITIAL.r)
    expect(m.effectKeysObserved[0]).not.toContain(AMBIENT_AFTER_CRASH.r)
    // Exactly-once external effect via the stable key.
    expect(m.externalEffectExecutions).toBe(1)
    // Final canonical state reflects the attempt-1 lineage.
    const final = m.finalMaterializedState as { t: string; r: string; o: string; effectKey: string }
    expect(final.t).toBe(AMBIENT_INITIAL.t)
    expect(final.r).toBe(AMBIENT_INITIAL.r)
    expect(final.o).toBe(AMBIENT_INITIAL.o)
    expect(final.effectKey).toBe(m.effectKeysObserved[0])
  } finally {
    await candidate.shutdown()
  }
})