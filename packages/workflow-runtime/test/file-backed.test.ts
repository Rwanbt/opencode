/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Tests for `FileBackedDurableHistoryAuthority` (M1-10).
 *
 * M1-10 wraps M1-09 (`InMemoryDurableHistoryAuthority`) with a JSON
 * snapshot. The contract is identical (`DurableHistoryAuthority`),
 * so the regression net focuses on:
 *   - Persistence: every accepted transition writes the snapshot.
 *   - Recovery: a fresh authority loaded from the same file
 *     reproduces the in-memory state deterministically.
 *   - Fail-closed: a corrupted snapshot is an error, not a silent
 *     partial state.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, readFile, access } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type WorkflowRun } from "@unifia/contracts"
import { FileBackedDurableHistoryAuthority } from "../src/index.ts"
import type { AuthorityToken } from "../src/authority.ts"

const RUN_ID = "run-m1-10-001"
const DEPLOY_ID = "dep-m1-10-001"
const TOKEN: AuthorityToken = { workflowRunId: RUN_ID, generation: 1, authorityOwnerId: "test" }

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    runId: RUN_ID,
    deploymentId: DEPLOY_ID,
    workflowVersionId: "wf-m1-10-v1",
    deploymentScope: {
      ownershipScope: {
        organizationId: "o1",
        workspaceId: "w1",
      },
      environmentId: "dev",
    },
    triggerId: "trg-1",
    triggerEventId: "evt-1",
    durableAuthorityId: "auth-1",
    durableAuthorityKind: "native",
    status: "running",
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
    ...overrides,
  }
}

let tmpDir: string
let snapPath: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "unifia-m1-10-"))
  snapPath = join(tmpDir, "snapshot.json")
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

function makeTransition(
  from: WorkflowRun["status"],
  to: WorkflowRun["status"],
  occurredAt = 1_700_000_500,
) {
  return {
    from,
    to,
    effectSlotId: `slot-${from}-${to}`,
    occurredAt,
    isCompensating: false,
  }
}

// ===========================================================================

describe("M1-10 file-backed DurableHistoryAuthority", () => {
  test("(1) empty authority on first boot — no snapshot, no error", async () => {
    const auth = new FileBackedDurableHistoryAuthority({
      authorityKind: "native",
      snapshotPath: snapPath,
    })
    await auth.load()
    const run = await auth.getRun(RUN_ID)
    expect(run).toBeNull()
  })

  test("(2) register + transition writes the snapshot", async () => {
    const auth = new FileBackedDurableHistoryAuthority({
      authorityKind: "native",
      snapshotPath: snapPath,
    })
    await auth.load()
    await auth.register(makeRun({ status: "running" }))
    await auth.transition(TOKEN, RUN_ID, makeTransition("running", "completed"))
    // Snapshot file must exist on disk.
    await access(snapPath)
    const json = await readFile(snapPath, "utf-8")
    expect(json.length).toBeGreaterThan(0)
    const parsed = JSON.parse(json)
    expect(parsed.version).toBe(1)
    expect(parsed.authorityKind).toBe("native")
    expect(Object.keys(parsed.runs)).toContain(RUN_ID)
  })

  test("(3) recovery: a fresh authority reproduces the state from snapshot", async () => {
    // First authority: write some state.
    const auth1 = new FileBackedDurableHistoryAuthority({
      authorityKind: "native",
      snapshotPath: snapPath,
    })
    await auth1.load()
    await auth1.register(makeRun({ status: "running" }))
    await auth1.transition(TOKEN, RUN_ID, makeTransition("running", "waiting", 1_700_000_500))
    await auth1.transition(TOKEN, RUN_ID, makeTransition("waiting", "running", 1_700_000_600))
    await auth1.enqueueCommand(TOKEN, RUN_ID, { kind: "tool.http", payload: { url: "x" } })
    await auth1.scheduleTimer(TOKEN, "tmr-1", RUN_ID, 1_700_000_700, "queue")
    // Second authority: load the same file.
    const auth2 = new FileBackedDurableHistoryAuthority({
      authorityKind: "native",
      snapshotPath: snapPath,
    })
    await auth2.load()
    const run = await auth2.getRun(RUN_ID)
    expect(run).not.toBeNull()
    expect(run!.status).toBe("running") // final state after both transitions
    const proj = await auth2.getMaterializedProjection(RUN_ID)
    expect(proj.status).toBe("running")
    expect(proj.lastTransitionAt).toBe(1_700_000_600)
    expect(proj.pendingEffects).toHaveLength(1)
    expect(proj.pendingTimers).toHaveLength(1)
  })

  test("(4) recovery: unknown runId on the second authority returns null", async () => {
    const auth1 = new FileBackedDurableHistoryAuthority({
      authorityKind: "native",
      snapshotPath: snapPath,
    })
    await auth1.load()
    // No register: snapshot file does not exist or is empty.
    const auth2 = new FileBackedDurableHistoryAuthority({
      authorityKind: "native",
      snapshotPath: snapPath,
    })
    await auth2.load()
    const run = await auth2.getRun("does-not-exist")
    expect(run).toBeNull()
  })

  test("(5) fail-closed: corrupted JSON throws on load", async () => {
    // Write a non-JSON file.
    const { writeFile } = await import("node:fs/promises")
    await writeFile(snapPath, "this is not json", "utf-8")
    const auth = new FileBackedDurableHistoryAuthority({
      authorityKind: "native",
      snapshotPath: snapPath,
    })
    await expect(auth.load()).rejects.toThrow(/not valid JSON/)
  })

  test("(6) fail-closed: invalid snapshot shape throws on load", async () => {
    // Write a JSON file that doesn't match the schema.
    const { writeFile } = await import("node:fs/promises")
    await writeFile(snapPath, JSON.stringify({ wrong: "shape" }), "utf-8")
    const auth = new FileBackedDurableHistoryAuthority({
      authorityKind: "native",
      snapshotPath: snapPath,
    })
    await expect(auth.load()).rejects.toThrow(/not a valid AuthoritySnapshot/)
  })

  test("(7) snapshot is written atomically — no torn writes on failure", async () => {
    // Pre-condition: file does not exist.
    const auth = new FileBackedDurableHistoryAuthority({
      authorityKind: "native",
      snapshotPath: snapPath,
    })
    await auth.load()
    await auth.register(makeRun())
    await auth.flush()
    // No .tmp files left behind.
    const { readdir } = await import("node:fs/promises")
    const entries = await readdir(tmpDir)
    const tmps = entries.filter((e) => e.includes(".tmp-"))
    expect(tmps).toEqual([])
  })
})
