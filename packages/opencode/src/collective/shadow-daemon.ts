import { Effect } from "effect"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "../bus"
import z from "zod"
import { Log } from "../util/log"

export namespace ShadowDaemon {
  const log = Log.create({ service: "shadow-daemon" })

  export const DivergenceAlert = BusEvent.define(
    "collective.shadow.divergence",
    z.object({
      sessionID: z.string(),
      question: z.string(),
      severity: z.enum(["info", "warning", "critical"]),
      shadowResponse: z.string(),
      divergenceReason: z.string(),
    }),
  )

  const OLLAMA_DEFAULT_HOST = "http://localhost:11434"

  export type ShadowConfig = {
    enabled: boolean
    ollamaHost?: string
    modelID?: string
    divergenceThreshold?: number
  }

  type ShadowResult = {
    response: string
    hasDivergence: boolean
    divergenceReason?: string
    severity: "info" | "warning" | "critical"
  }

  let runningAbort: AbortController | null = null

  export function isOllamaAvailable(host?: string): Effect.Effect<boolean> {
    return Effect.tryPromise({
      try: async () => {
        const url = `${host ?? OLLAMA_DEFAULT_HOST}/api/tags`
        const resp = await fetch(url, { signal: AbortSignal.timeout(2000) })
        return resp.ok
      },
      catch: (e) => e as Error,
    }).pipe(Effect.orElseSucceed(() => false))
  }

  export function listOllamaModels(host?: string): Effect.Effect<string[]> {
    return Effect.tryPromise({
      try: async () => {
        const url = `${host ?? OLLAMA_DEFAULT_HOST}/api/tags`
        const resp = await fetch(url, { signal: AbortSignal.timeout(3000) })
        if (!resp.ok) return []
        const data = (await resp.json()) as { models?: Array<{ name: string }> }
        return (data.models ?? []).map((m) => m.name)
      },
      catch: (e) => e as Error,
    }).pipe(Effect.orElseSucceed(() => [] as string[]))
  }

  export const analyzeInBackground = Effect.fn("ShadowDaemon.analyzeInBackground")(function* (input: {
    sessionID: string
    question: string
    primaryResponse: string
    config: ShadowConfig
  }) {
    if (!input.config.enabled || runningAbort) return

    const available = yield* isOllamaAvailable(input.config.ollamaHost)
    if (!available) {
      log.info("ollama not available, skipping shadow analysis")
      return
    }

    const abort = new AbortController()
    runningAbort = abort
    try {
      const result = yield* runShadowAnalysis(input)
      if (result.hasDivergence) {
        yield* Effect.promise(() =>
          Bus.publish(DivergenceAlert, {
            sessionID: input.sessionID,
            question: input.question,
            severity: result.severity,
            shadowResponse: result.response.slice(0, 500),
            divergenceReason: result.divergenceReason ?? "Unknown divergence",
          }),
        )
        log.info("shadow divergence detected", {
          severity: result.severity,
          reason: result.divergenceReason,
        })
      }
    } finally {
      if (runningAbort === abort) runningAbort = null
    }
  })

  function runShadowAnalysis(input: {
    question: string
    primaryResponse: string
    config: ShadowConfig
  }): Effect.Effect<ShadowResult, Error> {
    return Effect.gen(function* () {
      const host = input.config.ollamaHost ?? OLLAMA_DEFAULT_HOST
      const modelID = input.config.modelID ?? "llama3.2"

      const shadowResponse = yield* Effect.tryPromise({
        try: async () => {
          const resp = await fetch(`${host}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: modelID,
              prompt: buildShadowPrompt(input.question),
              stream: false,
              options: { temperature: 0.3, num_predict: 2048 },
            }),
            signal: AbortSignal.timeout(60_000),
          })
          if (!resp.ok) throw new Error(`Ollama returned ${resp.status}`)
          const data = (await resp.json()) as { response: string }
          return data.response
        },
        catch: (e) => new Error(`Shadow analysis failed: ${e}`),
      })

      const divergence = yield* detectDivergence(
        input.primaryResponse,
        shadowResponse,
        input.config.divergenceThreshold ?? 0.3,
      )

      return {
        response: shadowResponse,
        ...divergence,
      }
    })
  }

  function detectDivergence(
    primaryResponse: string,
    shadowResponse: string,
    threshold: number,
  ): Effect.Effect<{ hasDivergence: boolean; divergenceReason?: string; severity: "info" | "warning" | "critical" }> {
    return Effect.succeed((() => {
      const primaryKeywords = extractKeywords(primaryResponse)
      const shadowKeywords = extractKeywords(shadowResponse)

      const onlyInShadow = shadowKeywords.filter((k) => !primaryKeywords.includes(k))
      const onlyInPrimary = primaryKeywords.filter((k) => !shadowKeywords.includes(k))

      const totalUnique = new Set([...primaryKeywords, ...shadowKeywords]).size
      const divergenceRatio = totalUnique > 0 ? (onlyInShadow.length + onlyInPrimary.length) / totalUnique : 0

      if (divergenceRatio < threshold) {
        return { hasDivergence: false, severity: "info" as const }
      }

      const securityTerms = ["vulnerability", "injection", "xss", "csrf", "auth", "exploit", "cve"]
      const criticalInShadow = onlyInShadow.filter((k) =>
        securityTerms.some((s) => k.includes(s)),
      )

      if (criticalInShadow.length > 0) {
        return {
          hasDivergence: true,
          divergenceReason: `Shadow model flagged security concerns not in primary: ${criticalInShadow.join(", ")}`,
          severity: "critical" as const,
        }
      }

      if (divergenceRatio > 0.5) {
        return {
          hasDivergence: true,
          divergenceReason: `High divergence (${(divergenceRatio * 100).toFixed(0)}%): shadow raised ${onlyInShadow.length} unique points`,
          severity: "warning" as const,
        }
      }

      return {
        hasDivergence: true,
        divergenceReason: `Moderate divergence (${(divergenceRatio * 100).toFixed(0)}%): ${onlyInShadow.length} shadow-only insights`,
        severity: "info" as const,
      }
    })())
  }

  function extractKeywords(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .filter((w) => !STOP_WORDS.has(w))
  }

  const STOP_WORDS = new Set([
    "about", "above", "after", "again", "against", "being", "below",
    "between", "could", "doing", "during", "every", "first", "found",
    "further", "going", "having", "itself", "might", "other", "place",
    "rather", "right", "shall", "should", "since", "still", "their",
    "there", "these", "thing", "those", "three", "through", "under",
    "until", "using", "wants", "where", "which", "while", "would",
  ])

  function buildShadowPrompt(question: string): string {
    return `You are a background analyst. Analyze this question independently and comprehensively. Focus on risks, edge cases, and non-obvious concerns.

## Question
${question}

Provide a thorough analysis covering:
1. Security implications
2. Performance considerations
3. Correctness risks
4. Architecture concerns
5. Any non-obvious issues

Be specific and concise.`
  }
}
