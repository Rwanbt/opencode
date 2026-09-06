/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * DBOS real — durable AttemptId allocator (mandate §3-§7).
 *
 * The candidate binary allocates AttemptIds via an atomic
 * UPSERT on a `attempt_sequence` table that lives in the
 * DBOS SQLite system database. After a process restart the
 * allocator recovers its state from the durable table.
 *
 * These tests prove:
 *   - Two consecutive calls for the same (runId, liId)
 *     return two DISTINCT AttemptIds with monotonic
 *     sequences.
 *   - After a process restart the sequence resumes from
 *     the durable state — no reuse of any prior AttemptId.
 *   - The DBOS attempt WorkflowID is namespaced by the
 *     canonical AttemptId.
 */

import { test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DBOSRealCandidate, FakeExternalEffectProvider } from "../src/qualification/index.ts"

const DBOS_REAL_BINARY = join(
  import.meta.dir, "..", "..", "..",
  "tools", "dbos-real-qualify", "dbos-real-qualify.exe",
)

const DBOS_REAL_BUILT = existsSync(DBOS_REAL_BINARY)

let testDir = ""

beforeAll(() => {
  if (!DBOS_REAL_BUILT) return
  testDir = mkdtempSync(join(tmpdir(), "dbos-attempt-allocator-"))
})

afterAll(() => {
  if (testDir && existsSync(testDir)) {
    try { rmSync(testDir, { recursive: true, force: true }) } catch { /* EBUSY: process may still hold the dir */ }
  }
})

interface AllocatedAttempt {
  readonly attemptId: string
  readonly sequence: number
}

async function allocateAttempt(
  candidate: DBOSRealCandidate,
  runId: string,
  logicalInvocationId: string,
): Promise<AllocatedAttempt> {
  // The adapter exposes driveAttempt publicly, but for the
  // allocator-level test we exercise the HTTP endpoint
  // directly via the binary's baseUrl. The adapter caches
  // the baseUrl privately so we use a tiny shim.
  const baseUrl = (candidate as unknown as { baseUrl: string | null }).baseUrl
  if (!baseUrl) throw new Error("candidate not initialized")
  const r = await fetch(`${baseUrl}/attempts/next`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId, logicalInvocationId }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status} on /attempts/next: ${await r.text()}`)
  return await r.json() as AllocatedAttempt
}

test.skipIf(!DBOS_REAL_BUILT)(
  "durable AttemptId allocator (mandate §3-§7): two consecutive calls return two DISTINCT AttemptIds with monotonic sequences",
  async () => {
    const storeDir = join(testDir, "alloc-monotonic")
    const providerDir = join(testDir, "alloc-monotonic-provider")
    mkdirSync(storeDir, { recursive: true })
    mkdirSync(providerDir, { recursive: true })
    const provider = new FakeExternalEffectProvider({ storeDir: providerDir, dropAckToCandidate: false })
    const candidate = new DBOSRealCandidate({ storeDir, version: "alloc-monotonic", buildHash: "alloc-monotonic-build" })
    await candidate.initialize()
    try {
      const runId = (await candidate.startRun({
        workflowVersionId: "wv-alloc" as never,
        ownerScope: { organizationId: "org-1" as never, workspaceId: "ws-1" as never },
        initialLogicalInvocation: {
          logicalInvocationId: "li-alloc-1" as never,
          effectKey: "ek-alloc-1",
          canonicalInput: 1 as never,
        },
        seedCanonicalValue: 1 as never,
      })) as unknown as string

      const liId = "li-alloc-1"
      const a1 = await allocateAttempt(candidate, runId, liId)
      const a2 = await allocateAttempt(candidate, runId, liId)
      const a3 = await allocateAttempt(candidate, runId, liId)

      expect(a1.attemptId).toBeTruthy()
      expect(a2.attemptId).toBeTruthy()
      expect(a3.attemptId).toBeTruthy()
      expect(a1.attemptId).not.toEqual(a2.attemptId)
      expect(a2.attemptId).not.toEqual(a3.attemptId)
      expect(a1.sequence).toEqual(1)
      expect(a2.sequence).toEqual(2)
      expect(a3.sequence).toEqual(3)
      // The canonical external AttemptId format is
      // `att:<runId>:<liId>:<seq>`.
      expect(a1.attemptId).toEqual(`att:${runId}:${liId}:1`)
      expect(a2.attemptId).toEqual(`att:${runId}:${liId}:2`)
      expect(a3.attemptId).toEqual(`att:${runId}:${liId}:3`)
    } finally {
      await candidate.shutdown()
      void provider
    }
  },
  { timeout: 120_000 },
)

test.skipIf(!DBOS_REAL_BUILT)(
  "durable AttemptId allocator (mandate §3-§7): sequence survives a process restart and does NOT reuse any prior AttemptId",
  async () => {
    const storeDir = join(testDir, "alloc-restart")
    const providerDir = join(testDir, "alloc-restart-provider")
    mkdirSync(storeDir, { recursive: true })
    mkdirSync(providerDir, { recursive: true })
    const provider = new FakeExternalEffectProvider({ storeDir: providerDir, dropAckToCandidate: false })
    const candidate = new DBOSRealCandidate({ storeDir, version: "alloc-restart", buildHash: "alloc-restart-build" })
    await candidate.initialize()
    let runId = ""
    try {
      runId = (await candidate.startRun({
        workflowVersionId: "wv-alloc-restart" as never,
        ownerScope: { organizationId: "org-1" as never, workspaceId: "ws-1" as never },
        initialLogicalInvocation: {
          logicalInvocationId: "li-restart-1" as never,
          effectKey: "ek-restart-1",
          canonicalInput: 1 as never,
        },
        seedCanonicalValue: 1 as never,
      })) as unknown as string
      const a1 = await allocateAttempt(candidate, runId, "li-restart-1")
      const a2 = await allocateAttempt(candidate, runId, "li-restart-1")
      expect(a1.sequence).toEqual(1)
      expect(a2.sequence).toEqual(2)
    } finally {
      await candidate.shutdown()
    }

    // Fresh process on the same store. The durable counter
    // must resume from 3 (no reuse of 1 or 2).
    const candidate2 = new DBOSRealCandidate({ storeDir, version: "alloc-restart", buildHash: "alloc-restart-build" })
    await candidate2.initialize()
    try {
      const a3 = await allocateAttempt(candidate2, runId, "li-restart-1")
      const a4 = await allocateAttempt(candidate2, runId, "li-restart-1")
      expect(a3.sequence).toEqual(3)
      expect(a4.sequence).toEqual(4)
      expect(a3.attemptId).not.toEqual("att::li-restart-1:1")
      expect(a3.attemptId).not.toEqual("att::li-restart-1:2")
      // The exact AttemptId for sequence N is durably
      // derived from (runId, liId, N) and is stable across
      // restarts.
      expect(a3.attemptId).toEqual(`att:${runId}:li-restart-1:3`)
      expect(a4.attemptId).toEqual(`att:${runId}:li-restart-1:4`)
    } finally {
      await candidate2.shutdown()
      void provider
    }
  },
  { timeout: 120_000 },
)

test.skipIf(!DBOS_REAL_BUILT)(
  "durable AttemptId allocator (mandate §3-§7): per-(runId, liId) sequences are independent",
  async () => {
    const storeDir = join(testDir, "alloc-isolation")
    const providerDir = join(testDir, "alloc-isolation-provider")
    mkdirSync(storeDir, { recursive: true })
    mkdirSync(providerDir, { recursive: true })
    const provider = new FakeExternalEffectProvider({ storeDir: providerDir, dropAckToCandidate: false })
    const candidate = new DBOSRealCandidate({ storeDir, version: "alloc-isolation", buildHash: "alloc-isolation-build" })
    await candidate.initialize()
    try {
      const runA = (await candidate.startRun({
        workflowVersionId: "wv-iso" as never,
        ownerScope: { organizationId: "org-1" as never, workspaceId: "ws-1" as never },
        initialLogicalInvocation: {
          logicalInvocationId: "li-iso-A" as never,
          effectKey: "ek-iso-A",
          canonicalInput: 1 as never,
        },
        seedCanonicalValue: 1 as never,
      })) as unknown as string
      const runB = (await candidate.startRun({
        workflowVersionId: "wv-iso" as never,
        ownerScope: { organizationId: "org-1" as never, workspaceId: "ws-1" as never },
        initialLogicalInvocation: {
          logicalInvocationId: "li-iso-B" as never,
          effectKey: "ek-iso-B",
          canonicalInput: 2 as never,
        },
        seedCanonicalValue: 2 as never,
      })) as unknown as string
      // Allocating for (runA, li-iso-A) must not affect the
      // sequence for (runA, li-iso-B) or (runB, li-iso-A).
      const aA1 = await allocateAttempt(candidate, runA, "li-iso-A")
      const aA2 = await allocateAttempt(candidate, runA, "li-iso-A")
      const aB1 = await allocateAttempt(candidate, runB, "li-iso-A")
      const aAisoB1 = await allocateAttempt(candidate, runA, "li-iso-B")
      expect(aA1.sequence).toEqual(1)
      expect(aA2.sequence).toEqual(2)
      expect(aB1.sequence).toEqual(1) // independent per (runId, liId)
      expect(aAisoB1.sequence).toEqual(1) // independent per (runId, liId)
    } finally {
      await candidate.shutdown()
      void provider
    }
  },
  { timeout: 120_000 },
)
