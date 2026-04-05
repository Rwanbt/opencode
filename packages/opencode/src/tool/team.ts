import { Tool } from "./tool"
import z from "zod"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { Config } from "../config/config"
import { Permission } from "@/permission"
import { SessionStatus } from "../session/status"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { Workspace } from "../control-plane/workspace"
import { Database, eq } from "../storage/db"
import { SessionTable } from "../session/session.sql"

const log = Log.create({ service: "team" })

const MAX_TEAM_TASKS = 5

const TaskDef = z.object({
  description: z.string().describe("Short description of this sub-task (3-5 words)"),
  prompt: z.string().describe("Detailed prompt for the agent to execute"),
  agent: z.string().describe("Agent type to use: 'explore' for research, 'general' for implementation"),
  depends_on: z
    .array(z.number())
    .optional()
    .describe("Indices of tasks that must complete before this one starts (0-based)"),
})

const parameters = z.object({
  description: z.string().describe("Overall description of the team's goal"),
  tasks: z.array(TaskDef).min(1).max(MAX_TEAM_TASKS).describe("List of sub-tasks to execute"),
  budget: z
    .object({
      max_cost: z.number().optional().describe("Maximum total cost in dollars"),
      max_tokens: z.number().int().optional().describe("Maximum total tokens (input + output) across all tasks"),
      max_agents: z
        .number()
        .int()
        .min(1)
        .max(MAX_TEAM_TASKS)
        .optional()
        .describe("Maximum parallel agents (default: 5)"),
    })
    .optional(),
})

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/** Group tasks into waves based on dependency graph. */
function computeWaves(tasks: z.infer<typeof TaskDef>[]): number[][] {
  const n = tasks.length
  const assigned = new Array<number>(n).fill(-1)
  let changed = true

  while (changed) {
    changed = false
    for (let i = 0; i < n; i++) {
      if (assigned[i] >= 0) continue
      const deps = tasks[i].depends_on ?? []
      if (deps.length === 0) {
        assigned[i] = 0
        changed = true
      } else if (deps.every((d) => assigned[d] >= 0)) {
        assigned[i] = Math.max(...deps.map((d) => assigned[d])) + 1
        changed = true
      }
    }
  }

  // Check for unresolvable dependencies (cycles)
  if (assigned.some((w) => w < 0)) {
    throw new Error("Circular or invalid dependencies detected in task graph")
  }

  const maxWave = Math.max(...assigned)
  const waves: number[][] = []
  for (let w = 0; w <= maxWave; w++) {
    waves.push(assigned.map((wave, idx) => (wave === w ? idx : -1)).filter((idx) => idx >= 0))
  }
  return waves
}

/** Get total cost of a session's messages. */
async function getSessionCost(sessionID: SessionID): Promise<number> {
  const messages = await Session.messages({ sessionID })
  return messages.reduce((sum, msg) => {
    if (msg.info.role === "assistant") return sum + ((msg.info as any).cost || 0)
    return sum
  }, 0)
}

/** Get total tokens (input + output) of a session's messages. */
async function getSessionTokens(sessionID: SessionID): Promise<number> {
  const messages = await Session.messages({ sessionID })
  return messages.reduce((sum, msg) => {
    if (msg.info.role === "assistant") {
      const t = (msg.info as any).tokens
      if (t) return sum + (t.input || 0) + (t.output || 0) + (t.reasoning || 0)
    }
    return sum
  }, 0)
}

export const TeamTool = Tool.define("team", async (ctx) => {
  return {
    description: [
      "Launch a coordinated team of agents to accomplish a complex task.",
      "Each sub-task runs in an isolated background worktree.",
      "Tasks can depend on each other and execute in waves.",
      "Use this for tasks that benefit from parallel research and implementation.",
    ].join(" "),
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const config = await Config.get()
      const maxParallel = params.budget?.max_agents ?? MAX_TEAM_TASKS
      const maxCost = params.budget?.max_cost
      const maxTokens = params.budget?.max_tokens

      // Validate agents exist
      const agents = await Agent.list()
      for (const task of params.tasks) {
        const agent = agents.find((a) => a.name === task.agent)
        if (!agent) throw new Error(`Unknown agent: ${task.agent}`)
      }

      // Validate dependency indices
      for (let i = 0; i < params.tasks.length; i++) {
        for (const dep of params.tasks[i].depends_on ?? []) {
          if (dep < 0 || dep >= params.tasks.length || dep === i) {
            throw new Error(`Invalid dependency: task ${i} depends on ${dep}`)
          }
        }
      }

      // Compute wave ordering
      const waves = computeWaves(params.tasks)
      log.info("team wave plan", {
        description: params.description,
        waves: waves.map((w) => w.map((i) => params.tasks[i].description)),
      })

      // Track task sessions
      interface TaskRecord {
        index: number
        sessionID: SessionID
        description: string
        agent: string
        status: string
        result: string | undefined
        cost: number
        tokens: number
      }
      const taskSessions: TaskRecord[] = []

      let totalCost = 0
      let totalTokens = 0

      // Execute waves sequentially, tasks within each wave in parallel
      for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
        const wave = waves[waveIdx]

        // Budget check before starting wave
        if (maxCost && totalCost >= maxCost) {
          log.warn("team cost budget exceeded, stopping", { totalCost, maxCost })
          break
        }
        if (maxTokens && totalTokens >= maxTokens) {
          log.warn("team token budget exceeded, stopping", { totalTokens, maxTokens })
          break
        }

        // Build context from completed tasks for dependent tasks
        const completedContext = taskSessions
          .filter((t) => t.status === "completed" && t.result)
          .map((t) => `[Task "${t.description}" (${t.agent})]: ${t.result}`)
          .join("\n\n")

        // Launch all tasks in this wave
        const wavePromises: Promise<void>[] = []

        for (const taskIdx of wave) {
          const taskDef = params.tasks[taskIdx]
          const agent = await Agent.get(taskDef.agent)
          if (!agent) continue

          const hasTaskPermission = agent.permission.some((r) => r.permission === "task")
          const hasTodoWritePermission = agent.permission.some((r) => r.permission === "todowrite")

          // Create child session
          const session = await Session.create({
            parentID: ctx.sessionID,
            title: `${taskDef.description} (@${agent.name} team member)`,
            permission: [
              ...(hasTodoWritePermission ? [] : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
              ...(hasTaskPermission ? [] : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
              ...(config.experimental?.primary_tools?.map((t) => ({ pattern: "*", action: "allow" as const, permission: t })) ?? []),
            ],
          })

          const taskEntry: TaskRecord = {
            index: taskIdx,
            sessionID: session.id,
            description: taskDef.description,
            agent: taskDef.agent,
            status: "queued",
            result: undefined,
            cost: 0,
            tokens: 0,
          }
          taskSessions.push(taskEntry)

          // Create worktree for isolation
          let workspace: Workspace.Info | undefined
          try {
            const project = Instance.current.project
            if (project.vcs === "git") {
              workspace = await Workspace.create({
                type: "worktree",
                branch: null,
                projectID: project.id,
                extra: null,
              })
              try {
                Database.use((db) =>
                  db.update(SessionTable).set({ workspace_id: workspace!.id }).where(eq(SessionTable.id, session.id)).run(),
                )
              } catch { /* best-effort */ }
            }
          } catch (err) {
            log.warn("failed to create worktree for team member", { error: err })
          }

          // Build prompt with context from prior waves
          const promptText = completedContext
            ? `## Context from prior tasks\n\n${completedContext}\n\n## Your task\n\n${taskDef.prompt}`
            : taskDef.prompt

          const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
          if (msg.info.role !== "assistant") throw new Error("Team tool must be called from an assistant message")
          const model = agent.model ?? {
            modelID: msg.info.modelID,
            providerID: msg.info.providerID,
          }

          const messageID = MessageID.ascending()
          const promptParts = await SessionPrompt.resolvePromptParts(promptText)

          const promptInput = {
            messageID,
            sessionID: session.id,
            model: { modelID: model.modelID, providerID: model.providerID },
            agent: agent.name,
            tools: {
              ...(hasTodoWritePermission ? {} : { todowrite: false }),
              ...(hasTaskPermission ? {} : { task: false }),
              ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
            },
            parts: promptParts,
          }

          await SessionStatus.set(session.id, { type: "queued" })

          // Run in worktree context
          const runPrompt = async () => {
            if (workspace?.directory) {
              return Instance.provide({
                directory: workspace.directory,
                fn: () => SessionPrompt.prompt(promptInput),
              })
            }
            return SessionPrompt.prompt(promptInput)
          }

          const taskPromise = runPrompt()
            .then(async (result) => {
              try {
                const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
                taskEntry.status = "completed"
                taskEntry.result = text.slice(0, 500)
                taskEntry.cost = await getSessionCost(session.id)
                taskEntry.tokens = await getSessionTokens(session.id)
                await SessionStatus.set(session.id, { type: "completed", result: text.slice(0, 500) })

                // Auto-cleanup worktree if no changes
                if (workspace) {
                  try {
                    const s = await Session.get(session.id)
                    const hasChanges = s.summary && (s.summary.additions > 0 || s.summary.deletions > 0)
                    if (!hasChanges) {
                      await Workspace.remove(workspace.id)
                    }
                  } catch { /* ignore cleanup errors */ }
                }
              } catch (innerErr) {
                const errorMsg = innerErr instanceof Error ? innerErr.message : String(innerErr)
                taskEntry.status = "failed"
                taskEntry.result = errorMsg
                await SessionStatus.set(session.id, { type: "failed", error: errorMsg }).catch(() => {})
                log.error("team member completion handler failed", { sessionID: session.id, error: errorMsg })
              }
            })
            .catch(async (err) => {
              try {
                const errorMsg = err instanceof Error ? err.message : String(err)
                taskEntry.status = "failed"
                taskEntry.result = errorMsg
                taskEntry.cost = await getSessionCost(session.id).catch(() => 0)
                await SessionStatus.set(session.id, { type: "failed", error: errorMsg })
                log.error("team member failed", { sessionID: session.id, error: errorMsg })
              } catch (catchErr) {
                log.error("team member error handler failed", { sessionID: session.id, error: catchErr })
              }
            })

          wavePromises.push(taskPromise)
        }

        // Wait for all tasks in this wave to complete
        await Promise.all(wavePromises)

        // Update totals
        totalCost = taskSessions.reduce((sum, t) => sum + t.cost, 0)
        totalTokens = taskSessions.reduce((sum, t) => sum + t.tokens, 0)

        log.info("team wave completed", {
          wave: waveIdx,
          totalWaves: waves.length,
          totalCost,
          results: wave.map((i) => ({
            description: params.tasks[i].description,
            status: taskSessions.find((t) => t.index === i)?.status,
          })),
        })
      }

      // Publish team completed event
      await Bus.publish(SessionStatus.Event.TeamCompleted, {
        sessionID: ctx.sessionID,
        tasks: taskSessions.map((t) => ({
          sessionID: t.sessionID,
          status: t.status,
          description: t.description,
          result: t.result,
        })),
        totalCost,
      })

      // Build output summary
      const completed = taskSessions.filter((t) => t.status === "completed")
      const failed = taskSessions.filter((t) => t.status === "failed")

      const output = [
        `## Team Run: ${params.description}`,
        "",
        `**${completed.length}/${taskSessions.length} tasks completed** | Total cost: $${totalCost.toFixed(4)} | Total tokens: ${totalTokens.toLocaleString()}`,
        "",
        ...taskSessions.map((t) => {
          const icon = t.status === "completed" ? "[OK]" : t.status === "failed" ? "[FAIL]" : "[?]"
          return [
            `### ${icon} ${t.description} (@${t.agent})`,
            `task_id: ${t.sessionID}`,
            "",
            t.result ? `<result>\n${t.result}\n</result>` : "(no output)",
            "",
          ].join("\n")
        }),
      ].join("\n")

      return {
        title: `Team: ${params.description}`,
        metadata: {
          teamSize: taskSessions.length,
          completed: completed.length,
          failed: failed.length,
          totalCost,
          totalTokens,
        },
        output,
      }
    },
  }
})
