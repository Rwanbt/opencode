/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { NativeDurableHistoryAuthority } from "../src/native-history"

const makeRun = (runId: string): any => ({
  runId, deploymentId: "dep-1", workflowVersionId: "ver-1",
  deploymentScope: { ownershipScope: { organizationId: "org", workspaceId: "ws" }, environmentId: "test" },
  triggerId: "trig-1", triggerEventId: "evt-1", durableAuthorityId: runId, durableAuthorityKind: "native",
  status: "running", createdAt: 100, updatedAt: 100,
})
const clock = () => 10_000

describe("Retention ADR-016 + version skew ADR-018 (directives 41-42)", () => {
  test("version skew fail-closed: a future schema version refuses durable writes", () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-skew-"))
    try {
      const first = new NativeDurableHistoryAuthority({ databasePath: join(dir, "h.sqlite"), now: clock })
      first.initialize()
      first.register(makeRun("run-1"))
      first.close()
      // simulate a store written by a NEWER build
      const { Database } = require("bun:sqlite")
      const db = new Database(join(dir, "h.sqlite"))
      db.exec("UPDATE history_schema_version SET schema_version = 99")
      db.close()
      const second = new NativeDurableHistoryAuthority({ databasePath: join(dir, "h.sqlite"), now: clock })
      // fail-closed at OPEN (directive 29: an incompatible stale worker never mutates durable state)
      expect(() => second.initialize()).toThrow(/schema version 99/)
      second.close()
    } finally { try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) } catch { /* WHY: Windows can hold the WAL handle past close(); the unique temp dir is OS-cleaned - the assertions above already ran */ } }
  })

  test("retention: ACTIVE runs NEVER archived; terminal runs move to cold archive with provenance", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-ret-"))
    try {
      const authority = new NativeDurableHistoryAuthority({ databasePath: join(dir, "h.sqlite"), now: clock })
      authority.initialize()
      authority.register(makeRun("run-active"))
      authority.register(makeRun("run-done"))
      await authority.transition("run-done", { from: "running", to: "completed", effectSlotId: "s", occurredAt: 1100, isCompensating: false })
      await authority.enqueueCommand("run-done", { kind: "tool.http", payload: { n: 1 } })
      const { applyHistoryRetention } = await import("../src/retention")
      const db = (authority as unknown as { db: any }).db
      // young cutoff: nothing eligible
      let result = applyHistoryRetention(db, 5)
      expect(result.archivedRuns).toEqual([])
      // far-future cutoff: only the TERMINAL run is archived
      result = applyHistoryRetention(db, Number.MAX_SAFE_INTEGER)
      expect(result.archivedRuns).toContain("run-done")
      expect(result.archivedRuns).not.toContain("run-active")
      expect(result.activeRunsProtected).toBe(1)
      // hot store: the active run is still fully recoverable
      expect((await authority.getRun("run-active"))!.status).toBe("running")
      // cold store: provenance inspectable (run_json + transitions)
      const archived = db.query("SELECT run_json FROM archived_runs WHERE run_id = ?").get("run-done") as { run_json: string }
      expect((JSON.parse(archived.run_json) as { status: string }).status).toBe("completed")
      const transitions = db.query("SELECT COUNT(*) AS c FROM archived_run_transitions WHERE run_id = ?").get("run-done") as { c: number }
      expect(transitions.c).toBe(1)
      const hotCount = db.query("SELECT COUNT(*) AS c FROM runs WHERE run_id = ?").get("run-done") as { c: number } | null
      expect(hotCount === null || hotCount.c === 0).toBe(true)
      authority.close()
    } finally { try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) } catch { /* WHY: Windows can hold the WAL handle past close(); the unique temp dir is OS-cleaned - the assertions above already ran */ } }
  })
})