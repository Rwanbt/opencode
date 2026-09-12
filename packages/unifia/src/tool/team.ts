import z from "zod"
import { Bus } from "../bus"
import { Instance } from "../project/instance"
import { SessionID } from "../session/schema"
import { SessionStatus } from "../session/status"
import { runOpenCodeTeam } from "../team/opencode-application"
import { Tool } from "./tool"
import DESCRIPTION from "./team.txt"

const MAX_TEAM_TASKS = 5

interface WorkerInfo {
  readonly taskId: string
  readonly sessionId: string
  readonly description: string
  readonly providerID: string
  readonly modelID: string
}

const TaskDef = z.object({
  description: z.string().min(1).describe("Short description of this sub-task"),
  prompt: z.string().min(1).describe("Detailed prompt for the agent to execute"),
  agent: z.string().min(1).describe("Agent type, for example explore or general"),
  mode: z.enum(["read", "write"]).optional().describe("Whether the task may modify files; inferred from the agent when omitted"),
  required: z.boolean().optional().default(true),
  risk: z.enum(["low", "medium", "high", "critical"]).optional().default("medium"),
  depends_on: z.array(z.number().int()).optional().describe("Indices of prerequisite tasks (0-based)"),
  read_set: z.array(z.string()).optional().default([]),
  write_set: z.array(z.string()).optional().default([]),
})

const parameters = z.object({
  description: z.string().min(1).describe("Overall description of the team's goal"),
  tasks: z.array(TaskDef).min(1).max(MAX_TEAM_TASKS),
  budget: z.object({
    max_cost: z.number().positive().optional(),
    max_tokens: z.number().int().positive().optional(),
    max_agents: z.number().int().min(1).max(MAX_TEAM_TASKS).optional(),
  }).optional(),
})

export const TeamTool = Tool.define("team", async () => ({
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    validateDependencies(params.tasks)
    const runId = crypto.randomUUID()
    const baseSha = await gitHead(Instance.directory)
    const taskIds = params.tasks.map((_, index) => `${runId}-task-${index + 1}`)
    const taskDescriptions = new Map(taskIds.map((taskId, index) => [taskId, params.tasks[index].description]))
    const workers = new Map<string, WorkerInfo>()
    const publishWorkers = () =>
      ctx.metadata({
        title: `Team: ${params.description}`,
        metadata: { runId, workers: [...workers.values()] },
      })

    const result = await runOpenCodeTeam({
      runId,
      planId: `tool-${ctx.sessionID}-${ctx.messageID}`,
      parentSessionId: ctx.sessionID,
      objective: params.description,
      primaryWorkspacePath: Instance.directory,
      integrationBaseSha: baseSha,
      maxParallel: params.budget?.max_cost !== undefined || params.budget?.max_tokens !== undefined ? 1 : params.budget?.max_agents ?? MAX_TEAM_TASKS,
      budget: { maxCostUsd: params.budget?.max_cost, maxTokens: params.budget?.max_tokens },
      tasks: params.tasks.map((task, index) => ({
        taskId: taskIds[index],
        description: task.description,
        prompt: task.prompt,
        agent: task.agent,
        mode: task.mode ?? (task.agent === "explore" ? "read" : "write"),
        required: task.required,
        risk: task.risk,
        modelIndex: index,
        dependsOn: (task.depends_on ?? []).map((dependency) => taskIds[dependency]),
        scope: { readSet: task.read_set, writeSet: task.write_set },
      })),
    }, ctx.abort, {
      onWorkerStarted: (info) => {
        workers.set(info.taskId, {
          taskId: info.taskId,
          sessionId: info.sessionId,
          description: taskDescriptions.get(info.taskId) ?? info.taskId,
          providerID: info.providerID,
          modelID: info.modelID,
        })
        publishWorkers()
      },
    })

    const tasks = [...result.taskResults.values()]
    const totalCost = tasks.reduce((sum, task) => sum + task.costUsd, 0)
    const totalTokens = tasks.reduce((sum, task) => sum + task.inputTokens + task.outputTokens, 0)
    await Bus.publish(SessionStatus.Event.TeamCompleted, {
      sessionID: ctx.sessionID,
      tasks: params.tasks.map((task, index) => {
        const worker = result.taskResults.get(taskIds[index])
        return {
          sessionID: SessionID.make(worker?.sessionId ?? ctx.sessionID),
          status: worker?.status.toLowerCase() ?? "blocked",
          description: task.description,
          result: worker?.output ?? "not completed",
        }
      }),
      totalCost,
    })

    return {
      title: `Team: ${params.description}`,
      metadata: {
        runId,
        verdict: result.report.verdict,
        teamSize: params.tasks.length,
        completed: tasks.filter((task) => task.status === "COMPLETED").length,
        totalCost,
        totalTokens,
        workers: [...workers.values()],
      },
      output: result.report.markdown,
    }
  },
}))

function validateDependencies(tasks: readonly z.infer<typeof TaskDef>[]): void {
  for (const [index, task] of tasks.entries()) {
    for (const dependency of task.depends_on ?? []) {
      if (dependency < 0 || dependency >= tasks.length || dependency === index) {
        throw new TypeError(`Invalid Team dependency: task ${index} depends on ${dependency}`)
      }
    }
  }
}

async function gitHead(directory: string): Promise<string> {
  const process = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: directory, stdout: "pipe", stderr: "pipe" })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`Team requires a Git repository: ${stderr || stdout}`)
  return stdout.trim()
}