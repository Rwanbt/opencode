import { Effect } from "effect"
import { generateObject } from "ai"
import z from "zod"
import { Provider } from "../provider/provider"
import type { ProviderID, ModelID } from "../provider/schema"
import { Collective } from "./types"
import { Log } from "../util/log"

import PROMPT_RED_TEAM from "./prompts/red-team.txt"

export namespace RedTeam {
  const log = Log.create({ service: "red-team" })

  export const AttackSchema = z.object({
    attacks: z.array(
      z.object({
        targetClaimId: z.string().describe("Claim ID being attacked, or 'GAP' for missing perspectives"),
        attackType: z.enum(["bias", "gap", "assumption", "stress_test", "correlation"]),
        argument: z.string(),
        severity: z.enum(["critical", "moderate", "minor"]),
        suggestedResolution: z.string(),
      }),
    ),
  })
  export type Attack = z.infer<typeof AttackSchema>["attacks"][number]

  export function shouldActivate(
    tier: Collective.DebateTier,
    redTeamConfig: "off" | "auto" | "always",
    consensusRatio: number,
  ): boolean {
    if (redTeamConfig === "off") return false
    if (redTeamConfig === "always") return true

    const tierCfg = Collective.TIER_CONFIG[tier]
    if (tierCfg.redTeam === "off") return false
    return consensusRatio >= tierCfg.cosineSimilarityThreshold
  }

  export function computeConsensusRatio(claims: Collective.Claim[]): number {
    if (claims.length === 0) return 0
    const consensusCount = claims.filter((c) => c.noveltyMarker === "consensus").length
    return consensusCount / claims.length
  }

  export const run = Effect.fn("RedTeam.run")(function* (input: {
    claims: Collective.Claim[]
    synthesis: string
    attackerProviderID: ProviderID
    attackerModelID: ModelID
  }) {
    log.info("red team activated", {
      claimCount: input.claims.length,
      attacker: `${input.attackerProviderID}/${input.attackerModelID}`,
    })

    const catalogModel = yield* Effect.promise(() =>
      Provider.getModel(input.attackerProviderID, input.attackerModelID),
    )
    const model = yield* Effect.promise(() => Provider.getLanguage(catalogModel))

    const claimsText = input.claims
      .map((c) => `[${c.claimId}] [${c.noveltyMarker}] [${c.category}] ${c.content}`)
      .join("\n")

    const result = yield* Effect.tryPromise({
      try: () =>
        generateObject({
          model,
          schema: AttackSchema,
          system: PROMPT_RED_TEAM,
          prompt: `## Claims\n${claimsText}\n\n## Synthesis\n${input.synthesis}`,
          temperature: catalogModel.capabilities.temperature ? 0.7 : undefined,
        }),
      catch: (e) => new Error(`Red team failed: ${e}`),
    })

    const attacks = result.object.attacks
    const critical = attacks.filter((a) => a.severity === "critical")

    log.info("red team complete", {
      totalAttacks: attacks.length,
      critical: critical.length,
    })

    return {
      attacks,
      tokenUsage: {
        input: result.usage?.inputTokens ?? 0,
        output: result.usage?.outputTokens ?? 0,
      },
    }
  })
}
