import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { SessionID } from "@/session/schema"
import z from "zod"
import { Session } from "../../session"
import { SessionPrompt } from "../../session/prompt"
import { SessionStatus } from "@/session/status"
import { Bus } from "../../bus"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { Log } from "../../util/log"

const log = Log.create({ service: "server.task" })

const TaskInfo = z
  .object({
    session: Session.Info,
    status: SessionStatus.Info,
  })
  .meta({ ref: "TaskInfo" })

export const TaskRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List tasks",
        description:
          "List all tasks (child sessions). Optionally filter by parent session or status.",
        operationId: "task.list",
        responses: {
          200: {
            description: "List of tasks",
            content: {
              "application/json": {
                schema: resolver(TaskInfo.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          parentID: SessionID.zod.optional().meta({ description: "Filter by parent session ID" }),
          status: SessionStatus.TaskStatus.optional().meta({ description: "Filter by task status" }),
          limit: z.coerce.number().optional().meta({ description: "Maximum number of tasks to return" }),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const sessions: Session.Info[] = []

        // List child sessions (tasks are sessions with a parentID)
        for await (const session of Session.list({
          roots: false,
        })) {
          if (!session.parentID) continue
          if (query.parentID && session.parentID !== query.parentID) continue
          sessions.push(session)
        }

        // Merge with status info
        const statusMap = await SessionStatus.list()
        let tasks = sessions.map((session) => ({
          session,
          status: statusMap.get(session.id) ?? { type: "idle" as const },
        }))

        // Filter by status if requested
        if (query.status) {
          tasks = tasks.filter((t) => t.status.type === query.status)
        }

        // Apply limit
        if (query.limit) {
          tasks = tasks.slice(0, query.limit)
        }

        return c.json(tasks)
      },
    )
    .get(
      "/:id",
      describeRoute({
        summary: "Get task",
        description: "Get detailed information about a specific task including its current status.",
        operationId: "task.get",
        responses: {
          200: {
            description: "Task details",
            content: {
              "application/json": {
                schema: resolver(TaskInfo),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          id: SessionID.zod,
        }),
      ),
      async (c) => {
        const id = c.req.valid("param").id
        const session = await Session.get(id)
        const status = await SessionStatus.get(id)
        return c.json({ session, status })
      },
    )
    .post(
      "/:id/cancel",
      describeRoute({
        summary: "Cancel task",
        description: "Cancel a running or queued task.",
        operationId: "task.cancel",
        responses: {
          200: {
            description: "Task cancelled",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          id: SessionID.zod,
        }),
      ),
      async (c) => {
        const id = c.req.valid("param").id
        await SessionPrompt.cancel(id)
        await SessionStatus.set(id, { type: "cancelled" })
        await Bus.publish(SessionStatus.Event.TaskCancelled, { sessionID: id })
        return c.json(true)
      },
    )
    .post(
      "/:id/resume",
      describeRoute({
        summary: "Resume task",
        description:
          "Resume a completed, failed, blocked, or awaiting_input task with an optional follow-up prompt.",
        operationId: "task.resume",
        responses: {
          200: {
            description: "Task resumed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          id: SessionID.zod,
        }),
      ),
      validator(
        "json",
        z.object({
          prompt: z.string().optional().meta({ description: "Follow-up prompt to send to the task" }),
        }),
      ),
      async (c) => {
        const id = c.req.valid("param").id
        const body = c.req.valid("json")
        const session = await Session.get(id)
        const status = await SessionStatus.get(id)

        const resumableStates = ["completed", "failed", "blocked", "awaiting_input", "cancelled", "idle"]
        if (!resumableStates.includes(status.type)) {
          throw new Error(`Task is in state '${status.type}' and cannot be resumed. Must be one of: ${resumableStates.join(", ")}`)
        }

        await SessionStatus.set(id, { type: "busy" })

        // Fire and forget the resume prompt
        const parts = body.prompt
          ? await SessionPrompt.resolvePromptParts(body.prompt)
          : [{ type: "text" as const, text: "Continue the task." }]

        SessionPrompt.prompt({
          sessionID: id,
          parts,
        })
          .then(async () => {
            await SessionStatus.set(id, { type: "completed" })
            if (session.parentID) {
              await Bus.publish(SessionStatus.Event.TaskCompleted, {
                sessionID: id,
                parentID: session.parentID,
              })
            }
          })
          .catch(async (err) => {
            const errorMsg = err instanceof Error ? err.message : String(err)
            await SessionStatus.set(id, { type: "failed", error: errorMsg })
            if (session.parentID) {
              await Bus.publish(SessionStatus.Event.TaskFailed, {
                sessionID: id,
                parentID: session.parentID,
                error: errorMsg,
              })
            }
            log.error("task resume failed", { sessionID: id, error: errorMsg })
          })

        return c.json(true)
      },
    ),
)
