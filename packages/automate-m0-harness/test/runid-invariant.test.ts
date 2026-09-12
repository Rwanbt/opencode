/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * WorkflowRunId identity invariant (mandate §8-§9).
 *
 * The HTTP-returned WorkflowRunId MUST equal:
 *   - the StartRunWorkflow durable RunID, and
 *   - the DBOS root WorkflowID.
 *
 * These three are the SAME identity, minted exactly once by
 * the HTTP handler. The workflow is fail-closed if the input
 * RunID is empty (we set it from the handler). A mismatch
 * is a RUN_IDENTITY_MISMATCH failure surfaced to the
 * harness.
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
  testDir = mkdtempSync(join(tmpdir(), "dbos-runid-invariant-"))
})

afterAll(() => {
  if (testDir && existsSync(testDir)) {
    try { rmSync(testDir, { recursive: true, force: true }) } catch { /* EBUSY */ }
  }
})

test.skipIf(!DBOS_REAL_BUILT)(
  "RunId invariant (mandate §8-§9): the returned WorkflowRunId is the canonical UUID-style RunId, NEVER the OLD `run-<liId>` pattern",
  async () => {
    const storeDir = join(testDir, "runid-uuid")
    const providerDir = join(testDir, "runid-uuid-provider")
    mkdirSync(storeDir, { recursive: true })
    mkdirSync(providerDir, { recursive: true })
    const provider = new FakeExternalEffectProvider({ storeDir: providerDir, dropAckToCandidate: false })
    const candidate = new DBOSRealCandidate({ storeDir, version: "runid-uuid", buildHash: "runid-uuid-build" })
    await candidate.initialize()
    try {
      const liId = `li-runid-${Date.now()}` as never
      const runId = (await candidate.startRun({
        workflowVersionId: "wv-runid" as never,
        ownerScope: { organizationId: "org-1" as never, workspaceId: "ws-1" as never },
        initialLogicalInvocation: {
          logicalInvocationId: liId,
          effectKey: "ek-runid",
          canonicalInput: 1 as never,
        },
        seedCanonicalValue: 1 as never,
      })) as unknown as string
      // The canonical UUID-style runId pattern: `run-<UUID>`.
      expect(runId).toMatch(/^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      // It MUST NOT be the OLD `run-<liId>` pattern.
      expect(runId).not.toBe(`run-${liId}`)
      // After a fresh process restart, the SAME runId is
      // recoverable from durable state.
      await candidate.shutdown()
      const candidate2 = new DBOSRealCandidate({ storeDir, version: "runid-uuid", buildHash: "runid-uuid-build" })
      await candidate2.initialize()
      try {
        const state = await candidate2.inspectRun(runId as never)
        const li = state.logicalInvocations.find(
          (l) => l.logicalInvocationId === liId,
        )
        expect(li).toBeDefined()
        // The recovered liId must match the original (i.e.
        // the durable persist-invocation step preserved it).
        expect(li?.logicalInvocationId).toEqual(liId)
      } finally {
        await candidate2.shutdown()
      }
    } finally {
      void provider
    }
  },
  { timeout: 120_000 },
)
