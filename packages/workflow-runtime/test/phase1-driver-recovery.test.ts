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
import { BUILTIN_NODE_DEFINITIONS, HTTP_NODE_V1 } from "../src/nodes/builtins.js"
import { NodeRegistry } from "../src/nodes/registry.js"
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

/** Retry policy with an explicit budget (Phase 1 default is propagate). */
function withRetries(maxAttempts: number): WorkflowDefinition {
  return { ...definition(), defaultFailurePolicy: { kind: "retry", maxAttempts } }
}

/** `ignore`: the graph moves on, but the effect must stay truthful. */
function ignoring(): WorkflowDefinition {
  return { ...definition(), defaultFailurePolicy: { kind: "ignore" } }
}

/** Throws like a socket that died mid-flight: no cause code, so the outcome
 * is unknowable and must never be recorded as a plain failure. */
function midFlightStub(): { fetch: typeof globalThis.fetch; hits: { count: number } } {
  const hits = { count: 0 }
  const stub = (async () => {
    hits.count += 1
    throw new Error("socket hang up")
  }) as unknown as typeof globalThis.fetch
  return { fetch: stub, hits }
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

type RecoveryContext = ReturnType<typeof setup>

interface Closeable { close(): void }

/**
 * WHY: NativeAttemptAuthority opens its OWN sqlite connection while the
 * engine and the history share the injected one. Windows keeps the file
 * locked until every handle is closed, so a teardown that releases only the
 * shared connection dies on EBUSY and masks the real assertions.
 * `extra` carries the handles a restart simulation opened on the same file.
 */
function teardown(ctx: RecoveryContext, extra: readonly Closeable[] = []): void {
  const handles: readonly Closeable[] = [...extra, ctx.engine, ctx.attempts, ctx.history, ctx.db]
  for (const handle of handles) {
    try {
      handle.close()
    } catch {
      // A restart simulation may already have closed this handle; the point
      // of the loop is that every remaining one still gets released.
    }
  }
  Bun.gc(true)
  rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 })
}

function registry(): NodeRegistry {
  const registry = new NodeRegistry()
  for (const def of BUILTIN_NODE_DEFINITIONS) registry.register(def)
  return registry
}

function failStub(): { fetch: typeof globalThis.fetch; hits: { count: number } } {
  const hits = { count: 0 }
  const stub = (async () => {
    hits.count += 1
    return new Response("broken", { status: 500 })
  }) as unknown as typeof globalThis.fetch
  return { fetch: stub, hits }
}

function dispatchIntentVersions(engine: GraphRuntimeEngine, runId: string): readonly (string | undefined)[] {
  return engine.inspectEvents(runId)
    .filter((event) => event.kind === "NODE_DISPATCH_INTENT")
    .map((event) => (JSON.parse(event.detailJson!) as { definitionVersion?: string }).definitionVersion)
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
      const state = ctx.engine.nodeState("run-1", "httpa")!
      expect(state.status).toBe("COMPLETED")
      // The healed node carries the STORED effect result, not a fresh call.
      expect(JSON.parse(state.outputJson!)).toEqual({ json: { ok: true } })
      expect(report.dispatched.some((d) => d.nodeId === "httpa" && d.status === "completed")).toBe(true)
    } finally {
      teardown(ctx)
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
      expect(report.dispatched.some((d) => d.nodeId === "httpa" && d.status === "failed")).toBe(true)
    } finally {
      teardown(ctx)
    }
  })

  test("crash after authorize before allocate resumes exactly the authorized retry", async () => {
    const ctx = setup()
    const extra: Closeable[] = []
    try {
      const reg = registry()
      const attempt = ctx.attempts.allocateAttempt(ctx.token, "httpa", "node:httpa")
      ctx.attempts.recordAttemptOutcome(ctx.token, "httpa", attempt.attemptId, "FAILED", { result: { error: "boom" } })
      ctx.attempts.authorizeRetry(ctx.token, "node:httpa")
      // Simulate restart: fresh handles on the same file, zero in-memory state.
      ctx.db.close()
      const db2 = new Database(ctx.path)
      const history2 = new NativeDurableHistoryAuthority({ databasePath: ctx.path, now: () => NOW, database: db2 })
      history2.initialize()
      const attempts2 = new NativeAttemptAuthority({ databasePath: ctx.path, now: () => NOW })
      attempts2.initialize()
      const engine2 = new GraphRuntimeEngine({ databasePath: ctx.path, definition: definition(), now: () => NOW, database: db2 })
      engine2.initialize()
      extra.push(engine2, attempts2, history2, db2)
      const fail = failStub()
      // Budget 1: the banked authorization buys exactly ONE more dispatch.
      const report = await driveToQuiescence({
        engine: engine2, attempts: attempts2, history: history2,
        definition: withRetries(1), token: ctx.token, registry: reg,
        options: { fetchImpl: fail.fetch },
      })
      expect(fail.hits.count).toBe(1)
      expect(report.dispatched.some((d) => d.nodeId === "httpa" && d.status === "failed")).toBe(true)
      expect(engine2.nodeState("run-1", "httpa")!.status).toBe("FAILED")
      // The authorization was consumed by the resumed allocation, not re-banked.
      expect(attempts2.hasRetryAuthorization("run-1", "node:httpa")).toBe(false)
    } finally {
      teardown(ctx, extra)
    }
  })

  test("retry budget is durable: exhausted budget never redispatches after restart", async () => {
    const ctx = setup()
    try {
      const reg = registry()
      const fail = failStub()
      const def = withRetries(1)
      await driveToQuiescence({
        engine: ctx.engine, attempts: ctx.attempts, history: ctx.history,
        definition: def, token: ctx.token, registry: reg,
        options: { fetchImpl: fail.fetch },
      })
      expect(fail.hits.count).toBe(2)
      expect(ctx.engine.nodeState("run-1", "httpa")!.status).toBe("FAILED")
      // Re-drive from the same durable facts: a new driver has no counters.
      await driveToQuiescence({
        engine: ctx.engine, attempts: ctx.attempts, history: ctx.history,
        definition: def, token: ctx.token, registry: reg,
        options: { fetchImpl: fail.fetch },
      })
      expect(fail.hits.count).toBe(2)
    } finally {
      teardown(ctx)
    }
  })

  test("UNKNOWN quiesces: no dispatch even with a retry policy", async () => {
    const ctx = setup()
    try {
      const reg = registry()
      const attempt = ctx.attempts.allocateAttempt(ctx.token, "httpa", "node:httpa")
      ctx.attempts.recordAttemptOutcome(ctx.token, "httpa", attempt.attemptId, "UNKNOWN_EXTERNAL_STATE", { ackLost: true })
      const fail = failStub()
      const report = await driveToQuiescence({
        engine: ctx.engine, attempts: ctx.attempts, history: ctx.history,
        definition: withRetries(5), token: ctx.token, registry: reg,
        options: { fetchImpl: fail.fetch },
      })
      expect(fail.hits.count).toBe(0)
      expect(ctx.engine.nodeState("run-1", "httpa")!.status).toBe("RUNNING")
      expect(report.terminal).toBe(false)
    } finally {
      teardown(ctx)
    }
  })

  test("PENDING open attempt after crash becomes UNKNOWN, then quiesces", async () => {
    const ctx = setup()
    try {
      const reg = registry()
      // Crash window: attempt minted, no outcome ever recorded.
      const attempt = ctx.attempts.allocateAttempt(ctx.token, "httpa", "node:httpa")
      const fail = failStub()
      const report = await driveToQuiescence({
        engine: ctx.engine, attempts: ctx.attempts, history: ctx.history,
        definition: withRetries(5), token: ctx.token, registry: reg,
        options: { fetchImpl: fail.fetch },
      })
      expect(fail.hits.count).toBe(0)
      expect(report.terminal).toBe(false)
      const rows = ctx.attempts.inspectAttempts("run-1", "httpa")
      expect(rows.find((row) => row.attemptId === attempt.attemptId)!.outcome).toBe("UNKNOWN_EXTERNAL_STATE")
      expect(ctx.attempts.inspectEffect("run-1", "node:httpa")!.status).toBe("UNKNOWN_EXTERNAL_STATE")
    } finally {
      teardown(ctx)
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
      expect(ctx.attempts.inspectAttempts("run-1", "httpa").length).toBe(0)
    } finally {
      teardown(ctx)
    }
  })

  test("resumed dispatches reuse the pinned definition version", async () => {
    const ctx = setup()
    try {
      const reg = registry()
      // Simulate a first dispatch pinned to v1, then a crash before completion.
      const attempt = ctx.attempts.allocateAttempt(ctx.token, "httpa", "node:httpa")
      ctx.engine.journalNodeEvent("run-1", ctx.token, "httpa", "NODE_DISPATCH_INTENT", {
        family: "tool.http", attemptId: attempt.attemptId, definitionVersion: "v1",
      })
      ctx.attempts.recordAttemptOutcome(ctx.token, "httpa", attempt.attemptId, "FAILED", { result: { error: "boom" } })
      ctx.attempts.authorizeRetry(ctx.token, "node:httpa")
      // The registry moved on while the run was down: v2 is now the latest.
      reg.register({ ...HTTP_NODE_V1, version: "v2" })
      expect(reg.get("tool.http").version).toBe("v2")
      const fail = failStub()
      await driveToQuiescence({
        engine: ctx.engine, attempts: ctx.attempts, history: ctx.history,
        definition: withRetries(1), token: ctx.token, registry: reg,
        options: { fetchImpl: fail.fetch },
      })
      expect(fail.hits.count).toBe(1)
      // The resumed dispatch must NOT drift to v2: the run stays on its pin.
      expect([...new Set(dispatchIntentVersions(ctx.engine, "run-1"))]).toEqual(["v1"])
    } finally {
      teardown(ctx)
    }
  })

  test("ignore policy on a KNOWN failure records FAILED before completing the node", async () => {
    const ctx = setup()
    try {
      const reg = registry()
      const fail = failStub()
      const report = await driveToQuiescence({
        engine: ctx.engine, attempts: ctx.attempts, history: ctx.history,
        definition: ignoring(), token: ctx.token, registry: reg,
        options: { fetchImpl: fail.fetch },
      })
      expect(fail.hits.count).toBe(1)
      expect(report.dispatched.map((d) => d.status)).toEqual(["ignored"])
      // The graph moved on...
      const state = ctx.engine.nodeState("run-1", "httpa")!
      expect(state.status).toBe("COMPLETED")
      expect((JSON.parse(state.outputJson!) as { json: unknown }).json).toBeNull()
      // ...but the effect machine records the truth: a terminated FAILED
      // attempt, never a PENDING orphan the recovery loop would reopen.
      expect(ctx.attempts.inspectEffect("run-1", "node:httpa")!.status).toBe("FAILED")
      expect(ctx.attempts.inspectAttempts("run-1", "httpa").every((row) => row.outcome !== null)).toBe(true)
    } finally {
      teardown(ctx)
    }
  })

  test("ignore policy on an UNKNOWN outcome keeps the effect UNKNOWN", async () => {
    const ctx = setup()
    try {
      const reg = registry()
      const mid = midFlightStub()
      const report = await driveToQuiescence({
        engine: ctx.engine, attempts: ctx.attempts, history: ctx.history,
        definition: ignoring(), token: ctx.token, registry: reg,
        options: { fetchImpl: mid.fetch },
      })
      expect(mid.hits.count).toBe(1)
      expect(report.dispatched.map((d) => d.status)).toEqual(["ignored"])
      expect(ctx.engine.nodeState("run-1", "httpa")!.status).toBe("COMPLETED")
      // `ignore` must NOT downgrade an unknowable outcome to a known failure:
      // the effect stays reconcilable, which is the only honest record.
      expect(ctx.attempts.inspectEffect("run-1", "node:httpa")!.status).toBe("UNKNOWN_EXTERNAL_STATE")
    } finally {
      teardown(ctx)
    }
  })
})
