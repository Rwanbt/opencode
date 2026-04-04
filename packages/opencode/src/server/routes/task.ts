import { Hono } from "hono"
import { stream } from "hono/streaming"
import { describeRoute, validator, resolver } from "hono-openapi"
import { SessionID, MessageID } from "@/session/schema"
import z from "zod"
import { Session } from "../../session"
import { MessageV2 } from "../../session/message-v2"
import { SessionPrompt } from "../../session/prompt"
import { SessionStatus } from "@/session/status"
import { Workspace } from "../../control-plane/workspace"
import { Bus } from "../../bus"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { Log } from "../../util/log"

const log = Log.create({ service: "server.task" })

async function getWorktreeInfo(session: { workspaceID?: string }) {
  if (!session.workspaceID) return undefined
  try {
    const ws = await Workspace.get(session.workspaceID as any)
    if (!ws || ws.type !== "worktree") return undefined
    return { id: ws.id, directory: ws.directory, branch: ws.branch }
  } catch {
    return undefined
  }
}

const WorktreeInfo = z
  .object({
    id: z.string(),
    directory: z.string().nullable(),
    branch: z.string().nullable(),
  })
  .optional()

const TaskInfo = z
  .object({
    session: Session.Info,
    status: SessionStatus.Info,
    childCount: z.number().optional(),
    worktree: WorktreeInfo,
  })
  .meta({ ref: "TaskInfo" })

export const TaskRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List tasks",
        description:
          "List all tasks (child sessions) sorted by most recently updated. Optionally filter by parent session or status.",
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

        // Sort by most recently updated
        sessions.sort((a, b) => b.time.updated - a.time.updated)

        // Merge with status info, child counts, and worktree info
        const statusMap = await SessionStatus.list()
        let tasks = await Promise.all(
          sessions.map(async (session) => {
            const status = statusMap.get(session.id) ?? await SessionStatus.get(session.id)
            const children = await Session.children(session.id)
            const worktree = await getWorktreeInfo(session)
            return {
              session,
              status,
              childCount: children.length,
              worktree,
            }
          }),
        )

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
        const children = await Session.children(id)
        const worktree = await getWorktreeInfo(session)
        return c.json({ session, status, childCount: children.length, worktree })
      },
    )
    .get(
      "/:id/messages",
      describeRoute({
        summary: "Get task messages",
        description: "Retrieve all messages from a task session to see its output and progress.",
        operationId: "task.messages",
        responses: {
          200: {
            description: "List of messages",
            content: {
              "application/json": {
                schema: resolver(MessageV2.WithParts.array()),
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
        "query",
        z.object({
          limit: z.coerce
            .number()
            .int()
            .min(0)
            .optional()
            .meta({ description: "Maximum number of messages to return" }),
        }),
      ),
      async (c) => {
        const id = c.req.valid("param").id
        const query = c.req.valid("query")
        await Session.get(id) // validate exists
        const messages = await Session.messages({ sessionID: id })
        if (query.limit) {
          return c.json(messages.slice(-query.limit))
        }
        return c.json(messages)
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
          throw new Error(
            `Task is in state '${status.type}' and cannot be resumed. Must be one of: ${resumableStates.join(", ")}`,
          )
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
    )
    .post(
      "/:id/followup",
      describeRoute({
        summary: "Send follow-up to task",
        description:
          "Send a follow-up message to a task session. The task must be in a non-busy state. Returns immediately while the task processes the message.",
        operationId: "task.followup",
        responses: {
          200: {
            description: "Follow-up accepted",
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
          prompt: z.string().meta({ description: "The follow-up message to send to the task" }),
        }),
      ),
      async (c) => {
        const id = c.req.valid("param").id
        const body = c.req.valid("json")
        const session = await Session.get(id)
        const status = await SessionStatus.get(id)

        if (status.type === "busy") {
          throw new Error("Task is currently busy. Wait for it to finish or cancel it first.")
        }

        await SessionStatus.set(id, { type: "busy" })

        const parts = await SessionPrompt.resolvePromptParts(body.prompt)

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
            log.error("task followup failed", { sessionID: id, error: errorMsg })
          })

        return c.json(true)
      },
    )
    .post(
      "/:id/promote",
      describeRoute({
        summary: "Promote task to foreground",
        description:
          "Promote a background task to foreground by streaming its session messages. The response streams until the task completes or is cancelled.",
        operationId: "task.promote",
        responses: {
          200: {
            description: "Task output stream",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    session: Session.Info,
                    status: SessionStatus.Info,
                    messages: MessageV2.WithParts.array(),
                  }),
                ),
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
        const messages = await Session.messages({ sessionID: id })

        // Return current state snapshot - the client can subscribe to SSE events
        // for real-time updates via the existing event stream
        return c.json({
          session,
          status,
          messages,
        })
      },
    ),
)
