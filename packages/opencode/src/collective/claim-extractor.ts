import { Effect } from "effect"
import { generateObject } from "ai"
import z from "zod"
import { Provider } from "../provider/provider"
import type { ProviderID, ModelID } from "../provider/schema"
import { Collective } from "./types"
import { Log } from "../util/log"

import PROMPT_EXTRACTOR from "./prompts/extractor.txt"
import PROMPT_EXHAUSTIVITY from "./prompts/exhaustivity.txt"

export namespace ClaimExtractor {
  const log = Log.create({ service: "claim-extractor" })

  const EXHAUSTIVITY_THRESHOLD = 0.95

  const ExtractedClaimsSchema = z.object({
    claims: z.array(
      z.object({
        text: z.string(),
        category: Collective.ClaimCategory,
        confidence: z.number().min(0).max(1),
        evidence: z.string().optional(),
        isOutOfRole: z.boolean(),
        isActionable: z.boolean(),
        isExistenceClaim: z.boolean().optional(),
        verificationHint: z.string().optional(),
      }),
    ),
  })

  const ExhaustivityCheckSchema = z.object({
    missedClaims: z.array(
      z.object({
        text: z.string(),
        category: Collective.ClaimCategory,
        sourceHash: z.string(),
        confidence: z.number().min(0).max(1),
      }),
    ),
    coveragePercent: z.number().min(0).max(100),
    isExhaustive: z.boolean(),
  })

  export const extract = Effect.fn("ClaimExtractor.extract")(function* (
    responses: Collective.PhaseOneResponse[],
    question: string,
    extractorProviderID: ProviderID,
    extractorModelID: ModelID,
  ) {
    log.info("extracting claims", { responseCount: responses.length })

    const anonymizedResponses = responses.map((r, i) => ({
      index: i,
      hash: r.participantHash,
      content: r.content,
      outOfRoleInsights: r.outOfRoleInsights,
    }))

    const model = yield* Effect.promise(() =>
      Provider.getLanguage({
        providerID: extractorProviderID,
        id: extractorModelID,
      } as Provider.Model),
    )

    // Phase 2a — Extraction
    let rawClaims = yield* extractClaims(model, question, anonymizedResponses)

    // Phase 2b — Exhaustivity check with re-extraction loop
    let attempts = 0
    const maxAttempts = 2
    while (attempts < maxAttempts) {
      const check = yield* checkExhaustivity(model, question, anonymizedResponses, rawClaims)

      if (check.coveragePercent >= EXHAUSTIVITY_THRESHOLD * 100 || check.missedClaims.length === 0) {
        break
      }

      log.info("exhaustivity gap detected", {
        coverage: check.coveragePercent,
        missed: check.missedClaims.length,
        attempt: attempts + 1,
      })

      const recoveredClaims = check.missedClaims.map((m) => ({
        text: m.text,
        category: m.category,
        confidence: m.confidence,
        evidence: undefined as string | undefined,
        isOutOfRole: false,
        isActionable: false,
        isExistenceClaim: false,
        verificationHint: undefined as string | undefined,
        isRecovered: true,
      }))

      rawClaims = [...rawClaims, ...recoveredClaims]
      attempts++
    }

    // Phase 2d — Build claims with anonymized attribution
    const claims = buildClaimsWithAttribution(rawClaims, anonymizedResponses)

    // Phase 2e — Novelty classification
    classifyNovelty(claims, anonymizedResponses)

    const totalTokens = {
      input: 0,
      output: 0,
    }

    log.info("extraction complete", {
      totalClaims: claims.length,
      unique: claims.filter((c) => c.noveltyMarker === "unique").length,
      minority: claims.filter((c) => c.noveltyMarker === "minority").length,
      consensus: claims.filter((c) => c.noveltyMarker === "consensus").length,
    })

    return { claims, tokenUsage: totalTokens }
  })

  function extractClaims(
    model: any,
    question: string,
    responses: Array<{ index: number; hash: string; content: string; outOfRoleInsights: string[] }>,
  ) {
    return Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: () =>
          generateObject({
            model,
            schema: ExtractedClaimsSchema,
            system: PROMPT_EXTRACTOR,
            prompt: buildExtractionPrompt(question, responses),
            temperature: 0.1,
          }),
        catch: (e) => new Error(`Claim extraction failed: ${e}`),
      })
      return result.object.claims.map((c) => ({ ...c, isRecovered: false }))
    })
  }

  function checkExhaustivity(
    model: any,
    question: string,
    responses: Array<{ index: number; hash: string; content: string }>,
    extractedClaims: Array<{ text: string }>,
  ) {
    return Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: () =>
          generateObject({
            model,
            schema: ExhaustivityCheckSchema,
            system: PROMPT_EXHAUSTIVITY,
            prompt: buildExhaustivityPrompt(question, responses, extractedClaims),
            temperature: 0.1,
          }),
        catch: (e) => new Error(`Exhaustivity check failed: ${e}`),
      })
      return result.object
    })
  }

  function buildClaimsWithAttribution(
    rawClaims: Array<{
      text: string
      category: Collective.ClaimCategory
      confidence: number
      evidence?: string
      isOutOfRole: boolean
      isActionable: boolean
      isExistenceClaim?: boolean
      verificationHint?: string
      isRecovered?: boolean
    }>,
    responses: Array<{ hash: string; content: string }>,
  ): Collective.Claim[] {
    return rawClaims.map((raw) => {
      const normalizedClaim = raw.text.toLowerCase().slice(0, 40)
      const supporting = responses
        .filter((r) => r.content.toLowerCase().includes(normalizedClaim))
        .map((r) => r.hash)

      return {
        claimId: Collective.ClaimID.make(),
        sourceId: supporting[0] ?? "unknown",
        sourceProvider: "anonymous",
        category: raw.isOutOfRole ? ("out_of_role" as const) : raw.category,
        content: raw.text,
        evidenceRefs: raw.evidence ? [raw.evidence] : undefined,
        confidenceSelf: raw.confidence,
        noveltyMarker: "unique" as Collective.NoveltyMarker,
        isActionable: raw.isActionable,
        verificationHint: raw.verificationHint,
        isExistenceClaim: raw.isExistenceClaim,
        isRecovered: raw.isRecovered,
        supportedBy: supporting,
        contradictedBy: [],
      }
    })
  }

  function classifyNovelty(
    claims: Collective.Claim[],
    responses: Array<{ hash: string }>,
  ): void {
    const totalResponders = responses.length
    const majorityThreshold = Math.ceil(totalResponders / 2)

    for (const claim of claims) {
      const supportCount = claim.supportedBy.length
      if (supportCount >= majorityThreshold) {
        ;(claim as any).noveltyMarker = "consensus"
      } else if (supportCount >= 2) {
        ;(claim as any).noveltyMarker = "minority"
      } else {
        ;(claim as any).noveltyMarker = "unique"
      }
    }
  }

  function buildExtractionPrompt(
    question: string,
    responses: Array<{ index: number; hash: string; content: string; outOfRoleInsights: string[] }>,
  ): string {
    const parts = [
      `## Question\n${question}\n`,
      `## Responses (${responses.length} models, anonymized)\n`,
    ]

    for (const r of responses) {
      parts.push(`### Response [${r.hash.slice(0, 8)}]\n${r.content}\n`)
      if (r.outOfRoleInsights.length > 0) {
        parts.push(`Out-of-role insights:\n${r.outOfRoleInsights.map((i) => `- ${i}`).join("\n")}\n`)
      }
    }

    parts.push("\nExtract ALL atomic claims from these responses.")
    return parts.join("\n")
  }

  function buildExhaustivityPrompt(
    question: string,
    responses: Array<{ index: number; hash: string; content: string }>,
    extractedClaims: Array<{ text: string }>,
  ): string {
    const parts = [
      `## Question\n${question}\n`,
      `## Original Responses\n`,
    ]

    for (const r of responses) {
      parts.push(`### [${r.hash.slice(0, 8)}]\n${r.content}\n`)
    }

    parts.push(`## Already Extracted Claims (${extractedClaims.length})\n`)
    for (const c of extractedClaims) {
      parts.push(`- ${c.text}`)
    }

    parts.push("\nReport any claims NOT covered. Include the source hash for each missed claim.")
    return parts.join("\n")
  }
}
