/* SPDX-License-Identifier: MIT */
// Copyright (c) 2026 Unifia contributors
//
// C-M1-12 evidence tests for @unifia/observability.
// Plan V2.3.1 §3.12 + §5.7, Plan §125 (secret-leak canary gate),
// TM-CP-02 (log injection).
//
// Coverage matrix (15 tests, all using `bun:test`):
//   (a)   logger.info emits 1 entry to the sink
//   (b)   logger.audit emits with level=audit
//   (c)   token   → SecretLeakageError
//   (d)   password → SecretLeakageError
//   (e)   apiKey → SecretLeakageError
//   (f)   cookies → SecretLeakageError
//   (g)   authorization → SecretLeakageError
//   (h)   privateKey → SecretLeakageError
//   (i)   empty string is allowed (test fixture convention)
//   (j)   non-string values fine (canary only checks string/bytes)
//   (k)   withScope binds OwnershipScope
//   (l)   withDeployment binds DeploymentScope
//   (m)   zero-alloc: 1 000 000 info calls → heap delta < 1 MB
//   (n)   createNoopLogger skips the canary
//   (o)   LogEntrySchema Zod validation

import { beforeEach, describe, expect, test } from "bun:test"
import {
  createStructuredLogger,
  createInMemorySink,
  createNoopLogger,
  LogEntrySchema,
  LogLevelSchema,
  SecretLeakageError,
  scanSecretsInFields,
  type LogEntry,
  type LogSink,
  type Logger,
} from "../src/index.js"
import type { DeploymentScope, OwnershipScope } from "@unifia/contracts"

const SCOPE_A: OwnershipScope = {
  organizationId: "org-A",
  workspaceId: "ws-1",
  projectId: "proj-1",
}
const SCOPE_B: OwnershipScope = {
  organizationId: "org-B",
  workspaceId: "ws-2",
}
const DEPLOY_A: DeploymentScope = {
  ownershipScope: SCOPE_A,
  environmentId: "prod",
}

// ---------------------------------------------------------------------------
// (a) Basic emit
// ---------------------------------------------------------------------------

describe("createStructuredLogger — basic emit", () => {
  let sink: ReturnType<typeof createInMemorySink>
  let logger: Logger
  beforeEach(() => {
    sink = createInMemorySink()
    logger = createStructuredLogger({ sink, scope: SCOPE_A, deployment: DEPLOY_A })
  })
  test("(a) logger.info emits 1 entry to the sink", async () => {
    logger.info("hello")
    expect(sink.entries).toHaveLength(0) // ring buffer flushes
    const n = await logger.flush()
    expect(n).toBe(1)
    expect(sink.entries).toHaveLength(1)
    expect(sink.entries[0]!.message).toBe("hello")
    expect(sink.entries[0]!.level).toBe("info")
  })
  test("(b) logger.audit emits with level=audit", async () => {
    logger.audit("approve", { grant: "granted" })
    await logger.flush()
    expect(sink.entries[0]!.level).toBe("audit")
    expect(sink.entries[0]!.message).toBe("approve")
    expect(sink.entries[0]!.fields).toEqual({ grant: "granted" })
  })
})

// ---------------------------------------------------------------------------
// Secret-leak canary
// ---------------------------------------------------------------------------

describe("secret-leak canary", () => {
  let sink: ReturnType<typeof createInMemorySink>
  let logger: Logger
  beforeEach(() => {
    sink = createInMemorySink()
    logger = createStructuredLogger({ sink, scope: SCOPE_A, deployment: DEPLOY_A })
  })
  test("(c) token field → SecretLeakageError", () => {
    expect(() => logger.info("test", { token: "abc" })).toThrow(SecretLeakageError)
  })
  test("(d) password field → SecretLeakageError", () => {
    expect(() => logger.info("test", { password: "abc" })).toThrow(SecretLeakageError)
  })
  test("(e) apiKey field → SecretLeakageError", () => {
    expect(() => logger.info("test", { apiKey: "abc" })).toThrow(SecretLeakageError)
  })
  test("(f) cookies field → SecretLeakageError", () => {
    expect(() => logger.info("test", { cookies: "session=xyz" })).toThrow(SecretLeakageError)
  })
  test("(g) authorization field → SecretLeakageError", () => {
    expect(() => logger.info("test", { authorization: "Bearer xyz" })).toThrow(SecretLeakageError)
  })
  test("(h) privateKey field → SecretLeakageError", () => {
    expect(() => logger.info("test", { privateKey: "-----BEGIN" })).toThrow(SecretLeakageError)
  })
  test("(i) empty token is allowed (test fixture convention)", async () => {
    expect(() => logger.info("test", { token: "" })).not.toThrow()
    await logger.flush()
    expect(sink.entries).toHaveLength(1)
  })
  test("(j) non-string values are not flagged", async () => {
    expect(() => logger.info("test", { userId: 12345, count: 0, active: true })).not.toThrow()
    await logger.flush()
    expect(sink.entries[0]!.fields).toEqual({ userId: 12345, count: 0, active: true })
  })
  test("case-insensitive match (TOKEN, Password, API_KEY)", () => {
    expect(() => logger.info("test", { TOKEN: "x" })).toThrow(SecretLeakageError)
    expect(() => logger.info("test", { Password: "x" })).toThrow(SecretLeakageError)
    expect(() => logger.info("test", { API_KEY: "x" })).toThrow(SecretLeakageError)
  })
  test("Uint8Array of length > 0 throws", () => {
    expect(() => logger.info("test", { token: new Uint8Array(32) })).toThrow(SecretLeakageError)
  })
  test("Uint8Array of length 0 is allowed", async () => {
    expect(() => logger.info("test", { token: new Uint8Array(0) })).not.toThrow()
  })
  test("SecretLeakageError carries field + redacted value", () => {
    try {
      logger.info("test", { password: "hunter2hunter2" })
      throw new Error("expected throw")
    } catch (err) {
      expect(err).toBeInstanceOf(SecretLeakageError)
      const e = err as SecretLeakageError
      expect(e.field).toBe("password")
      expect(e.value).toBe("hunt***")
      expect(e.toJSON()).toEqual({ name: "SecretLeakageError", field: "password", value: "hunt***" })
    }
  })
  test("short value is fully redacted", () => {
    try {
      logger.info("test", { token: "x" })
      throw new Error("expected throw")
    } catch (err) {
      const e = err as SecretLeakageError
      expect(e.value).toBe("***")
    }
  })
  test("no fields argument does not throw", () => {
    expect(() => logger.info("no fields")).not.toThrow()
  })
  test("empty fields object does not throw", () => {
    expect(() => logger.info("empty", {})).not.toThrow()
  })
  test("redactSecrets=false bypasses the canary", () => {
    const off: ReturnType<typeof createInMemorySink> = createInMemorySink()
    const log = createStructuredLogger({ sink: off, scope: SCOPE_A, deployment: DEPLOY_A, redactSecrets: false })
    expect(() => log.info("test", { token: "abc" })).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Scope / Deployment binding
// ---------------------------------------------------------------------------

describe("withScope / withDeployment", () => {
  test("(k) withScope produces a logger whose entries have the bound scope", async () => {
    const sink = createInMemorySink()
    const base = createStructuredLogger({ sink, scope: SCOPE_A, deployment: DEPLOY_A })
    const scoped = base.withScope(SCOPE_B)
    scoped.info("hello")
    await scoped.flush()
    expect(sink.entries[0]!.scope).toEqual(SCOPE_B)
  })
  test("(l) withDeployment produces a logger whose entries have the bound deployment", async () => {
    const sink = createInMemorySink()
    const base = createStructuredLogger({ sink, scope: SCOPE_A, deployment: DEPLOY_A })
    const alt: DeploymentScope = { ownershipScope: SCOPE_B, environmentId: "staging" }
    const depLog = base.withDeployment(alt)
    depLog.info("hello")
    await depLog.flush()
    expect(sink.entries[0]!.deployment).toEqual(alt)
  })
  test("chained withScope returns a fresh logger with the latest scope", async () => {
    const sink = createInMemorySink()
    const log = createStructuredLogger({ sink })
      .withScope(SCOPE_A)
      .withScope(SCOPE_B)
    log.info("x")
    await log.flush()
    expect(sink.entries[0]!.scope).toEqual(SCOPE_B)
  })
})

// ---------------------------------------------------------------------------
// Zero-alloc
// ---------------------------------------------------------------------------

describe("zero-alloc on the hot path", () => {
  test("(m) 1 000 000 logger.info calls → heap delta < 1 MB", () => {
    // Bun exposes `gc()` only under `--expose-gc`; we cast through
    // `unknown` so the typecheck stays strict without depending on
    // the runtime flag. The bench script in `test/bench.ts`
    // re-measures with `--expose-gc` for the EVIDENCE delta.
    const gc = (globalThis as unknown as { gc?: () => void }).gc
    gc?.()
    const sink: LogSink = { write() { /* noop */ } }
    const logger = createStructuredLogger({ sink, scope: SCOPE_A, deployment: DEPLOY_A })
    const before = process.memoryUsage().heapUsed
    for (let i = 0; i < 1_000_000; i++) {
      logger.info("bench")
    }
    const after = process.memoryUsage().heapUsed
    const delta = after - before
    // 1 MB ceiling — V8 young-gen reclaims within a few hundred MB,
    // and the ring buffer + template are reused.
    expect(delta).toBeLessThan(1 * 1024 * 1024)
    // Also verify the ring buffer held up: only 1 slot per emit
    // was written (the rest are still in the buffer, will be
    // dropped oldest-style after capacity is reached).
    expect(logger.buffered()).toBe(1024) // 1024 is the default capacity
    // 1 000 000 emits - 1024 kept = 998 976 dropped.
    expect(logger.dropped()).toBe(1_000_000 - 1024)
  })
  test("ring buffer drops oldest when full (back-pressure policy)", () => {
    const sink = createInMemorySink()
    const logger = createStructuredLogger({ sink, scope: SCOPE_A, deployment: DEPLOY_A, capacity: 4 })
    for (let i = 0; i < 10; i++) logger.info(`msg-${i}`)
    expect(logger.buffered()).toBe(4)
    expect(logger.dropped()).toBe(6)
  })
  test("drain returns the 4 most recent messages", async () => {
    const sink = createInMemorySink()
    const logger = createStructuredLogger({ sink, scope: SCOPE_A, deployment: DEPLOY_A, capacity: 4 })
    for (let i = 0; i < 10; i++) logger.info(`msg-${i}`)
    const n = await logger.flush()
    expect(n).toBe(4)
    expect(sink.entries.map((e) => e.message)).toEqual(["msg-6", "msg-7", "msg-8", "msg-9"])
  })
})

// ---------------------------------------------------------------------------
// Noop logger
// ---------------------------------------------------------------------------

describe("createNoopLogger", () => {
  test("(n) noop logger skips the canary (no throw on token)", () => {
    const log = createNoopLogger()
    expect(() => log.info("test", { token: "abc", password: "x" })).not.toThrow()
    expect(() => log.audit("approve", { password: "y" })).not.toThrow()
  })
  test("noop logger flushes to 0", async () => {
    const log = createNoopLogger()
    expect(await log.flush()).toBe(0)
  })
  test("noop logger withScope returns the same noop", () => {
    const log = createNoopLogger()
    expect(log.withScope(SCOPE_A)).toBe(log)
    expect(log.withDeployment(DEPLOY_A)).toBe(log)
  })
  test("noop logger reports 0 buffered / 0 dropped", () => {
    const log = createNoopLogger()
    expect(log.buffered()).toBe(0)
    expect(log.dropped()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

describe("LogEntrySchema Zod validation", () => {
  test("(o) LogEntrySchema.parse accepts a valid entry", () => {
    const entry: LogEntry = {
      timestamp: 1700000000000,
      level: "info",
      scope: SCOPE_A,
      deployment: DEPLOY_A,
      runId: "r-1",
      capability: "network.request",
      message: "hello",
      fields: { userId: 42 },
    }
    const parsed = LogEntrySchema.parse(entry)
    expect(parsed.message).toBe("hello")
  })
  test("LogEntrySchema.parse rejects an invalid level", () => {
    expect(() =>
      LogEntrySchema.parse({
        timestamp: 1,
        level: "TRACE",
        scope: SCOPE_A,
        deployment: DEPLOY_A,
        message: "x",
        fields: {},
      }),
    ).toThrow()
  })
  test("LogEntrySchema.parse rejects empty workspaceId", () => {
    expect(() =>
      LogEntrySchema.parse({
        timestamp: 1,
        level: "info",
        scope: { organizationId: "a", workspaceId: "" },
        deployment: DEPLOY_A,
        message: "x",
        fields: {},
      }),
    ).toThrow()
  })
  test("LogLevelSchema is closed to 5 values", () => {
    expect(LogLevelSchema.parse("debug")).toBe("debug")
    expect(LogLevelSchema.parse("info")).toBe("info")
    expect(LogLevelSchema.parse("warn")).toBe("warn")
    expect(LogLevelSchema.parse("error")).toBe("error")
    expect(LogLevelSchema.parse("audit")).toBe("audit")
    expect(() => LogLevelSchema.parse("trace")).toThrow()
  })
  test("scanSecretsInFields is exported and idempotent on safe inputs", () => {
    expect(() => scanSecretsInFields({ runId: "r-1" })).not.toThrow()
    expect(() => scanSecretsInFields({})).not.toThrow()
    expect(() => scanSecretsInFields({ token: "" })).not.toThrow()
  })
})
