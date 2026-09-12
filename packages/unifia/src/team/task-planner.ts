import { generateObject, type LanguageModel } from "ai"
import { NamedError } from "@unifia/util/error"
import z from "zod"
import { createPromptRegistry, type PromptRegistry } from "../multi-model/prompt-registry"
import type { TaskRequirements } from "./intake"

const PLANNER_PROMPT_ID = "team.planner"
const PLANNER_PROMPT_VERSION = "1.0.0"
const DEFAULT_MAX_OUTPUT_TOKENS = 4_000
const DEFAULT_MAX_TOTAL_TOKENS = 8_000

export const PlannerTaskSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    title: z.string().min(1).max(200),
    objective: z.string().min(1),
    dependsOn: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)),
    readSet: z.array(z.string().min(1)),
    writeSet: z.array(z.string().min(1)),
    exclusiveResources: z.array(z.string().min(1)),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
    risks: z.array(z.string().min(1)),
    gates: z.array(z.string().min(1)),
  })
  .strict()

export const TaskPlanSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    tasks: z.array(PlannerTaskSchema).min(1).max(50),
    integrationStrategy: z.string().min(1),
    rollback: z.string().min(1),
    globalRisks: z.array(z.string().min(1)),
    globalGates: z.array(z.string().min(1)),
  })
  .strict()

export type PlannerTask = z.infer<typeof PlannerTaskSchema>
export type TaskPlan = z.infer<typeof TaskPlanSchema>

export interface PlannerBudget {
  readonly maxOutputTokens?: number
  readonly maxTotalTokens?: number
}

export interface TaskPlannerInput {
  readonly requirements: TaskRequirements
  readonly model: LanguageModel
  readonly promptRegistry?: PromptRegistry
  readonly budget?: PlannerBudget
  readonly signal?: AbortSignal
}

export interface PlannerUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
}

export interface TaskPlannerResult {
  readonly plan: TaskPlan
  readonly usage: PlannerUsage
  readonly promptId: string
  readonly promptVersion: string
}

export const TaskPlannerBudgetExceededError = NamedError.create(
  "TaskPlannerBudgetExceededError",
  z.object({
    totalTokens: z.number().int().nonnegative(),
    maxTotalTokens: z.number().int().positive(),
    outputTokens: z.number().int().nonnegative(),
    maxOutputTokens: z.number().int().positive(),
  }),
)

function promptRegistryOrDefault(registry?: PromptRegistry): PromptRegistry {
  return registry ?? createPromptRegistry()
}

export function registerPlannerPrompt(registry: PromptRegistry, template: string): void {
  registry.register({
    id: PLANNER_PROMPT_ID,
    version: PLANNER_PROMPT_VERSION,
    template,
    description: "Strict Team DAG planner prompt",
    inputSchema: z.string().min(1),
    outputSchema: TaskPlanSchema,
    changeNote: "Initial versioned structured planner contract",
  })
}

export async function loadPlannerPrompt(): Promise<string> {
  return Bun.file(new URL("./prompts/planner.txt", import.meta.url)).text()
}

function plannerPromptInput(requirements: TaskRequirements): string {
  return JSON.stringify({
    objective: requirements.objective,
    requirements: requirements.requirements,
    ambiguities: requirements.ambiguities,
    frozenConstraints: requirements.frozenConstraints,
  })
}

function normalizeUsage(usage: { inputTokens?: number; outputTokens?: number } | undefined): PlannerUsage {
  const inputTokens = usage?.inputTokens ?? 0
  const outputTokens = usage?.outputTokens ?? 0
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
}

export async function planTask(input: TaskPlannerInput): Promise<TaskPlannerResult> {
  const budget = {
    maxOutputTokens: input.budget?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    maxTotalTokens: input.budget?.maxTotalTokens ?? DEFAULT_MAX_TOTAL_TOKENS,
  }
  const registry = promptRegistryOrDefault(input.promptRegistry)
  let prompt = ""
  try {
    prompt = (await loadPlannerPrompt()).trim()
    registerPlannerPrompt(registry, prompt)
  } catch (error) {
    throw new Error(`planner prompt registration failed: ${String(error)}`)
  }

  const result = await generateObject({
    model: input.model,
    schema: TaskPlanSchema,
    system: registry.get(PLANNER_PROMPT_ID, PLANNER_PROMPT_VERSION).template,
    prompt: registry.validateInput(PLANNER_PROMPT_ID, PLANNER_PROMPT_VERSION, plannerPromptInput(input.requirements)),
    maxOutputTokens: budget.maxOutputTokens,
    abortSignal: input.signal,
  })
  const usage = normalizeUsage(result.usage)
  if (usage.outputTokens > budget.maxOutputTokens || usage.totalTokens > budget.maxTotalTokens) {
    throw new TaskPlannerBudgetExceededError({
      totalTokens: usage.totalTokens,
      maxTotalTokens: budget.maxTotalTokens,
      outputTokens: usage.outputTokens,
      maxOutputTokens: budget.maxOutputTokens,
    })
  }
  const plan = TaskPlanSchema.parse(result.object)
  return { plan, usage, promptId: PLANNER_PROMPT_ID, promptVersion: PLANNER_PROMPT_VERSION }
}
