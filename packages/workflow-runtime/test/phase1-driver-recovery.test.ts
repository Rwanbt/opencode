/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Phase 1 driver recovery matrix: every crash window between durable
 * writes must converge on re-drive from persistent facts only.
 * No in-memory counters, no blind redispatch, no wedges.
 */
import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { claimAuthority } from "../src/authority.js"
import { GraphRuntimeEngine } from "../src/graph-runtime.js"
import { NativeAttemptAuthority } from "../src/native-attempts.js"
import { NativeDurableHistoryAuthority } from "../src/native-history.js"
import { driveToQuiescence } from "../src/nodes/driver.js"
import { NodeExecutionError } from "../src/nodes/io.js"
import { BUILTIN_NODE_DEFINITIONS, NodeRegistry } from "../src/nodes/registry.js"
import type { WorkflowDefinition } from "@unifia/contracts"

const NOW = 1000

function definition(): WorkflowDefinition {
  return {
    definitionId: "wf-recovery",
    ownershipScope: { organizationId: "o", workspaceId: "ws" },
    displayName: "wf-recovery",
    nodes: [{ id: "httpa", family: "tool.http", config: { method: "GET", url: "http://127.0.0.1:9/x" } }],
    edges: [],
    concurrency: { kind: "single" },
    defaultFailurePolicy: { kind: "propagate" },
    defaultTimeoutMs: 0,
    createdAt: 0,
    updatedAt: 0,
  }
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "phase1-recovery-"))
  const path = join(dir, "r.sqlite")
  const db = new Database(path)
  const history = new NativeDurableHistoryAuthority({ databasePath: path, now: () => NOW, database: db })
  history.initialize()
  const attempts = new NativeAttemptAuthority({ databasePath: path, now: () => NOW })
  attempts.initialize()
  const engine = new GraphRuntimeEngine({ databasePath: path, definition: definition(), now: () => NOW, database: db })
  engine.initialize()
  history.register({
    runId: "run-1", deploymentId: "dep", workflowVersionId: "v1",
    deploymentScope: { ownershipScope: { organizationId: "o", workspaceId: "ws" }, environmentId: "test" },
    triggerId: "t", triggerEventId: "e", durableAuthorityId: "run-1", durableAuthorityKind: "native",
    status: "running", createdAt: 1, updatedAt: 1,
  } as never)
  const token = claimAuthority(db, "run-1", "owner-a", NOW)
  engine.claimAuthority("run-1", "owner-a")
  engine.startRun("run-1", token)
  return { dir, path, db, history, attempts, engine, token }
}

function registry(): NodeRegistry {
  const registry = new NodeRegistry()
  for (const def of BUILTIN_NODE_DEFINITIONS) registry.register(def)
  return registry
}

function failStub(): { fetch: typeof fetch; hits: { count: number } } {
  const hits = { count: 0 }
  const fetch = (async () => {
    hits.count += 1
    return new Response("broken", { status: 500 })
  }) as typeof fetch
  return { fetch, hits }
}

describe("driver crash recovery (durable facts only)", () => {
  test("crash after SUCCEEDED before graph completion heals without redispatch", async () => {
    const ctx = setup()
    try {
      const reg = registry()
      // Simulate the crash window: attempt minted + outcome recorded, graph untouched.
      const attempt = ctx.attempts.allocateAttempt(ctx.token, "httpa", "node:httpa")
      ctx.attempts.recordAttemptOutcome(ctx.token, "httpa", attempt.attemptId, "SUCCEEDED", { result: { json: { ok: true } } })
      const fail = failStub()
      const report = await driveToQuiescence({
        engine: ctx.engine, attempts: ctx.attempts, history: ctx.history,
        definition: definition(), token: ctx.token, registry: reg,
        options: { fetchImpl: fail.fetch },
      })
      expect(fail.hits.count).toBe(0)
      expect(ctx.engine.nodeState("run-1", "httpa")!.status).toBe("COMPLETED")
      expect(report.dispatched.some((d) => d.nodeId === "httpa" && d.status === "completed")).toBe(true)
    } finally {
      ctx.db.close()
      rmSync(ctx.dir, { recursive: true, force: true })
    }
  })

  test("crash after FAILED before authorize converges terminal, no retry", async () => {
    const ctx = setup()
    try {
      const reg = registry()
      const attempt = ctx.attempts.allocateAttempt(ctx.token, "httpa", "node:httpa")
      ctx.attempts.recordAttemptOutcome(ctx.token, "httpa", attempt.attemptId, "FAILED", { result: { error: "boom" } })
      const fail = failStub()
      const report = await driveToQuiescence({
        engine: ctx.engine, attempts: ctx.attempts, history: ctx.history,
        definition: definition(), token: ctx.token, registry: reg,
        options: { fetchImpl: fail.fetch },
      })
      expect(fail.hits.count).toBe(0)
      expect(ctx.engine.nodeState("run-1", "httpa")!.status).toBe("FAILED")
      expect(report.terminal).toBe(false)
    } finally {
      ctx.db.close()
      rmSync(ctx.dir, { recursive: true, force: true })
    }
  })

  test("crash after authorize before allocate resumes the authorized retry", async () => {
    const ctx = setup()
    try {
      const reg = registry()
      const attempt = ctx.attempts.allocateAttempt(ctx.token, "httpa", "node:httpa")
      ctx.attempts.recordAttemptOutcome(ctx.token, "httpa", attempt.attemptId, "FAILED", { result: { error: "boom" } })
      ctx.attempts.authorizeRetry(ctx.token, "node:httpa")
      // Simulate restart: fresh handles on the same file.
      ctx.db.close()
      const db2 = new Database(ctx.path)
      const history2 = new NativeDurableHistoryAuthority({ databasePath: ctx.path, now: () => NOW, database: db2 })
      const attempts2 = new NativeAttemptAuthority({ databasePath: ctx.path, now: () => NOW })
      const engine2 = new GraphRuntimeEngine({ databasePath: ctx.path, definition: definition(), now: () => NOW, database: db2 })
      engine2.initialize()
      const fail = failStub()
      const def = { ...definition(), defaultFailurePolicy: { kind: "retry", maxAttempts: 5 } as const }
      const report = await driveToQuiescence({
        engine: engine2, attempts: attempts2, history: history2,
        definition: def, token: ctx.token, registry: reg,
        options: { fetchImpl: fail.fetch },
      })
      expect(fail.hits.count).toBe(1)
      expect(report.dispatched.some((d) => d.nodeId === "httpa" && d.status === "failed")).toBe(true)
      db2.close()
    } finally {
      rmSync(ctx.dir, { recursive: true, force: true })
    }
  })

  test("retry budget is durable: exhausted budget never redispatches after restart", async () => {
    const ctx = setup()
    try {
      const reg = registry()
      const fail = failStub()
      const def = { ...definition(), defaultFailurePolicy: { kind: "retry", maxAttempts: 1 } as const }
      await driveToQuiescence({
        engine: ctx.engine, attempts: ctx.attempts, history: ctx.history,
        definition: def, token: ctx.token, registry: reg,
        options: { fetchImpl: fail.fetch },
      })
      expect(fail.hits.count).toBe(2)
      expect(ctx.engine.nodeState("run-1", "httpa")!.status).toBe("FAILED")
      // Simulate restart: brand-new driver state, same durable facts.
      await driveToQuiescence({
        engine: ctx.engine, attempts: ctx.attempts, history: ctx.history,
        definition: def, token: ctx.token, registry: reg,
        options: { fetchImpl: fail.fetch },
      })
      expect(fail.hits.count).toBe(2)
    } finally {
      ctx.db.close()
      rmSync(ctx.dir, { recursive: true, force: true })
    }
  })

  test("UNKNOWN quiesces: no dispatch even with a retry policy", async () => {
    const ctx = setup()
    try {
      const reg = registry()
      const attempt = ctx.attempts.allocateAttempt(ctx.token, "httpa", "node:httpa")
      ctx.attempts.recordAttemptOutcome(ctx.token, "httpa", attempt.attemptId, "UNKNOWN_EXTERNAL_STATE", { ackLost: true })
      const fail = failStub()
      const def = { ...definition(), defaultFailurePolicy: { kind: "retry", maxAttempts: 5 } as const }
      const report = await driveToQuiescence({
        engine: ctx.engine, attempts: ctx.attempts, history: ctx.history,
        definition: def, token: ctx.token, registry: reg,
        options: { fetchImpl: fail.fetch },
      })
      expect(fail.hits.count).toBe(0)
      expect(ctx.engine.nodeState("run-1", "httpa")!.status).toBe("RUNNING")
      expect(report.terminal).toBe(false)
    } finally {
      ctx.db.close()
      rmSync(ctx.dir, { recursive: true, force: true })
    }
  })

  test("capability denial blocks before any fetch", async () => {
    const ctx = setup()
    try {
      const reg = registry()
      const fail = failStub()
      const deny = async () => {
        throw new NodeExecutionError("NODE_CAPABILITY_DENIED", "denied", false)
      }
      await expect(driveToQuiescence({
        engine: ctx.engine, attempts: ctx.attempts, history: ctx.history,
        definition: definition(), token: ctx.token, registry: reg,
        options: { fetchImpl: fail.fetch, authorize: deny },
      })).rejects.toThrow("denied")
      expect(fail.hits.count).toBe(0)
    } finally {
      ctx.db.close()
      rmSync(ctx.dir, { recursive: true, force: true })
    }
  })

  test("resumed dispatches reuse the pinned definition version", async () => {
    const ctx = setup()
    try {
      const reg = registry()
      const fail = failStub()
      const def = { ...definition(), defaultFailurePolicy: { kind: "retry", maxAttempts: 5 } as const }
      await driveToQuiescence({
        engine: ctx.engine, attempts: ctx.attempts, history: ctx.history,
        definition: def, token: ctx.token, registry: reg,
        options: { fetchImpl: fail.fetch },
      })
      expect(fail.hits.count).toBeGreaterThan(1)
      reg.register({ ...BUILTIN_NODE_DEFINITIONS[0]!, version: "v2" })
      const events = ctx.engine.inspectEvents("run-1").filter((e) => e.kind === "NODE_DISPATCH_INTENT")
      const versions = new Set(events.map((e) => (JSON.parse(e.detailJson!) as { definitionVersion?: string }).definitionVersion))
      expect([...versions]).toEqual(["v1"])
    } finally {
      ctx.db.close()
      rmSync(ctx.dir, { recursive: true, force: true })
    }
  })
})
