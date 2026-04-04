import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { Permission } from "@/permission"
import { SessionStatus } from "../session/status"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { Workspace } from "../control-plane/workspace"
import { Database, eq } from "../storage/db"
import { SessionTable } from "../session/session.sql"

const log = Log.create({ service: "task" })

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  task_id: z
    .string()
    .describe(
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
    )
    .optional(),
  command: z.string().describe("The command that triggered this task").optional(),
  mode: z
    .enum(["foreground", "background"])
    .default("foreground")
    .describe(
      "'foreground' blocks until done (default). 'background' returns task_id immediately and runs the task asynchronously.",
    )
    .optional(),
})

export const TaskTool = Tool.define("task", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  // Filter agents by permissions if agent provided
  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => Permission.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents
  const list = accessibleAgents.toSorted((a, b) => a.name.localeCompare(b.name))

  const description = DESCRIPTION.replace(
    "{agents}",
    list
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const config = await Config.get()
      const mode = params.mode ?? "foreground"

      // Skip permission check when user explicitly invoked via @ or command subtask
      if (!ctx.extra?.bypassAgentCheck) {
        await ctx.ask({
          permission: "task",
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const agent = await Agent.get(params.subagent_type)
      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      const hasTaskPermission = agent.permission.some((rule) => rule.permission === "task")
      const hasTodoWritePermission = agent.permission.some((rule) => rule.permission === "todowrite")

      const session = await iife(async () => {
        if (params.task_id) {
          const found = await Session.get(SessionID.make(params.task_id)).catch(() => {})
          if (found) return found
        }

        return await Session.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${agent.name} subagent)`,
          permission: [
            ...(hasTodoWritePermission
              ? []
              : [
                  {
                    permission: "todowrite" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(hasTaskPermission
              ? []
              : [
                  {
                    permission: "task" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(config.experimental?.primary_tools?.map((t) => ({
              pattern: "*",
              action: "allow" as const,
              permission: t,
            })) ?? []),
          ],
        })
      })
      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      const model = agent.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
          mode,
        },
      })

      const messageID = MessageID.ascending()
      const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)

      const promptInput = {
        messageID,
        sessionID: session.id,
        model: {
          modelID: model.modelID,
          providerID: model.providerID,
        },
        agent: agent.name,
        tools: {
          ...(hasTodoWritePermission ? {} : { todowrite: false }),
          ...(hasTaskPermission ? {} : { task: false }),
          ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
        },
        parts: promptParts,
      }

      // Background mode: fire-and-forget, return task_id immediately
      if (mode === "background") {
        // Try to create an isolated worktree for the background task
        let workspace: Workspace.Info | undefined
        try {
          const project = Instance.current.project
          if (project.vcs === "git") {
            workspace = await Workspace.create({
              type: "worktree",
              branch: null, // Adaptor generates a unique branch
              projectID: project.id,
              extra: null,
            })
            // Link workspace to session for later lookup
            if (workspace?.id) {
              try {
                Database.use((db) =>
                  db.update(SessionTable)
                    .set({ workspace_id: workspace!.id })
                    .where(eq(SessionTable.id, session.id))
                    .run(),
                )
              } catch { /* best-effort */ }
            }
            log.info("created worktree for background task", {
              sessionID: session.id,
              worktree: workspace.directory,
              branch: workspace.branch,
            })
          }
        } catch (err) {
          log.warn("failed to create worktree for background task, running in main worktree", {
            sessionID: session.id,
            error: err instanceof Error ? err.message : String(err),
          })
          workspace = undefined
        }

        // Publish task created event
        await Bus.publish(SessionStatus.Event.TaskCreated, {
          sessionID: session.id,
          parentID: ctx.sessionID,
          agent: agent.name,
          description: params.description,
        })
        await SessionStatus.set(session.id, { type: "queued" })

        // Run the prompt in the worktree context if available
        const runPrompt = async () => {
          if (workspace?.directory) {
            return Instance.provide({
              directory: workspace.directory,
              fn: () => SessionPrompt.prompt(promptInput),
            })
          }
          return SessionPrompt.prompt(promptInput)
        }

        // Fire and forget with proper error boundary
        runPrompt()
          .then(async (result) => {
            try {
              const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
              await SessionStatus.set(session.id, { type: "completed", result: text.slice(0, 500) })
              await Bus.publish(SessionStatus.Event.TaskCompleted, {
                sessionID: session.id,
                parentID: ctx.sessionID,
                result: text.slice(0, 500),
              })
              // Auto-cleanup worktree if no changes were made
              if (workspace) {
                try {
                  const summary = await Session.get(session.id).then((s) => s.summary)
                  const hasChanges = summary && (summary.additions > 0 || summary.deletions > 0)
                  if (!hasChanges) {
                    await Workspace.remove(workspace.id)
                    log.info("auto-cleaned empty worktree", { sessionID: session.id, workspaceID: workspace.id })
                  } else {
                    log.info("worktree retained with changes", {
                      sessionID: session.id,
                      workspaceID: workspace.id,
                      additions: summary?.additions,
                      deletions: summary?.deletions,
                    })
                  }
                } catch (cleanupErr) {
                  log.warn("failed to cleanup worktree", { sessionID: session.id, error: cleanupErr })
                }
              }
            } catch (innerErr) {
              const errorMsg = innerErr instanceof Error ? innerErr.message : String(innerErr)
              await SessionStatus.set(session.id, { type: "failed", error: errorMsg }).catch(() => {})
              await Bus.publish(SessionStatus.Event.TaskFailed, {
                sessionID: session.id,
                parentID: ctx.sessionID,
                error: errorMsg,
              }).catch(() => {})
              log.error("background task completion handler failed", { sessionID: session.id, error: errorMsg })
            }
          })
          .catch(async (err) => {
            try {
              const errorMsg = err instanceof Error ? err.message : String(err)
              await SessionStatus.set(session.id, { type: "failed", error: errorMsg })
              await Bus.publish(SessionStatus.Event.TaskFailed, {
                sessionID: session.id,
                parentID: ctx.sessionID,
                error: errorMsg,
              })
              log.error("background task failed", { sessionID: session.id, error: errorMsg })
            } catch (catchErr) {
              log.error("background task error handler failed", { sessionID: session.id, error: catchErr })
            }
          })

        return {
          title: params.description,
          metadata: {
            sessionId: session.id,
            model,
            mode: "background" as string,
            worktreeId: workspace?.id ?? null,
            worktreeDirectory: workspace?.directory ?? null,
            worktreeBranch: workspace?.branch ?? null,
          },
          output: [
            `task_id: ${session.id} (for resuming or checking status later)`,
            `mode: background`,
            `status: queued`,
            workspace ? `worktree: ${workspace.directory} (branch: ${workspace.branch})` : `worktree: none (no git repo)`,
            "",
            `The task has been launched in the background in an isolated worktree. Use the task_id to check status or resume later.`,
          ].join("\n"),
        }
      }

      // Foreground mode: block until completion (existing behavior)
      function cancel() {
        SessionPrompt.cancel(session.id)
      }
      ctx.abort.addEventListener("abort", cancel)
      using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))

      try {
        const result = await SessionPrompt.prompt(promptInput)

        const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

        // Publish completion event
        await SessionStatus.set(session.id, { type: "completed", result: text.slice(0, 500) })
        await Bus.publish(SessionStatus.Event.TaskCompleted, {
          sessionID: session.id,
          parentID: ctx.sessionID,
          result: text.slice(0, 500),
        })

        const output = [
          `task_id: ${session.id} (for resuming to continue this task if needed)`,
          "",
          "<task_result>",
          text,
          "</task_result>",
        ].join("\n")

        return {
          title: params.description,
          metadata: {
            sessionId: session.id,
            model,
            mode: "foreground" as string,
            worktreeId: null as string | null,
            worktreeDirectory: null as string | null,
            worktreeBranch: null as string | null,
          },
          output,
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        await SessionStatus.set(session.id, { type: "failed", error: errorMsg })
        await Bus.publish(SessionStatus.Event.TaskFailed, {
          sessionID: session.id,
          parentID: ctx.sessionID,
          error: errorMsg,
        })
        throw err
      }
    },
  }
})
