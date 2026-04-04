import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { SessionID } from "./schema"
import { SessionTable } from "./session.sql"
import { Database, eq } from "../storage/db"
import { Effect, Layer, ServiceMap } from "effect"
import z from "zod"
import { Log } from "../util/log"

const log = Log.create({ service: "session-status" })

export namespace SessionStatus {
  export const TaskStatus = z.enum([
    "idle",
    "busy",
    "retry",
    "queued",
    "blocked",
    "awaiting_input",
    "completed",
    "failed",
    "cancelled",
  ])
  export type TaskStatus = z.infer<typeof TaskStatus>

  /** States that should be persisted to DB (survive restarts). */
  const PERSISTENT_STATES = new Set<string>([
    "queued",
    "blocked",
    "awaiting_input",
    "completed",
    "failed",
    "cancelled",
  ])

  export const Info = z
    .union([
      z.object({
        type: z.literal("idle"),
      }),
      z.object({
        type: z.literal("retry"),
        attempt: z.number(),
        message: z.string(),
        next: z.number(),
      }),
      z.object({
        type: z.literal("busy"),
      }),
      z.object({
        type: z.literal("queued"),
      }),
      z.object({
        type: z.literal("blocked"),
        reason: z.string().optional(),
      }),
      z.object({
        type: z.literal("awaiting_input"),
        question: z.string().optional(),
      }),
      z.object({
        type: z.literal("completed"),
        result: z.string().optional(),
      }),
      z.object({
        type: z.literal("failed"),
        error: z.string().optional(),
      }),
      z.object({
        type: z.literal("cancelled"),
      }),
    ])
    .meta({
      ref: "SessionStatus",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Status: BusEvent.define(
      "session.status",
      z.object({
        sessionID: SessionID.zod,
        status: Info,
      }),
    ),
    // deprecated
    Idle: BusEvent.define(
      "session.idle",
      z.object({
        sessionID: SessionID.zod,
      }),
    ),
    // Task lifecycle events
    TaskCreated: BusEvent.define(
      "task.created",
      z.object({
        sessionID: SessionID.zod,
        parentID: SessionID.zod,
        agent: z.string(),
        description: z.string(),
      }),
    ),
    TaskCompleted: BusEvent.define(
      "task.completed",
      z.object({
        sessionID: SessionID.zod,
        parentID: SessionID.zod,
        result: z.string().optional(),
      }),
    ),
    TaskFailed: BusEvent.define(
      "task.failed",
      z.object({
        sessionID: SessionID.zod,
        parentID: SessionID.zod,
        error: z.string(),
      }),
    ),
    TaskCancelled: BusEvent.define(
      "task.cancelled",
      z.object({
        sessionID: SessionID.zod,
      }),
    ),
    TaskBlocked: BusEvent.define(
      "task.blocked",
      z.object({
        sessionID: SessionID.zod,
        reason: z.string().optional(),
      }),
    ),
    TaskInputNeeded: BusEvent.define(
      "task.input_needed",
      z.object({
        sessionID: SessionID.zod,
        parentID: SessionID.zod,
        question: z.string(),
      }),
    ),
  }

  /** Persist status to DB for states that should survive restarts. */
  function persistToDb(sessionID: SessionID, status: Info) {
    if (PERSISTENT_STATES.has(status.type)) {
      try {
        Database.use((db) =>
          db
            .update(SessionTable)
            .set({ status: status.type })
            .where(eq(SessionTable.id, sessionID))
            .run(),
        )
      } catch (err) {
        log.warn("failed to persist task status to db", { sessionID, status: status.type, error: err })
      }
    }
  }

  /** Read persisted status from DB for a session. */
  function readFromDb(sessionID: SessionID): Info | undefined {
    try {
      const row = Database.use((db) =>
        db
          .select({ status: SessionTable.status })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get(),
      )
      if (row?.status && PERSISTENT_STATES.has(row.status)) {
        return { type: row.status } as Info
      }
    } catch {
      // DB not available yet or session doesn't exist
    }
    return undefined
  }

  export interface Interface {
    readonly get: (sessionID: SessionID) => Effect.Effect<Info>
    readonly list: () => Effect.Effect<Map<SessionID, Info>>
    readonly set: (sessionID: SessionID, status: Info) => Effect.Effect<void>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/SessionStatus") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service

      const state = yield* InstanceState.make(
        Effect.fn("SessionStatus.state")(() => Effect.succeed(new Map<SessionID, Info>())),
      )

      const get = Effect.fn("SessionStatus.get")(function* (sessionID: SessionID) {
        const data = yield* InstanceState.get(state)
        const memStatus = data.get(sessionID)
        if (memStatus) return memStatus
        // Fallback to DB for persistent states (e.g. after restart)
        const dbStatus = readFromDb(sessionID)
        if (dbStatus) {
          data.set(sessionID, dbStatus)
          return dbStatus
        }
        return { type: "idle" as const }
      })

      const list = Effect.fn("SessionStatus.list")(function* () {
        return new Map(yield* InstanceState.get(state))
      })

      const set = Effect.fn("SessionStatus.set")(function* (sessionID: SessionID, status: Info) {
        const data = yield* InstanceState.get(state)
        yield* bus.publish(Event.Status, { sessionID, status })
        if (status.type === "idle") {
          yield* bus.publish(Event.Idle, { sessionID })
          data.delete(sessionID)
          persistToDb(sessionID, status)
          return
        }
        data.set(sessionID, status)
        persistToDb(sessionID, status)
      })

      return Service.of({ get, list, set })
    }),
  )

  const defaultLayer = layer.pipe(Layer.provide(Bus.layer))
  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function get(sessionID: SessionID) {
    return runPromise((svc) => svc.get(sessionID))
  }

  export async function list() {
    return runPromise((svc) => svc.list())
  }

  export async function set(sessionID: SessionID, status: Info) {
    return runPromise((svc) => svc.set(sessionID, status))
  }
}
