import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { SessionID } from "./schema"
import { Effect, Layer, ServiceMap } from "effect"
import z from "zod"

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
        return data.get(sessionID) ?? { type: "idle" as const }
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
          return
        }
        data.set(sessionID, status)
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
