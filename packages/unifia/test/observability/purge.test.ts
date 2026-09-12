import { describe, expect, test } from "bun:test"
import path from "path"
import { Database, eq, sql } from "../../src/storage/db"
import { ObservabilityEventTable } from "../../src/observability/event.sql"
import { ObservabilityRepository, exportEvents } from "../../src/observability/repository"
import { deleteByScope, purgeByRetention, purgeExpiredContent, purgeContentForScope } from "../../src/observability/purge"
import { parseObservabilityEvent } from "../../src/observability/event-schema"
import { createTraceContext } from "../../src/observability/trace-context"
import { ObservabilityId } from "../../src/observability/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"

Log.init({ print: false })

function makeEvent(context: ReturnType<typeof createTraceContext>, tsMs = Date.now()) {
  const parsed = parseObservabilityEvent({
    eventId: ObservabilityId.create(),
    context,
    type: "llm.call.started",
    status: "started",
    tsMs,
    enqueueSeq: 1,
  })
  if (!parsed.success) throw new Error("invalid fixture event: " + JSON.stringify(parsed.error))
  return parsed.data
}

function rowsFor(column: typeof ObservabilityEventTable.session_id, value: string) {
  return Database.use((db) => db.select().from(ObservabilityEventTable).where(eq(column, value)).all())
}

describe("observability exportEvents", () => {
  test("exports all events as NDJSON ordered by ts_ms ASC", async () => {
    // Unscoped query below counts every row in the shared test-process DB
    // (see the "all" scope comment further down in this file), so this test
    // must start from a clean table like the other full-table assertions do.
    await deleteByScope({ scope: "all" })
    const now = Date.now()
    const sessionA = "export-test-session-a-" + ObservabilityId.create()
    const sessionB = "export-test-session-b-" + ObservabilityId.create()
    await ObservabilityRepository.insert([
      makeEvent(createTraceContext({ sessionId: sessionA }), now + 2000),
      makeEvent(createTraceContext({ sessionId: sessionA }), now + 1000),
      makeEvent(createTraceContext({ sessionId: sessionB }), now + 3000),
    ])

    const lines: string[] = []
    for await (const line of exportEvents({ limit: 100 })) {
      lines.push(line.trim())
    }

    expect(lines.length).toBe(3)
    // Should be ordered by ts_ms ASC
    const events = lines.map((l) => JSON.parse(l))
    expect(events[0].sessionId).toBe(sessionA)
    expect(events[1].sessionId).toBe(sessionA)
    expect(events[2].sessionId).toBe(sessionB)
    expect(events[0].tsMs).toBeLessThan(events[1].tsMs)
    expect(events[1].tsMs).toBeLessThan(events[2].tsMs)
  })

  test("exports events filtered by sessionId", async () => {
    const sessionA = "export-filter-session-a-" + ObservabilityId.create()
    const sessionB = "export-filter-session-b-" + ObservabilityId.create()
    await ObservabilityRepository.insert([
      makeEvent(createTraceContext({ sessionId: sessionA })),
      makeEvent(createTraceContext({ sessionId: sessionB })),
    ])

    const lines: string[] = []
    for await (const line of exportEvents({ sessionId: sessionA })) {
      lines.push(line.trim())
    }

    expect(lines.length).toBe(1)
    const event = JSON.parse(lines[0])
    expect(event.sessionId).toBe(sessionA)
  })

  test("exports events with time window filter", async () => {
    const now = Date.now()
    const sessionA = "export-time-session-a-" + ObservabilityId.create()
    await ObservabilityRepository.insert([
      makeEvent(createTraceContext({ sessionId: sessionA }), now - 10000),
      makeEvent(createTraceContext({ sessionId: sessionA }), now - 5000),
      makeEvent(createTraceContext({ sessionId: sessionA }), now),
    ])

    const lines: string[] = []
    for await (const line of exportEvents({ sessionId: sessionA, sinceMs: now - 8000, untilMs: now - 2000 })) {
      lines.push(line.trim())
    }

    expect(lines.length).toBe(1)
    const event = JSON.parse(lines[0])
    expect(event.tsMs).toBe(now - 5000)
  })

  test("respects limit parameter", async () => {
    const sessionA = "export-limit-session-a-" + ObservabilityId.create()
    await ObservabilityRepository.insert([
      makeEvent(createTraceContext({ sessionId: sessionA })),
      makeEvent(createTraceContext({ sessionId: sessionA })),
      makeEvent(createTraceContext({ sessionId: sessionA })),
    ])

    const lines: string[] = []
    for await (const line of exportEvents({ sessionId: sessionA, limit: 2 })) {
      lines.push(line.trim())
    }

    expect(lines.length).toBe(2)
  })
})

describe("observability deleteByScope", () => {
  test("deletes only rows matching the session scope", async () => {
    const sessionA = "purge-test-session-a-" + ObservabilityId.create()
    const sessionB = "purge-test-session-b-" + ObservabilityId.create()
    await ObservabilityRepository.insert([
      makeEvent(createTraceContext({ sessionId: sessionA })),
      makeEvent(createTraceContext({ sessionId: sessionB })),
    ])

    const result = await deleteByScope({ scope: "session", id: sessionA })

    expect(result.deletedCount).toBe(1)
    expect(rowsFor(ObservabilityEventTable.session_id, sessionA)).toHaveLength(0)
    expect(rowsFor(ObservabilityEventTable.session_id, sessionB)).toHaveLength(1)
  })

  test("deletes only rows matching the project scope", async () => {
    const projectA = "purge-test-project-a-" + ObservabilityId.create()
    const projectB = "purge-test-project-b-" + ObservabilityId.create()
    await ObservabilityRepository.insert([
      makeEvent(createTraceContext({ projectId: projectA })),
      makeEvent(createTraceContext({ projectId: projectB })),
    ])

    const result = await deleteByScope({ scope: "project", id: projectA })

    expect(result.deletedCount).toBe(1)
    expect(rowsFor(ObservabilityEventTable.project_id, projectA)).toHaveLength(0)
    expect(rowsFor(ObservabilityEventTable.project_id, projectB)).toHaveLength(1)
  })

  test("deletes only rows matching the workspace scope", async () => {
    const workspaceA = "purge-test-workspace-a-" + ObservabilityId.create()
    const workspaceB = "purge-test-workspace-b-" + ObservabilityId.create()
    await ObservabilityRepository.insert([
      makeEvent(createTraceContext({ workspaceId: workspaceA })),
      makeEvent(createTraceContext({ workspaceId: workspaceB })),
    ])

    const result = await deleteByScope({ scope: "workspace", id: workspaceA })

    expect(result.deletedCount).toBe(1)
    expect(rowsFor(ObservabilityEventTable.workspace_id, workspaceA)).toHaveLength(0)
    expect(rowsFor(ObservabilityEventTable.workspace_id, workspaceB)).toHaveLength(1)
  })

  test("retention deletes expired rows without deleting a recent event", async () => {
    const now = Date.now()
    const expired = "purge-retention-expired-" + ObservabilityId.create()
    const recent = "purge-retention-recent-" + ObservabilityId.create()
    await ObservabilityRepository.insert([
      makeEvent(createTraceContext({ sessionId: expired }), now - 2 * 86_400_000),
      makeEvent(createTraceContext({ sessionId: recent }), now - 60_000),
    ])

    const result = purgeByRetention({ retentionDays: 1, maxEvents: 100_000 }, now)

    expect(result.deletedExpired).toBeGreaterThan(0)
    expect(rowsFor(ObservabilityEventTable.session_id, expired)).toHaveLength(0)
    expect(rowsFor(ObservabilityEventTable.session_id, recent)).toHaveLength(1)
  })

  test("retention keeps the newest events when the event cap is exceeded", async () => {
    // purgeByRetention's maxEvents cap is a global table-wide limit (not
    // scoped to a session), so leftover rows from earlier tests in the
    // shared test-process DB would make "top 1 by ts_ms" not be our own
    // "newest" row. Reset first, same as the other full-table assertions.
    await deleteByScope({ scope: "all" })
    const now = Date.now()
    const oldest = "purge-retention-oldest-" + ObservabilityId.create()
    const newest = "purge-retention-newest-" + ObservabilityId.create()
    await ObservabilityRepository.insert([
      makeEvent(createTraceContext({ sessionId: oldest }), now + 60_000),
      makeEvent(createTraceContext({ sessionId: newest }), now + 120_000),
    ])

    const result = purgeByRetention({ maxEvents: 1 }, now)

    expect(result.deletedOverLimit).toBeGreaterThan(0)
    expect(rowsFor(ObservabilityEventTable.session_id, oldest)).toHaveLength(0)
    expect(rowsFor(ObservabilityEventTable.session_id, newest)).toHaveLength(1)
  })
  test("retention removes a small overflow above 100000 without deleting recent rows", async () => {
    await deleteByScope({ scope: "all" })
    const sessionId = "purge-retention-over-100k-" + ObservabilityId.create()
    Database.use((db) => db.run(sql.raw(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 100050) INSERT INTO observability_event (event_id, trace_id, span_id, session_id, event_type, status, ts_ms, enqueue_seq, redaction_status, payload_truncated, metadata_json, local_redacted_json, schema_version) SELECT "purge-over-" || n, "trace-" || n, "span-" || n, "${sessionId}", "llm.call.started", "started", n, n, "metadata_only", 0, "{}", "{}", 1 FROM seq`)))
    const result = purgeByRetention({ maxEvents: 100_000 })
    expect(result.deletedOverLimit).toBe(50)
    expect(rowsFor(ObservabilityEventTable.session_id, sessionId)).toHaveLength(100_000)
  })

  // Runs last on purpose: {scope: "all"} has no WHERE clause and truly wipes
  // the shared test-process SQLite instance (bun test runs files/tests
  // sequentially by default, same shared :memory: DB convention already used
  // by every other observability test). Assertions only check our own known
  // rows are gone, never a global "table is empty" count.
  test('"all" scope deletes every row, including ones from other scopes', async () => {
    const sessionId = "purge-test-all-" + ObservabilityId.create()
    await ObservabilityRepository.insert([makeEvent(createTraceContext({ sessionId }))])
    expect(rowsFor(ObservabilityEventTable.session_id, sessionId)).toHaveLength(1)

    const result = await deleteByScope({ scope: "all" })

    expect(result.deletedCount).toBeGreaterThan(0)
    expect(rowsFor(ObservabilityEventTable.session_id, sessionId)).toHaveLength(0)
  })
})

function makeEventWithContent(context: ReturnType<typeof createTraceContext>, content: { localFull?: string; localContentRedacted?: string; contentExpiresAtMs?: number }, tsMs = Date.now()) {
  const parsed = parseObservabilityEvent({
    eventId: ObservabilityId.create(),
    context,
    type: "llm.call.finished",
    status: "finished",
    tsMs,
    enqueueSeq: 1,
    ...content,
  })
  if (!parsed.success) throw new Error("invalid fixture event: " + JSON.stringify(parsed.error))
  return parsed.data
}

describe("observability Phase 3 content purge", () => {
  test("purgeExpiredContent clears content columns on rows past content_expires_at_ms, keeping the row", async () => {
    const now = 10_000_000
    const sessionId = "content-purge-expired-" + ObservabilityId.create()
    await ObservabilityRepository.insert([
      makeEventWithContent(createTraceContext({ sessionId }), { localFull: "the actual response", contentExpiresAtMs: now - 1000 }),
    ])

    const cleared = purgeExpiredContent(now)

    expect(cleared).toBeGreaterThan(0)
    const rows = rowsFor(ObservabilityEventTable.session_id, sessionId)
    expect(rows).toHaveLength(1)
    expect(rows[0].local_full_json).toBeNull()
    expect(rows[0].content_expires_at_ms).toBeNull()
  })

  test("purgeExpiredContent leaves content that has not expired yet", async () => {
    const now = 11_000_000
    const sessionId = "content-purge-not-expired-" + ObservabilityId.create()
    await ObservabilityRepository.insert([
      makeEventWithContent(createTraceContext({ sessionId }), { localFull: "still valid", contentExpiresAtMs: now + 60_000 }),
    ])

    purgeExpiredContent(now)

    const rows = rowsFor(ObservabilityEventTable.session_id, sessionId)
    expect(rows[0].local_full_json).not.toBeNull()
  })

  test("purgeExpiredContent never touches rows that never had content", async () => {
    const sessionId = "content-purge-no-content-" + ObservabilityId.create()
    await ObservabilityRepository.insert([makeEvent(createTraceContext({ sessionId }))])

    const clearedBefore = purgeExpiredContent(Date.now() + 999_999_999)
    const rows = rowsFor(ObservabilityEventTable.session_id, sessionId)
    expect(rows).toHaveLength(1)
    expect(rows[0].local_full_json).toBeNull()
    void clearedBefore
  })

  test("purgeContentForScope clears content for a session immediately, independent of expiry", async () => {
    const sessionId = "content-purge-revoke-" + ObservabilityId.create()
    await ObservabilityRepository.insert([
      makeEventWithContent(createTraceContext({ sessionId }), { localContentRedacted: "redacted text", contentExpiresAtMs: Date.now() + 999_999_999 }),
    ])

    const cleared = purgeContentForScope({ scope: "session", id: sessionId })

    expect(cleared).toBeGreaterThan(0)
    const rows = rowsFor(ObservabilityEventTable.session_id, sessionId)
    expect(rows[0].local_content_redacted_json).toBeNull()
    expect(rows[0].content_expires_at_ms).toBeNull()
  })

  test("purgeContentForScope's reported count only includes rows that actually had content", async () => {
    const sessionId = "content-purge-precise-count-" + ObservabilityId.create()
    await ObservabilityRepository.insert([
      makeEventWithContent(createTraceContext({ sessionId }), { localFull: "has content" }),
      makeEvent(createTraceContext({ sessionId })), // no content — must not inflate the count
      makeEvent(createTraceContext({ sessionId })),
    ])

    const cleared = purgeContentForScope({ scope: "session", id: sessionId })

    expect(cleared).toBe(1)
    expect(rowsFor(ObservabilityEventTable.session_id, sessionId)).toHaveLength(3)
  })

  test("purgeContentForScope does not delete the metadata row itself", async () => {
    const sessionId = "content-purge-keeps-row-" + ObservabilityId.create()
    await ObservabilityRepository.insert([
      makeEventWithContent(createTraceContext({ sessionId }), { localFull: "gone after revoke" }),
    ])

    purgeContentForScope({ scope: "session", id: sessionId })

    expect(rowsFor(ObservabilityEventTable.session_id, sessionId)).toHaveLength(1)
  })
})

describe("observability session-delete hook", () => {
  test("removing a session cascades to delete its observability events, in the same transaction", async () => {
    const projectRoot = path.join(__dirname, "../..")
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        await ObservabilityRepository.insert([makeEvent(createTraceContext({ sessionId: session.id }))])
        expect(rowsFor(ObservabilityEventTable.session_id, session.id)).toHaveLength(1)

        await Session.remove(session.id)

        expect(rowsFor(ObservabilityEventTable.session_id, session.id)).toHaveLength(0)
      },
    })
  })

  test("removing a session does not touch another session's observability events", async () => {
    const projectRoot = path.join(__dirname, "../..")
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const removed = await Session.create({})
        const kept = await Session.create({})
        await ObservabilityRepository.insert([
          makeEvent(createTraceContext({ sessionId: removed.id })),
          makeEvent(createTraceContext({ sessionId: kept.id })),
        ])

        await Session.remove(removed.id)

        expect(rowsFor(ObservabilityEventTable.session_id, removed.id)).toHaveLength(0)
        expect(rowsFor(ObservabilityEventTable.session_id, kept.id)).toHaveLength(1)

        await Session.remove(kept.id)
      },
    })
  })
})
