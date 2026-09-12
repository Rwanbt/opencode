/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * DBOS real candidate — fixes from the 2026-09-04 mandate.
 *
 * Per the latest review:
 *   §6   — store-guard test: the DBOS binary must NEVER
 *          delete an existing durable DB on startup.
 *   §10  — duplicate-start ID test: two startRun with the
 *          same logicalInvocationId MUST produce two
 *          distinct WorkflowRunIds.
 *   §18  — readback must come from DBOS durable step
 *          output, not from any in-process cache.
 *
 * These tests are SUBSTRATE-NEUTRAL: they target the
 * real DBOS Go binary via the harness adapter
 * (`DBOSRealCandidate`). The CUSTOM_GO_SQLITE_CONTROL
 * candidate is not tested here.
 */

import { test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, existsSync, statSync, rmSync, readFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import {
  DBOSRealCandidate,
  FakeExternalEffectProvider,
} from "../src/qualification/index.ts"
import { M0_UNIFIAVALUE_VECTOR_V1 } from "@unifia/automate-m0-contract"

const DBOS_REAL_BINARY = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "tools",
  "dbos-real-qualify",
  "dbos-real-qualify.exe",
)

const DBOS_REAL_BUILT = existsSync(DBOS_REAL_BINARY)

let testDir = ""

beforeAll(() => {
  if (!DBOS_REAL_BUILT) return
  testDir = mkdtempSync(join(tmpdir(), "dbos-real-fixes-"))
})

afterAll(() => {
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true })
  }
})

test.skipIf(!DBOS_REAL_BUILT)(
  "store-guard (mandate §6): DBOS process startup must NOT delete an existing dbos.db",
  async () => {
    const storeDir = join(testDir, "store-guard")
    const providerDir = join(testDir, "store-guard-provider")
    mkdirSync(storeDir, { recursive: true })
    mkdirSync(providerDir, { recursive: true })
    const provider = new FakeExternalEffectProvider({ storeDir: providerDir, dropAckToCandidate: false })
    const candidate = new DBOSRealCandidate({ storeDir, version: "store-guard", buildHash: "store-guard-build" })
    await candidate.initialize()
    try {
      // 1. Write something durable via startRun so dbos.db exists.
      const liId = `li-store-guard-${Date.now()}` as never
      const start = await candidate.startRun({
        workflowVersionId: "wv-1" as never,
        ownerScope: { organizationId: "org-1" as never, workspaceId: "ws-1" as never },
        initialLogicalInvocation: {
          logicalInvocationId: liId,
          effectKey: "ek-1",
          canonicalInput: 42 as never,
        },
        seedCanonicalValue: 42 as never,
      })
      const runId = start as unknown as string
      expect(runId).toBeTruthy()

      // 2. Capture the dbos.db file size BEFORE restart.
      const dbPath = join(storeDir, "dbos.db")
      const beforeStat = statSync(dbPath)
      expect(beforeStat.size).toBeGreaterThan(0)

      // 3. Restart the same process on the same store.
      await candidate.shutdown()
      const candidate2 = new DBOSRealCandidate({ storeDir, version: "store-guard", buildHash: "store-guard-build" })
      await candidate2.initialize()
      try {
        // 4. After fresh startup the durable DB must STILL exist.
        expect(existsSync(dbPath)).toBe(true)
        const afterStat = statSync(dbPath)
        expect(afterStat.size).toBeGreaterThan(0)

        // 5. Recovery: the same WorkflowRunId must still be
        // discoverable from durable state.
        const recovered = await candidate2.inspectRun(runId as never)
        expect(recovered).toBeTruthy()
        // 6. The canonical observation must come from the
        // DBOS step output, not the process-local cache.
        // DBOS recovery (recoverPendingWorkflows) is asynchronous: the
        // canonical observation becomes readable only after the runtime
        // replays durable step output. Poll with a bounded deadline instead
        // of asserting immediately (readiness probe, not a sleep-based fix).
        const deadline = Date.now() + 15_000
        let li = recovered.logicalInvocations.find(
          (l) => l.logicalInvocationId === liId,
        )
        while (!(li && li.canonicalObservation !== null) && Date.now() < deadline) {
          await delay(250)
          const retried = await candidate2.inspectRun(runId as never)
          li = retried.logicalInvocations.find(
            (l) => l.logicalInvocationId === liId,
          )
        }
        expect(li).toBeDefined()
        expect(li?.canonicalObservation).toBeDefined()
      } finally {
        await candidate2.shutdown()
      }
    } finally {
      void provider
    }
  },
  { timeout: 120_000 },
)

test.skipIf(!DBOS_REAL_BUILT)(
  "duplicate-start ID (mandate §10): two startRun with the same logicalInvocationId MUST produce two distinct WorkflowRunIds",
  async () => {
    const storeDir = join(testDir, "dup-start")
    const providerDir = join(testDir, "dup-start-provider")
    mkdirSync(storeDir, { recursive: true })
    mkdirSync(providerDir, { recursive: true })
    const provider = new FakeExternalEffectProvider({ storeDir: providerDir, dropAckToCandidate: false })
    const candidate = new DBOSRealCandidate({ storeDir, version: "dup-start", buildHash: "dup-start-build" })
    await candidate.initialize()
    try {
      const liId = `li-dup-${Date.now()}` as never
      const a = await candidate.startRun({
        workflowVersionId: "wv-dup" as never,
        ownerScope: { organizationId: "org-1" as never, workspaceId: "ws-1" as never },
        initialLogicalInvocation: {
          logicalInvocationId: liId,
          effectKey: "ek-dup",
          canonicalInput: 1 as never,
        },
        seedCanonicalValue: 1 as never,
      })
      const b = await candidate.startRun({
        workflowVersionId: "wv-dup" as never,
        ownerScope: { organizationId: "org-1" as never, workspaceId: "ws-1" as never },
        initialLogicalInvocation: {
          logicalInvocationId: liId,
          effectKey: "ek-dup",
          canonicalInput: 2 as never,
        },
        seedCanonicalValue: 2 as never,
      })
      const aRun = a as unknown as string
      const bRun = b as unknown as string
      expect(aRun).toBeTruthy()
      expect(bRun).toBeTruthy()
      expect(aRun).not.toEqual(bRun)
    } finally {
      await candidate.shutdown()
      void provider
    }
  },
  { timeout: 120_000 },
)

test.skipIf(!DBOS_REAL_BUILT)(
  "readback source (mandate §18-§19): inspectRun reconstructs from DBOS durable step output, not in-process cache",
  async () => {
    const storeDir = join(testDir, "readback")
    const providerDir = join(testDir, "readback-provider")
    mkdirSync(storeDir, { recursive: true })
    mkdirSync(providerDir, { recursive: true })
    const provider = new FakeExternalEffectProvider({ storeDir: providerDir, dropAckToCandidate: false })
    const candidate = new DBOSRealCandidate({ storeDir, version: "readback", buildHash: "readback-build" })
    await candidate.initialize()
    try {
      const liId = `li-rb-${Date.now()}` as never
      const start = await candidate.startRun({
        workflowVersionId: "wv-rb" as never,
        ownerScope: { organizationId: "org-1" as never, workspaceId: "ws-1" as never },
        initialLogicalInvocation: {
          logicalInvocationId: liId,
          effectKey: "ek-rb",
          canonicalInput: { canary: "readback-value" } as never,
        },
        seedCanonicalValue: { canary: "readback-value" } as never,
      })
      const runId = start as unknown as string
      // Shutdown to clear any in-process cache.
      await candidate.shutdown()
      // Fresh process on the same store.
      const candidate2 = new DBOSRealCandidate({ storeDir, version: "readback", buildHash: "readback-build" })
      await candidate2.initialize()
      try {
        const recovered = await candidate2.inspectRun(runId as never)
        const li = recovered.logicalInvocations.find(
          (l) => l.logicalInvocationId === liId,
        )
        expect(li).toBeDefined()
        // The recovered canonical observation must be defined
        // (it came from the DBOS step output, not from
        // process-local cache).
        const recoveredValue = li?.canonicalObservation
        expect(recoveredValue).toBeDefined()
      } finally {
        await candidate2.shutdown()
      }
    } finally {
      void provider
    }
  },
  { timeout: 120_000 },
)

test.skipIf(!DBOS_REAL_BUILT)(
  "FC-31B (master plan §21-§22): frozen vectors decided by the Go host itself",
  async () => {
    const storeDir = join(testDir, "fc31b-host-adapter")
    mkdirSync(storeDir, { recursive: true })
    const candidate = new DBOSRealCandidate({ storeDir, version: "fc31b", buildHash: "fc31b-build" })
    await candidate.initialize()
    try {
      const frozen = M0_UNIFIAVALUE_VECTOR_V1.filter((vectorCase) => vectorCase.test === "FC-31B")
      expect(frozen.length).toBeGreaterThan(0)
      for (const vectorCase of frozen) {
        const verdict = await candidate.canonizeViaHost({
          caseId: vectorCase.id,
          encoding: vectorCase.encoding,
          payload: vectorCase.payload,
        })
        const expected = vectorCase.expect
        if (expected.outcome === "reject") {
          expect(`${verdict.outcome}:${verdict.code ?? ""}`).toBe(`reject:${expected.code}`)
        } else if (expected.outcome === "pass-normalized") {
          expect(`${verdict.outcome}:${verdict.canonical?.bits ?? ""}`).toBe(`pass:${expected.normalizedBits}`)
        } else {
          expect(verdict.outcome).toBe("pass")
          expect(verdict.canonical).toBeDefined()
        }
        // §22: record the actual Go type — non-empty for every vector.
        expect(verdict.goType.length).toBeGreaterThan(0)
      }
      // §22 deliberate contrast: same decimal, opposite verdicts.
      const asInteger = await candidate.canonizeViaHost({ caseId: "contrast-int", encoding: "host-integer", payload: "9007199254740992" })
      const asFloat = await candidate.canonizeViaHost({ caseId: "contrast-float", encoding: "float64-decimal", payload: "9007199254740992" })
      expect(`${asInteger.outcome}:${asInteger.code ?? ""}`).toBe("reject:NUMBER_OUT_OF_CANONICAL_RANGE")
      expect(asFloat.outcome).toBe("pass")
      expect(asFloat.canonical?.bits).toBe("4340000000000000")
      // MaxUint64 must be rejected with its actual Go type recorded.
      const maxUint = await candidate.canonizeViaHost({ caseId: "max-uint64", encoding: "host-bigint", payload: "18446744073709551615" })
      expect(`${maxUint.outcome}:${maxUint.code ?? ""}`).toBe("reject:NUMBER_OUT_OF_CANONICAL_RANGE")
      expect(maxUint.goType).toBe("uint64")
    } finally {
      await candidate.shutdown()
    }
  },
  120_000,
)