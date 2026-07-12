import { Effect } from "effect"
import { generateObject } from "ai"
import z from "zod"
import { Provider } from "../provider/provider"
import type { ProviderID, ModelID } from "../provider/schema"
import { Collective } from "./types"
import { Metrics } from "./metrics"
import { Log } from "../util/log"

import PROMPT_SYNTHESIS from "./prompts/synthesis.txt"

export namespace SynthesisJudge {
  const log = Log.create({ service: "synthesis-judge" })

  const SynthesisSchema = z.object({
    synthesis: z.string().describe("Structured markdown synthesis report"),
    claimAdjustments: z.array(
      z.object({
        claimId: z.string(),
        newConfidence: z.number().min(0).max(1).optional(),
        contradicts: z.array(z.string()).optional(),
        note: z.string().optional(),
      }),
    ),
    unresolvedConflicts: z.array(
      z.object({
        topic: z.string(),
        positions: z.record(z.string(), z.string()),
      }),
    ),
    fragility: z.number().min(0).max(1),
    haltingAnalysis: z.string().optional(),
  })

  export const synthesize = Effect.fn("SynthesisJudge.synthesize")(function* (input: {
    question: string
    claims: Collective.Claim[]
    participants: Collective.Participant[]
    judgeProviderID: ProviderID
    judgeModelID: ModelID
    tier: Collective.DebateTier
    initialDisagreements?: number
    convergenceResults?: Collective.ConvergenceResponse[]
  }) {
    const blindSpots = input.claims.filter((c) => c.noveltyMarker === "unique")

    log.info("synthesizing", {
      claimCount: input.claims.length,
      blindSpotCount: blindSpots.length,
      judge: `${input.judgeProviderID}/${input.judgeModelID}`,
    })

    const model = yield* Effect.promise(() =>
      Provider.getLanguageByID(input.judgeProviderID, input.judgeModelID),
    )

    const result = yield* Effect.tryPromise({
      try: () =>
        generateObject({
          model,
          schema: SynthesisSchema,
          system: PROMPT_SYNTHESIS,
          prompt: buildJudgePrompt(input),
          temperature: 0.3,
        }),
      catch: (e) => new Error(`Synthesis failed: ${e}`),
    })

    // Apply cross-validation adjustments
    const adjustedClaims = applyCrossValidation(input.claims, result.object.claimAdjustments)

    // Re-attribute claims from anonymous hashes to real providers
    const reattributedClaims = reattribute(adjustedClaims, input.participants)

    // Build traceability
    const traceability = buildTraceability(reattributedClaims, input.participants)

    // Compute meta
    const unresolvedCount = result.object.unresolvedConflicts.length
    const fragility = result.object.fragility
    const diversityScore = Metrics.computeDiversityScore(reattributedClaims)
    const _tierCfg = Collective.TIER_CONFIG[input.tier]

    const meta: Collective.ReportMeta = {
      fragility,
      haltingAnalysis: result.object.haltingAnalysis,
      diversityScore,
    }

    // Format markdown report
    const markdown = formatReport({
      question: input.question,
      synthesis: result.object.synthesis,
      claims: reattributedClaims,
      blindSpots: reattributedClaims.filter((c) => c.noveltyMarker === "unique"),
      participants: input.participants,
      unresolvedConflicts: result.object.unresolvedConflicts,
      meta,
      fragile: fragility > 0.6,
    })

    const tokenUsage = {
      input: result.usage?.inputTokens ?? 0,
      output: result.usage?.outputTokens ?? 0,
    }

    log.info("synthesis complete", {
      adjustedClaims: reattributedClaims.length,
      unresolvedConflicts: unresolvedCount,
      fragility,
    })

    return {
      synthesis: result.object.synthesis,
      markdown,
      adjustedClaims: reattributedClaims,
      unresolvedConflicts: result.object.unresolvedConflicts,
      traceability,
      meta,
      tokenUsage,
    }
  })

  function applyCrossValidation(
    claims: Collective.Claim[],
    adjustments: z.infer<typeof SynthesisSchema>["claimAdjustments"],
  ): Collective.Claim[] {
    const adjustmentMap = new Map(adjustments.map((a) => [a.claimId, a]))
    return claims.map((claim) => {
      const adj = adjustmentMap.get(claim.claimId)
      if (!adj) return claim
      return {
        ...claim,
        confidenceSelf: adj.newConfidence ?? claim.confidenceSelf,
        contradictedBy: adj.contradicts ?? claim.contradictedBy,
      }
    })
  }

  function reattribute(
    claims: Collective.Claim[],
    participants: Collective.Participant[],
  ): Collective.Claim[] {
    const hashToProvider = new Map(
      participants.map((p) => [p.anonymousHash, `${p.providerID}/${p.modelID}`]),
    )
    return claims.map((claim) => ({
      ...claim,
      sourceProvider: hashToProvider.get(claim.sourceId) ?? claim.sourceProvider,
    }))
  }

  function buildTraceability(
    claims: Collective.Claim[],
    _participants: Collective.Participant[],
  ): Collective.Traceability[] {
    const providerClaims = new Map<string, string[]>()
    for (const claim of claims) {
      const provider = claim.sourceProvider
      if (!providerClaims.has(provider)) providerClaims.set(provider, [])
      providerClaims.get(provider)!.push(claim.claimId)
    }
    return Array.from(providerClaims.entries()).map(([provider, claimIds]) => ({
      provider,
      claimIds,
    }))
  }

  function formatReport(input: {
    question: string
    synthesis: string
    claims: Collective.Claim[]
    blindSpots: Collective.Claim[]
    participants: Collective.Participant[]
    unresolvedConflicts: Collective.UnresolvedConflict[]
    meta: Collective.ReportMeta
    fragile: boolean
  }): string {
    const s: string[] = []

    s.push(`# Collective Intelligence Report\n`)
    if (input.fragile) s.push(`> ⚠️ **[CONSENSUS FRAGILE]** Fragility: ${(input.meta.fragility * 100).toFixed(0)}%\n`)
    s.push(`## Question\n${input.question}\n`)
    s.push(`## Participants (${input.participants.length} models)\n`)

    for (const p of input.participants) {
      s.push(`- **${p.providerID}/${p.modelID}**${p.role ? ` — ${p.role}` : ""}`)
    }
    s.push("")

    s.push(`## Synthesis\n${input.synthesis}\n`)

    if (input.blindSpots.length > 0) {
      s.push(`## 🔍 Blind Spots (${input.blindSpots.length})\n_Insights identified by only one model:_\n`)
      for (const bs of input.blindSpots) {
        const conf = bs.confidenceSelf < 0.7 ? ` _(conf: ${(bs.confidenceSelf * 100).toFixed(0)}%)_` : ""
        const jargon = bs.jargonRisk && bs.jargonRisk > 0.5 ? " ⚠️ UNVERIFIED" : ""
        s.push(`- **[${bs.category}]** ${bs.content}${conf}${jargon}`)
        if (bs.verificationHint) s.push(`  _Verify: ${bs.verificationHint}_`)
      }
      s.push("")
    }

    if (input.unresolvedConflicts.length > 0) {
      s.push(`## ⚡ Unresolved Conflicts (${input.unresolvedConflicts.length})\n`)
      for (const c of input.unresolvedConflicts) {
        s.push(`### ${c.topic}`)
        for (const [source, position] of Object.entries(c.positions)) {
          s.push(`- **${source}**: ${position}`)
        }
        s.push("")
      }
    }

    const categories = [...new Set(input.claims.map((c) => c.category))]
    s.push(`## All Claims (${input.claims.length})\n`)

    for (const cat of categories) {
      const catClaims = input.claims.filter((c) => c.category === cat)
      s.push(`### ${cat} (${catClaims.length})`)
      for (const claim of catClaims) {
        const markers: string[] = []
        if (claim.noveltyMarker === "unique") markers.push("BLIND SPOT")
        if (claim.noveltyMarker === "minority") markers.push("MINORITY")
        if (claim.contradictedBy.length > 0) markers.push("CONTESTED")
        if (claim.supportedBy.length > 1) markers.push(`${claim.supportedBy.length} agree`)
        if (claim.isRecovered) markers.push("RECOVERED")
        if (claim.jargonRisk && claim.jargonRisk > 0.5) markers.push("UNVERIFIED")

        const suffix = markers.length > 0 ? ` [${markers.join(" | ")}]` : ""
        const actionable = claim.isActionable ? " ✅" : ""
        s.push(`- ${claim.content}${suffix}${actionable}`)
      }
      s.push("")
    }

    s.push(`## Meta`)
    s.push(`- Fragility: ${(input.meta.fragility * 100).toFixed(0)}%`)
    if (input.meta.diversityScore !== undefined) {
      s.push(`- Diversity: ${(input.meta.diversityScore * 100).toFixed(0)}%`)
    }
    s.push("")

    return s.join("\n")
  }

  function buildJudgePrompt(input: {
    question: string
    claims: Collective.Claim[]
    convergenceResults?: Collective.ConvergenceResponse[]
  }): string {
    const parts: string[] = [
      `## Original Question\n${input.question}\n`,
      `## Extracted Claims (${input.claims.length})\n`,
    ]

    for (const claim of input.claims) {
      const markers = []
      if (claim.noveltyMarker === "unique") markers.push("BLIND SPOT")
      if (claim.noveltyMarker === "minority") markers.push("MINORITY")
      if (claim.supportedBy.length > 1) markers.push(`${claim.supportedBy.length} models`)
      const prefix = markers.length > 0 ? `[${markers.join(", ")}] ` : ""

      parts.push(
        `- [${claim.claimId}] ${prefix}**${claim.category}** (conf: ${claim.confidenceSelf}): ${claim.content}`,
      )
    }

    if (input.convergenceResults && input.convergenceResults.length > 0) {
      parts.push(`\n## Phase 3 Convergence Critiques\n`)
      for (const cr of input.convergenceResults) {
        for (const c of cr.critiques) {
          parts.push(`- [${c.claimId}] ${c.verdict}: ${c.argument}`)
        }
      }
    }

    parts.push(
      "\nProduce synthesis, cross-validate claims, identify unresolved conflicts, and compute fragility.",
    )

    return parts.join("\n")
  }
}
