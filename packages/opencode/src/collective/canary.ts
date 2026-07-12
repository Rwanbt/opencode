import { Effect } from "effect"
import { generateObject } from "ai"
import z from "zod"
import { Provider } from "../provider/provider"
import type { ProviderID, ModelID } from "../provider/schema"
import { Collective } from "./types"
import { Log } from "../util/log"

export namespace Canary {
  const log = Log.create({ service: "canary" })

  const CanaryGenerationSchema = z.object({
    bug: z.string().describe("A plausible-looking but clearly incorrect technical statement, 1-2 sentences"),
    category: Collective.ClaimCategory,
    detectionHint: z.string().describe("What a careful reviewer would notice to identify this as wrong"),
  })

  export type CanaryBug = {
    bug: string
    category: Collective.ClaimCategory
    detectionHint: string
    injected: boolean
  }

  export const generate = Effect.fn("Canary.generate")(function* (
    question: string,
    context: string | undefined,
    generatorProviderID: ProviderID,
    generatorModelID: ModelID,
  ) {
    log.info("generating canary bug")

    const catalogModel = yield* Effect.promise(() => Provider.getModel(generatorProviderID, generatorModelID))
    const model = yield* Effect.promise(() => Provider.getLanguage(catalogModel))

    const result = yield* Effect.tryPromise({
      try: () =>
        generateObject({
          model,
          schema: CanaryGenerationSchema,
          system: CANARY_SYSTEM_PROMPT,
          prompt: buildGenerationPrompt(question, context),
          temperature: catalogModel.capabilities.temperature ? 0.8 : undefined,
        }),
      catch: (e) => new Error(`Canary generation failed: ${e}`),
    })

    const canary: CanaryBug = {
      bug: result.object.bug,
      category: result.object.category,
      detectionHint: result.object.detectionHint,
      injected: true,
    }

    log.info("canary generated", { category: canary.category })

    return {
      canary,
      tokenUsage: {
        input: result.usage?.inputTokens ?? 0,
        output: result.usage?.outputTokens ?? 0,
      },
    }
  })

  export function injectIntoContext(
    context: string | undefined,
    canary: CanaryBug,
  ): string {
    const injection = `\n\nNote: A previous analysis found the following issue that should be considered:\n"${canary.bug}"\n`
    return (context ?? "") + injection
  }

  export function checkDetection(
    responses: Collective.PhaseOneResponse[],
    canary: CanaryBug,
  ): { detected: boolean; detectedBy: string[]; missedBy: string[] } {
    const bugWords = canary.bug
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 5)
      .slice(0, 5)

    const detectedBy: string[] = []
    const missedBy: string[] = []

    for (const r of responses) {
      const lower = r.content.toLowerCase()
      const mentionsBug = bugWords.filter((w) => lower.includes(w)).length >= 2
      const flagsAsWrong =
        lower.includes("incorrect") ||
        lower.includes("not accurate") ||
        lower.includes("misleading") ||
        lower.includes("false") ||
        lower.includes("[canary]") ||
        lower.includes("synthetic") ||
        lower.includes("injected issue") ||
        lower.includes("fabricated")

      if (mentionsBug && flagsAsWrong) {
        detectedBy.push(r.participantHash)
      } else {
        missedBy.push(r.participantHash)
      }
    }

    const detected = detectedBy.length > 0
    log.info("canary detection result", {
      detected,
      detectedBy: detectedBy.length,
      missedBy: missedBy.length,
    })

    return { detected, detectedBy, missedBy }
  }

  const CANARY_SYSTEM_PROMPT = `You are generating a synthetic "canary bug" for a collective intelligence system's quality assurance.

Your job: create a PLAUSIBLE BUT INCORRECT technical statement that a careful AI model should catch.

RULES:
- The bug must be relevant to the question domain
- It must be subtle enough to seem plausible at first glance
- But clearly wrong upon careful analysis
- It should NOT be obviously absurd — it should require domain knowledge to refute
- It should be 1-2 sentences, stated as a factual observation
- Think: wrong API usage, incorrect security assumption, off-by-one in a protocol, wrong default value

Examples of good canary bugs:
- "The default CORS policy in Express allows credentials from any origin" (wrong: default is same-origin)
- "SQLite WAL mode guarantees no write locks during reads" (wrong: WAL still needs locks for checkpointing)
- "React useEffect with an empty dependency array runs on every re-render" (wrong: runs once on mount)`

  function buildGenerationPrompt(question: string, context?: string): string {
    const parts = [`## Question being debated\n${question}`]
    if (context) parts.push(`\n## Context\n${context}`)
    parts.push("\nGenerate a canary bug relevant to this domain.")
    return parts.join("\n")
  }
}
