import { Effect } from "effect"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import { Collective } from "./types"
import { Log } from "../util/log"

export namespace BudgetTracker {
  const log = Log.create({ service: "budget-tracker" })

  export const BudgetExceededError = NamedError.create(
    "BudgetExceededError",
    z.object({
      tokensUsed: z.number(),
      tokenLimit: z.number(),
      costUsd: z.number(),
      costLimit: z.number(),
    }),
  )

  export function tierDefaults(tier: Collective.DebateTier): Collective.BudgetConfig {
    const cfg = Collective.TIER_CONFIG[tier]
    return {
      maxTotalTokens: cfg.budgetDefaults.maxTotalTokens,
      maxCostUsd: cfg.budgetDefaults.maxCostUsd,
      warnAtPercent: 80,
    }
  }

  export function unlimited(): Collective.BudgetConfig {
    return {
      maxTotalTokens: Number.MAX_SAFE_INTEGER,
      maxCostUsd: Number.MAX_SAFE_INTEGER,
      warnAtPercent: 80,
    }
  }

  export function estimate(
    config: Collective.DebateConfig,
    participants: Array<{ providerID: string; modelID: string; cost?: { input: number; output: number } }>,
  ): Collective.BudgetEstimate {
    const questionTokens = Math.ceil(config.question.length / 4)
    const contextTokens = config.context ? Math.ceil(config.context.length / 4) : 0
    const inputPerModel = questionTokens + contextTokens + 500
    const tierCfg = Collective.TIER_CONFIG[config.tier]

    const breakdown: Collective.BudgetEstimate["breakdown"] = []
    let totalTokens = 0
    let totalCost = 0

    for (const p of participants) {
      const cost = p.cost ?? getDefaultCost(p.modelID)
      const outputTokens = 2000
      const phaseTokens = inputPerModel + outputTokens
      const phaseCost = (inputPerModel * cost.input + outputTokens * cost.output) / 1_000_000

      breakdown.push({
        phase: "phase1_diverge",
        providerID: p.providerID as any,
        modelID: p.modelID as any,
        inputTokens: inputPerModel,
        outputTokens,
        costUsd: phaseCost,
      })
      totalTokens += phaseTokens
      totalCost += phaseCost
    }

    if (tierCfg.phases.includes("phase2_extract")) {
      const extractionInput = participants.length * 2000 + 1000
      const extractionOutput = 3000
      const cheapCost = getCheapestModelCost(participants)
      const extractCostUsd =
        (extractionInput * cheapCost.input + extractionOutput * cheapCost.output) / 1_000_000

      breakdown.push({
        phase: "phase2_extract",
        providerID: "extractor" as any,
        modelID: "cheap" as any,
        inputTokens: extractionInput,
        outputTokens: extractionOutput,
        costUsd: extractCostUsd,
      })
      totalTokens += extractionInput + extractionOutput
      totalCost += extractCostUsd
    }

    if (tierCfg.phases.includes("phase3_converge")) {
      const convergenceRounds = tierCfg.maxConvergenceRounds
      const claimsPerRound = 15
      const inputPerRound = claimsPerRound * 200 + 500
      const outputPerRound = claimsPerRound * 150
      const avgCost = getAverageCost(participants)

      for (let r = 0; r < convergenceRounds; r++) {
        const roundTokens = (inputPerRound + outputPerRound) * participants.length
        const roundCost =
          (inputPerRound * avgCost.input + outputPerRound * avgCost.output) * participants.length / 1_000_000

        breakdown.push({
          phase: `phase3_converge_r${r + 1}`,
          providerID: "all" as any,
          modelID: "all" as any,
          inputTokens: inputPerRound * participants.length,
          outputTokens: outputPerRound * participants.length,
          costUsd: roundCost,
        })
        totalTokens += roundTokens
        totalCost += roundCost
      }
    }

    const synthesisInput = 4000 + participants.length * 500
    const synthesisOutput = 5000
    const synthCost = getDefaultCost("")
    const synthCostUsd =
      (synthesisInput * synthCost.input + synthesisOutput * synthCost.output) / 1_000_000

    breakdown.push({
      phase: "phase4_synthesize",
      providerID: "judge" as any,
      modelID: "judge" as any,
      inputTokens: synthesisInput,
      outputTokens: synthesisOutput,
      costUsd: synthCostUsd,
    })
    totalTokens += synthesisInput + synthesisOutput
    totalCost += synthCostUsd

    return {
      estimatedTokens: totalTokens,
      estimatedCostUsd: Math.round(totalCost * 10000) / 10000,
      breakdown,
    }
  }

  export interface Tracker {
    readonly record: (
      phase: string,
      providerID: string,
      inputTokens: number,
      outputTokens: number,
      modelCost?: { input: number; output: number },
    ) => void
    readonly check: () => Effect.Effect<void, InstanceType<typeof BudgetExceededError>>
    readonly checkWarn: (debateID: Collective.DebateID) => { warn: boolean; percent: number }
    readonly snapshot: () => {
      tokensUsed: number
      costUsd: number
      percentUsed: number
      byPhase: Record<string, number>
      byProvider: Record<string, number>
    }
  }

  export function create(budget: Collective.BudgetConfig): Tracker {
    let tokensUsed = 0
    let costUsd = 0
    const byPhase: Record<string, number> = {}
    const byProvider: Record<string, number> = {}

    return {
      record(phase, providerID, inputTokens, outputTokens, modelCost) {
        const cost = modelCost ?? getDefaultCost("")
        const tokens = inputTokens + outputTokens
        tokensUsed += tokens
        costUsd += (inputTokens * cost.input + outputTokens * cost.output) / 1_000_000
        byPhase[phase] = (byPhase[phase] ?? 0) + tokens
        byProvider[providerID] = (byProvider[providerID] ?? 0) + tokens
        log.info("budget update", { tokensUsed, costUsd: costUsd.toFixed(4), phase, providerID })
      },

      check() {
        return Effect.gen(function* () {
          if (tokensUsed > budget.maxTotalTokens || costUsd > budget.maxCostUsd) {
            return yield* Effect.fail(
              new BudgetExceededError({
                tokensUsed,
                tokenLimit: budget.maxTotalTokens,
                costUsd,
                costLimit: budget.maxCostUsd,
              }),
            )
          }
        })
      },

      checkWarn(_debateID) {
        const tokenPercent = (tokensUsed / budget.maxTotalTokens) * 100
        const costPercent = (costUsd / budget.maxCostUsd) * 100
        const percent = Math.round(Math.max(tokenPercent, costPercent))
        return { warn: percent >= budget.warnAtPercent, percent }
      },

      snapshot() {
        const tokenPercent = (tokensUsed / budget.maxTotalTokens) * 100
        const costPercent = (costUsd / budget.maxCostUsd) * 100
        return {
          tokensUsed,
          costUsd: Math.round(costUsd * 10000) / 10000,
          percentUsed: Math.round(Math.max(tokenPercent, costPercent)),
          byPhase: { ...byPhase },
          byProvider: { ...byProvider },
        }
      },
    }
  }

  // ── Cost lookup ─────────────────────────────────────────────────────────

  const MODEL_COSTS: Record<string, { input: number; output: number }> = {
    "claude-sonnet-4": { input: 3.0, output: 15.0 },
    "claude-opus-4": { input: 15.0, output: 75.0 },
    "claude-haiku": { input: 0.25, output: 1.25 },
    "gpt-4o": { input: 2.5, output: 10.0 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gpt-4.1": { input: 2.0, output: 8.0 },
    "gpt-4.1-mini": { input: 0.4, output: 1.6 },
    "gpt-4.1-nano": { input: 0.1, output: 0.4 },
    "gemini-2.5-pro": { input: 1.25, output: 10.0 },
    "gemini-2.5-flash": { input: 0.15, output: 0.6 },
    "deepseek-chat": { input: 0.27, output: 1.1 },
    "mistral-large": { input: 2.0, output: 6.0 },
    "llama-3.3-70b": { input: 0.59, output: 0.79 },
  }

  const DEFAULT_COST = { input: 3.0, output: 15.0 }

  function getDefaultCost(modelID: string): { input: number; output: number } {
    for (const [key, cost] of Object.entries(MODEL_COSTS)) {
      if (modelID.includes(key)) return cost
    }
    return DEFAULT_COST
  }

  function getCheapestModelCost(
    participants: Array<{ modelID: string; cost?: { input: number; output: number } }>,
  ): { input: number; output: number } {
    let cheapest = DEFAULT_COST
    let cheapestTotal = cheapest.input + cheapest.output
    for (const p of participants) {
      const cost = p.cost ?? getDefaultCost(p.modelID)
      const total = cost.input + cost.output
      if (total < cheapestTotal) {
        cheapest = cost
        cheapestTotal = total
      }
    }
    return cheapest
  }

  function getAverageCost(
    participants: Array<{ modelID: string; cost?: { input: number; output: number } }>,
  ): { input: number; output: number } {
    if (participants.length === 0) return DEFAULT_COST
    let totalInput = 0
    let totalOutput = 0
    for (const p of participants) {
      const cost = p.cost ?? getDefaultCost(p.modelID)
      totalInput += cost.input
      totalOutput += cost.output
    }
    return {
      input: totalInput / participants.length,
      output: totalOutput / participants.length,
    }
  }
}
