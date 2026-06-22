import { Effect } from "effect"
import { generateObject } from "ai"
import z from "zod"
import { Provider } from "../provider/provider"
import type { ProviderID, ModelID } from "../provider/schema"
import { Collective } from "./types"
import { DebateStore } from "./debate-store"
import { Log } from "../util/log"

export namespace TierClassifier {
  const log = Log.create({ service: "tier-classifier" })

  const ClassificationSchema = z.object({
    complexity: z.number().min(1).max(10).describe("How technically complex is this question (1=trivial, 10=expert-level)"),
    stakes: z.number().min(1).max(10).describe("How high are the stakes of getting this wrong (1=cosmetic, 10=security/data-loss)"),
    controversyPotential: z.number().min(1).max(10).describe("How likely are different experts to disagree (1=consensus, 10=holy war)"),
    reasoning: z.string().describe("One sentence explaining the classification"),
  })

  export type Classification = z.infer<typeof ClassificationSchema>

  export type TierRecommendation = {
    tier: Collective.DebateTier
    classification: Classification
    score: number
    reason: string
    historical?: {
      pastDebateCount: number
      avgBlindSpots: number
    }
  }

  const TIER_THRESHOLDS: Array<{ tier: Collective.DebateTier; minScore: number }> = [
    { tier: "deep", minScore: 20 },
    { tier: "standard", minScore: 12 },
    { tier: "quick", minScore: 5 },
    { tier: "free", minScore: 0 },
  ]

  export const classify = Effect.fn("TierClassifier.classify")(function* (
    question: string,
    context: string | undefined,
    classifierProviderID: ProviderID,
    classifierModelID: ModelID,
    directory?: string,
  ) {
    log.info("classifying question for tier recommendation")

    const model = yield* Effect.promise(() =>
      Provider.getLanguage({
        providerID: classifierProviderID,
        id: classifierModelID,
      } as Provider.Model),
    )

    const result = yield* Effect.tryPromise({
      try: () =>
        generateObject({
          model,
          schema: ClassificationSchema,
          system: CLASSIFIER_SYSTEM_PROMPT,
          prompt: buildClassifierPrompt(question, context),
          temperature: 0.2,
        }),
      catch: (e) => new Error(`Tier classification failed: ${e}`),
    })

    const classification = result.object
    const score = classification.complexity + classification.stakes + classification.controversyPotential

    let historical: TierRecommendation["historical"] | undefined
    if (directory) {
      historical = yield* getHistoricalSignal(question, directory)
    }

    let adjustedScore = score
    if (historical && historical.avgBlindSpots > 3) {
      adjustedScore += 3
      log.info("score boosted by historical blind spots", { avgBlindSpots: historical.avgBlindSpots })
    }

    const tier = TIER_THRESHOLDS.find((t) => adjustedScore >= t.minScore)?.tier ?? "quick"

    const recommendation: TierRecommendation = {
      tier,
      classification,
      score: adjustedScore,
      reason: `${classification.reasoning} (score=${adjustedScore}: complexity=${classification.complexity}, stakes=${classification.stakes}, controversy=${classification.controversyPotential})`,
      historical,
    }

    log.info("tier classified", {
      tier,
      score: adjustedScore,
      complexity: classification.complexity,
      stakes: classification.stakes,
      controversy: classification.controversyPotential,
    })

    return recommendation
  })

  export function classifyHeuristic(question: string): TierRecommendation {
    const lower = question.toLowerCase()
    let complexity = 3
    let stakes = 3
    let controversyPotential = 3

    if (/secur|auth|encrypt|vuln|cve|inject|xss|csrf/i.test(lower)) stakes += 3
    if (/migrat|schema|databas|persist|backup/i.test(lower)) stakes += 2
    if (/money|payment|billing|financial/i.test(lower)) stakes += 3
    if (/architect|design.*pattern|microservice|monolith/i.test(lower)) controversyPotential += 3
    if (/framework|library|language.*choice|vs\b/i.test(lower)) controversyPotential += 2
    if (/concurrent|parallel|thread|lock|deadlock|race/i.test(lower)) complexity += 3
    if (/distribut|consensus|raft|paxos|crdt/i.test(lower)) complexity += 3
    if (/performance|optimi|latency|throughput/i.test(lower)) complexity += 2
    if (question.length > 500) complexity += 1
    if (question.split("\n").length > 10) complexity += 1

    complexity = Math.min(10, complexity)
    stakes = Math.min(10, stakes)
    controversyPotential = Math.min(10, controversyPotential)

    const score = complexity + stakes + controversyPotential
    const tier = TIER_THRESHOLDS.find((t) => score >= t.minScore)?.tier ?? "quick"

    return {
      tier,
      classification: {
        complexity,
        stakes,
        controversyPotential,
        reasoning: "Heuristic classification based on keyword analysis",
      },
      score,
      reason: `Heuristic (score=${score}: c=${complexity}, s=${stakes}, cp=${controversyPotential})`,
    }
  }

  function getHistoricalSignal(
    question: string,
    directory: string,
  ): Effect.Effect<TierRecommendation["historical"]> {
    return Effect.tryPromise({
      try: async () => {
        const pastDebates = await DebateStore.queryPastDebatesPromise(question, directory, 5)
        if (pastDebates.length === 0) return undefined

        const blindSpotCounts = pastDebates
          .filter((d) => d.blind_spot_count != null)
          .map((d) => d.blind_spot_count!)

        const avgBlindSpots =
          blindSpotCounts.length > 0
            ? blindSpotCounts.reduce((sum, n) => sum + n, 0) / blindSpotCounts.length
            : 0

        return {
          pastDebateCount: pastDebates.length,
          avgBlindSpots,
        }
      },
      catch: (e) => e as Error,
    }).pipe(Effect.orElseSucceed(() => undefined))
  }

  const CLASSIFIER_SYSTEM_PROMPT = `You are a question classifier for a collective intelligence system. Your job is to assess questions along three dimensions to determine the appropriate depth of multi-model analysis.

DIMENSIONS:
1. **Complexity** (1-10): How technically deep is this question?
   - 1-3: Simple factual question, straightforward answer
   - 4-6: Requires domain knowledge, multiple considerations
   - 7-10: Expert-level, involves trade-offs, edge cases, cross-domain knowledge

2. **Stakes** (1-10): What's the cost of getting the answer wrong?
   - 1-3: Cosmetic, easily reversible (naming, formatting)
   - 4-6: Moderate impact (refactoring, test coverage)
   - 7-10: Critical (security, data integrity, financial, production stability)

3. **Controversy Potential** (1-10): How likely are different experts to disagree?
   - 1-3: Clear consensus exists (best practices, standards)
   - 4-6: Some room for opinion (design patterns, tooling choices)
   - 7-10: Holy war territory (architecture decisions, language choices, trade-off heavy)

Be calibrated: most questions are 3-6 on each dimension. Reserve 8+ for genuinely extreme cases.`

  function buildClassifierPrompt(question: string, context?: string): string {
    const parts = [`## Question\n${question}`]
    if (context) parts.push(`\n## Context\n${context}`)
    parts.push("\nClassify this question.")
    return parts.join("\n")
  }
}
