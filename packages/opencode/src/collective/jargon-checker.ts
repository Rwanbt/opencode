import { Effect } from "effect"
import { Log } from "../util/log"
import type { Collective } from "./types"

export namespace JargonChecker {
  const log = Log.create({ service: "jargon-checker" })

  const CAMEL_CASE_RE = /\b[a-z]+(?:[A-Z][a-z]+)+\b/g
  const PASCAL_CASE_RE = /\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g
  const FILE_PATH_RE = /(?:[\w.-]+\/)+[\w.-]+\.\w+/g
  const FUNC_CALL_RE = /\b\w+\(\)/g

  export type JargonResult = {
    term: string
    found: boolean
    locations: string[]
  }

  export const check = Effect.fn("JargonChecker.check")(function* (
    claims: Collective.Claim[],
    workingDirectory: string,
  ) {
    const terms = new Set<string>()

    for (const claim of claims) {
      if (!claim.isExistenceClaim) continue
      const text = claim.content
      for (const match of text.matchAll(CAMEL_CASE_RE)) terms.add(match[0])
      for (const match of text.matchAll(PASCAL_CASE_RE)) terms.add(match[0])
      for (const match of text.matchAll(FILE_PATH_RE)) terms.add(match[0])
      for (const match of text.matchAll(FUNC_CALL_RE)) terms.add(match[0].replace("()", ""))
    }

    if (terms.size === 0) {
      log.info("no jargon terms to check")
      return { results: [], updatedClaims: claims }
    }

    log.info("checking jargon terms", { count: terms.size })

    const results: JargonResult[] = []

    for (const term of terms) {
      const found = yield* grepForTerm(term, workingDirectory)
      results.push(found)
    }

    const termMap = new Map(results.map((r) => [r.term, r]))

    const updatedClaims = claims.map((claim) => {
      if (!claim.isExistenceClaim) return claim

      let maxRisk = 0
      const text = claim.content
      for (const match of text.matchAll(CAMEL_CASE_RE)) {
        const r = termMap.get(match[0])
        if (r && !r.found) maxRisk = Math.max(maxRisk, 0.8)
      }
      for (const match of text.matchAll(PASCAL_CASE_RE)) {
        const r = termMap.get(match[0])
        if (r && !r.found) maxRisk = Math.max(maxRisk, 0.8)
      }
      for (const match of text.matchAll(FILE_PATH_RE)) {
        const r = termMap.get(match[0])
        if (r && !r.found) maxRisk = Math.max(maxRisk, 0.9)
      }
      for (const match of text.matchAll(FUNC_CALL_RE)) {
        const r = termMap.get(match[0].replace("()", ""))
        if (r && !r.found) maxRisk = Math.max(maxRisk, 0.7)
      }

      if (maxRisk > 0) {
        return { ...claim, jargonRisk: maxRisk }
      }
      return claim
    })

    const unverified = results.filter((r) => !r.found)
    if (unverified.length > 0) {
      log.info("unverified terms", {
        count: unverified.length,
        terms: unverified.map((r) => r.term).join(", "),
      })
    }

    return { results, updatedClaims }
  })

  function grepForTerm(
    term: string,
    workingDirectory: string,
  ): Effect.Effect<JargonResult> {
    return Effect.tryPromise({
      try: async () => {
        const { execSync } = await import("node:child_process")
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        try {
          const result = execSync(
            `grep -rl --include="*.ts" --include="*.tsx" --include="*.js" --include="*.rs" --include="*.cpp" --include="*.h" "${escaped}" .`,
            {
              cwd: workingDirectory,
              encoding: "utf-8",
              timeout: 5000,
              maxBuffer: 1024 * 100,
              stdio: ["pipe", "pipe", "pipe"],
            },
          )
          const locations = result
            .trim()
            .split("\n")
            .filter(Boolean)
            .slice(0, 5)
          return { term, found: true as const, locations }
        } catch {
          return { term, found: false as const, locations: [] as string[] }
        }
      },
      catch: (e) => e as Error,
    }).pipe(Effect.catch(() => Effect.succeed({ term, found: false as const, locations: [] as string[] })))
  }
}
