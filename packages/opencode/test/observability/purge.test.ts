import { describe, expect, test } from "bun:test"
import path from "path"
import { Database, eq } from "../../src/storage/db"
import { ObservabilityEventTable } from "../../src/observability/event.sql"
import { ObservabilityRepository } from "../../src/observability/repository"
import { deleteByScope } from "../../src/observability/purge"
import { parseObservabilityEvent } from "../../src/observability/event-schema"
import { createTraceContext } from "../../src/observability/trace-context"
import { ObservabilityId } from "../../src/observability/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"

Log.init({ print: false })

function makeEvent(context: ReturnType<typeof createTraceContext>) {
  const parsed = parseObservabilityEvent({
    eventId: ObservabilityId.create(),
    context,
    type: "llm.call.started",
    status: "started",
    tsMs: Date.now(),
    enqueueSeq: 1,
  })
  if (!parsed.success) throw new Error("invalid fixture event: " + JSON.stringify(parsed.error))
  return parsed.data
}

function rowsFor(column: typeof ObservabilityEventTable.session_id, value: string) {
  return Database.use((db) => db.select().from(ObservabilityEventTable).where(eq(column, value)).all())
}

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
