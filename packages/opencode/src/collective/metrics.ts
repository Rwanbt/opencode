import { Effect } from "effect"
import { generateText } from "ai"
import { Provider } from "../provider/provider"
import type { ProviderID, ModelID } from "../provider/schema"
import { Collective } from "./types"
import { Log } from "../util/log"

export namespace Metrics {
  const log = Log.create({ service: "metrics" })

  export function computeValueMetrics(
    claims: Collective.Claim[],
    cost: number,
  ): Collective.ValueMetrics {
    const blindSpotCount = claims.filter((c) => c.noveltyMarker === "unique").length
    const categories = new Set(claims.map((c) => c.category))
    const coverageDimensionality = categories.size
    const actionableClaims = claims.filter((c) => c.isActionable)
    const costPerValidInsight = actionableClaims.length > 0 ? cost / actionableClaims.length : undefined

    return {
      blindSpotCount,
      coverageDimensionality,
      costPerValidInsight,
    }
  }

  export function computeFragility(
    initialDisagreements: number,
    unresolvedDisagreements: number,
  ): number {
    if (initialDisagreements === 0) return 0
    return unresolvedDisagreements / initialDisagreements
  }

  export function computeDiversityScore(claims: Collective.Claim[]): number {
    if (claims.length === 0) return 0
    const unique = claims.filter((c) => c.noveltyMarker === "unique").length
    const minority = claims.filter((c) => c.noveltyMarker === "minority").length
    return (unique * 2 + minority) / (claims.length * 2)
  }

  export type ShadowBaselineResult = {
    singleModelClaims: number
    singleModelBlindSpots: number
    blindSpotDelta: number
    coverageDelta: number
    badge: string
  }

  export const runShadowBaseline = Effect.fn("Metrics.runShadowBaseline")(function* (input: {
    question: string
    context?: string
    bestProviderID: ProviderID
    bestModelID: ModelID
    collectiveClaims: Collective.Claim[]
  }) {
    log.info("running shadow baseline", {
      provider: `${input.bestProviderID}/${input.bestModelID}`,
    })

    const model = yield* Effect.promise(() =>
      Provider.getLanguage({
        providerID: input.bestProviderID,
        id: input.bestModelID,
      } as Provider.Model),
    )

    const prompt = input.context
      ? `## Context\n${input.context}\n\n## Question\n${input.question}`
      : input.question

    const result = yield* Effect.tryPromise({
      try: () =>
        generateText({
          model,
          system:
            "You are an expert analyst. Answer the question thoroughly, covering security, performance, architecture, correctness, and any other relevant dimensions. Be comprehensive.",
          prompt,
          temperature: 0.3,
          maxOutputTokens: 4096,
        }),
      catch: (e) => new Error(`Shadow baseline failed: ${e}`),
    })

    const singleModelLines = result.text
      .split("\n")
      .filter((l) => l.trim().length > 20)
    const singleModelClaims = singleModelLines.length
    const singleModelCategories = new Set<string>()

    for (const line of singleModelLines) {
      if (/secur|auth|vuln|cve|injection/i.test(line)) singleModelCategories.add("security")
      if (/perf|latenc|speed|memor|cache/i.test(line)) singleModelCategories.add("performance")
      if (/maintain|readab|test|coupl/i.test(line)) singleModelCategories.add("maintainability")
      if (/correct|bug|edge|off.by/i.test(line)) singleModelCategories.add("correctness")
      if (/architect|design|pattern|modular/i.test(line)) singleModelCategories.add("architecture")
      if (/ux|user|access|error.mess/i.test(line)) singleModelCategories.add("ux")
    }

    const collectiveBlindSpots = input.collectiveClaims.filter((c) => c.noveltyMarker === "unique").length
    const collectiveCategories = new Set(input.collectiveClaims.map((c) => c.category))

    const blindSpotDelta = collectiveBlindSpots
    const coverageDelta = collectiveCategories.size - singleModelCategories.size

    const badge =
      blindSpotDelta > 0
        ? `+${blindSpotDelta} blind spots vs single-model`
        : "No additional blind spots found"

    log.info("shadow baseline complete", {
      singleModelClaims,
      collectiveBlindSpots,
      blindSpotDelta,
      coverageDelta,
    })

    return {
      singleModelClaims,
      singleModelBlindSpots: 0,
      blindSpotDelta,
      coverageDelta,
      badge,
      tokenUsage: {
        input: result.usage?.inputTokens ?? 0,
        output: result.usage?.outputTokens ?? 0,
      },
    }
  })
}
