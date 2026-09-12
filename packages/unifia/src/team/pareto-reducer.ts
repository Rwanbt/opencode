import { NamedError } from "@unifia/util/error"
import z from "zod"
import { endpointKey } from "./candidate-generator"

// =============================================================================
// pareto-reducer.ts — TEAM-F02
//
// Removes dominated offers from the eligible set produced by TEAM-F01,
// without losing region coverage or reliability, and explains BOTH every
// elimination and every retention.
//
// Scope of comparison — the decision that shapes everything else:
// endpoints are compared ONLY against other endpoints serving the same
// model release (`releaseKey`). Two providers serving the same release are
// substitutes, so keeping a strictly worse one is pure noise. Two different
// releases are NOT substitutes at this stage: eliminating a cheaper, weaker
// model because a stronger one exists would be a ranking decision, and
// ranking belongs to a later card. This module never compares across
// releases.
//
// Pareto dimensions and their optimisation direction:
//   costPerMillionInputTokens   minimise
//   costPerMillionOutputTokens  minimise
//   latencyP95Ms                minimise  (null = unknown, see below)
//   contextTotalTokens          maximise
//   availabilityScore           maximise
//
// A dominates B iff A is at least as good on EVERY dimension and strictly
// better on at least one. Endpoints that are merely incomparable — cheaper
// but slower, smaller but more reliable — are always retained; that is the
// point of a Pareto front rather than a single winner.
//
// Reliability is a dimension rather than a special case: an endpoint can
// only be dominated by one whose availabilityScore is >= its own, so the
// most reliable endpoint of a release is never eliminated. Region coverage
// cannot be expressed that way (it is a set, not a scalar), so it gets an
// explicit restoration pass — see `restoreRegionCoverage`.
//
// `null` latency means "not measured", not "fast" or "slow". An unknown
// value makes the pair incomparable on that dimension, so neither endpoint
// can dominate the other: unmeasured endpoints are never eliminated on the
// basis of a latency nobody observed.
// =============================================================================

// -----------------------------------------------------------------------
// Boundary validation
// -----------------------------------------------------------------------

export const ParetoReducerInputError = NamedError.create(
  "ParetoReducerInputError",
  z.object({
    entity: z.string(),
    issues: z.array(z.object({ path: z.string(), code: z.string(), message: z.string() })),
  }),
)

function parseBoundary<Schema extends z.ZodTypeAny>(schema: Schema, entity: string, raw: unknown): z.infer<Schema> {
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new ParetoReducerInputError({
      entity,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message,
      })),
    })
  }
  return result.data
}

// -----------------------------------------------------------------------
// Endpoint projection
// -----------------------------------------------------------------------

const REGION_CODE = z.string().regex(/^[A-Z]{2}$/, "region must be ISO 3166-1 alpha-2 uppercase")

export const ParetoEndpointSchema = z
  .object({
    providerID: z.string().min(1),
    modelID: z.string().min(1),
    /**
     * Identity of the underlying model release, shared by every provider
     * serving it (e.g. "claude-sonnet-4.5"). This is the dedup key: it is
     * what makes two rows from different providers the same offer rather
     * than two different products.
     */
    releaseKey: z.string().min(1),
    costPerMillionInputTokens: z.number().nonnegative(),
    costPerMillionOutputTokens: z.number().nonnegative(),
    /** `null` = never measured. Never treated as fast or slow. */
    latencyP95Ms: z.number().nonnegative().nullable(),
    contextTotalTokens: z.number().int().positive(),
    availabilityScore: z.number().min(0).max(1),
    regions: z.array(REGION_CODE),
  })
  .strict()

/** Frozen at reduce time; see `reduceToParetoFront`. */
export type ParetoEndpoint = Readonly<z.infer<typeof ParetoEndpointSchema>>

export const ParetoEndpointListSchema = z.array(ParetoEndpointSchema).superRefine((list, ctx) => {
  const seen = new Set<string>()
  list.forEach((endpoint, index) => {
    const key = endpointKey(endpoint)
    if (seen.has(key)) ctx.addIssue({ code: "custom", path: [index], message: `duplicate endpoint ${key}` })
    seen.add(key)
  })
})

// -----------------------------------------------------------------------
// Dominance
// -----------------------------------------------------------------------

type DimensionComparison = "better" | "worse" | "equal" | "unknown"

function compareMinimised(a: number | null, b: number | null): DimensionComparison {
  if (a === null || b === null) return "unknown"
  if (a < b) return "better"
  if (a > b) return "worse"
  return "equal"
}

function compareMaximised(a: number, b: number): DimensionComparison {
  if (a > b) return "better"
  if (a < b) return "worse"
  return "equal"
}

function dimensionComparisons(a: ParetoEndpoint, b: ParetoEndpoint): readonly DimensionComparison[] {
  return [
    compareMinimised(a.costPerMillionInputTokens, b.costPerMillionInputTokens),
    compareMinimised(a.costPerMillionOutputTokens, b.costPerMillionOutputTokens),
    compareMinimised(a.latencyP95Ms, b.latencyP95Ms),
    compareMaximised(a.contextTotalTokens, b.contextTotalTokens),
    compareMaximised(a.availabilityScore, b.availabilityScore),
  ]
}

/**
 * True iff `a` dominates `b`: at least as good everywhere, strictly better
 * somewhere. Any `unknown` dimension blocks dominance in both directions —
 * we never eliminate on the strength of a value nobody measured.
 */
export function dominates(a: ParetoEndpoint, b: ParetoEndpoint): boolean {
  const comparisons = dimensionComparisons(a, b)
  if (comparisons.includes("unknown")) return false
  if (comparisons.includes("worse")) return false
  return comparisons.includes("better")
}

/** True iff both endpoints are identical on every Pareto dimension. */
function equalOnAllDimensions(a: ParetoEndpoint, b: ParetoEndpoint): boolean {
  return dimensionComparisons(a, b).every((comparison) => comparison === "equal")
}

function sameRegions(a: ParetoEndpoint, b: ParetoEndpoint): boolean {
  const left = new Set(a.regions)
  const right = new Set(b.regions)
  return left.size === right.size && [...left].every((region) => right.has(region))
}

// -----------------------------------------------------------------------
// Decisions
// -----------------------------------------------------------------------

export const ParetoOutcomeSchema = z.enum([
  "RETAINED_PARETO_OPTIMAL",
  "RETAINED_REGION_COVERAGE",
  "RETAINED_SOLE_OFFER",
  "ELIMINATED_DOMINATED",
  "ELIMINATED_DUPLICATE",
])
export type ParetoOutcome = z.infer<typeof ParetoOutcomeSchema>

export interface ParetoDecision {
  readonly endpointKey: string
  readonly providerID: string
  readonly modelID: string
  readonly releaseKey: string
  readonly outcome: ParetoOutcome
  readonly reason: string
  /** Endpoint that dominated or duplicated this one; `null` when retained. */
  readonly supersededBy: string | null
}

export function isRetained(outcome: ParetoOutcome): boolean {
  return outcome.startsWith("RETAINED_")
}

// -----------------------------------------------------------------------
// Reduction
// -----------------------------------------------------------------------

export interface ParetoReductionStats {
  readonly totalEndpoints: number
  readonly retainedCount: number
  readonly eliminatedCount: number
  readonly releaseGroupCount: number
  readonly byOutcome: Readonly<Partial<Record<ParetoOutcome, number>>>
  /**
   * Regions covered by the input. The reducer guarantees the retained set
   * covers exactly these — `restoreRegionCoverage` exists to make that
   * true even when the Pareto front alone would have dropped one.
   */
  readonly coveredRegions: readonly string[]
}

export interface ParetoReductionResult {
  readonly retained: readonly ParetoEndpoint[]
  readonly eliminated: readonly ParetoEndpoint[]
  /** One entry per input endpoint — retentions included, not just cuts. */
  readonly decisions: readonly ParetoDecision[]
  readonly stats: ParetoReductionStats
}

function decision(
  endpoint: ParetoEndpoint,
  outcome: ParetoOutcome,
  reason: string,
  supersededBy: string | null,
): ParetoDecision {
  return {
    endpointKey: endpointKey(endpoint),
    providerID: endpoint.providerID,
    modelID: endpoint.modelID,
    releaseKey: endpoint.releaseKey,
    outcome,
    reason,
    supersededBy,
  }
}

/**
 * Group endpoints by release, preserving first-appearance order of the
 * groups and input order within each group, so the whole reduction is a
 * deterministic function of input order alone.
 */
function groupByRelease(endpoints: readonly ParetoEndpoint[]): ReadonlyMap<string, readonly ParetoEndpoint[]> {
  const groups = new Map<string, ParetoEndpoint[]>()
  for (const endpoint of endpoints) {
    const group = groups.get(endpoint.releaseKey)
    if (group) group.push(endpoint)
    else groups.set(endpoint.releaseKey, [endpoint])
  }
  return groups
}

/**
 * Collapse endpoints identical on every Pareto dimension AND on region
 * coverage. Exact ties are incomparable under Pareto — neither dominates —
 * so without this they would all survive as separate rows for what is
 * genuinely one offer. Endpoints that tie on the metrics but differ on
 * regions are NOT collapsed: they cover different ground.
 *
 * The survivor is the lexicographically smallest endpointKey, which makes
 * the choice reproducible rather than dependent on input order.
 */
function dedupExactTies(group: readonly ParetoEndpoint[]): {
  kept: readonly ParetoEndpoint[]
  decisions: readonly ParetoDecision[]
} {
  // Build the full equivalence classes FIRST, then pick each class's
  // survivor. Resolving pairwise while scanning would make a third twin
  // report the second one as its superseder — and the second may itself be
  // eliminated, leaving `supersededBy` pointing at a row that is not in the
  // result. Every duplicate must name the endpoint that actually survived.
  const classes: ParetoEndpoint[][] = []
  for (const endpoint of group) {
    const existing = classes.find(
      (members) => equalOnAllDimensions(members[0]!, endpoint) && sameRegions(members[0]!, endpoint),
    )
    if (existing) existing.push(endpoint)
    else classes.push([endpoint])
  }

  const kept: ParetoEndpoint[] = []
  const decisions: ParetoDecision[] = []
  for (const members of classes) {
    const survivor = [...members].sort((a, b) => endpointKey(a).localeCompare(endpointKey(b)))[0]!
    kept.push(survivor)
    for (const member of members) {
      if (member === survivor) continue
      decisions.push(
        decision(
          member,
          "ELIMINATED_DUPLICATE",
          `identical to ${endpointKey(survivor)} on every Pareto dimension and on region coverage`,
          endpointKey(survivor),
        ),
      )
    }
  }
  return { kept, decisions }
}

/**
 * Add back the best-available endpoint for any region the Pareto front
 * stopped covering. Dominance is a scalar comparison and cannot see that
 * the loser was the only one serving a region — this is what keeps the
 * card's "sans perdre région" guarantee true rather than aspirational.
 *
 * Selection among the candidates for an uncovered region is deterministic:
 * highest availability, then lowest input cost, then smallest endpointKey.
 */
function restoreRegionCoverage(
  front: readonly ParetoEndpoint[],
  cut: readonly ParetoEndpoint[],
): { restored: readonly ParetoEndpoint[]; decisions: readonly ParetoDecision[] } {
  const covered = new Set(front.flatMap((endpoint) => endpoint.regions))
  const restored: ParetoEndpoint[] = []
  const decisions: ParetoDecision[] = []

  const missing = [...new Set(cut.flatMap((endpoint) => endpoint.regions))]
    .filter((region) => !covered.has(region))
    .sort()

  for (const region of missing) {
    if (covered.has(region)) continue // already restored by an earlier pick
    const candidates = cut
      .filter((endpoint) => endpoint.regions.includes(region) && !restored.includes(endpoint))
      .sort(
        (a, b) =>
          b.availabilityScore - a.availabilityScore ||
          a.costPerMillionInputTokens - b.costPerMillionInputTokens ||
          endpointKey(a).localeCompare(endpointKey(b)),
      )
    const pick = candidates[0]
    if (!pick) continue
    restored.push(pick)
    for (const covering of pick.regions) covered.add(covering)
    decisions.push(
      decision(
        pick,
        "RETAINED_REGION_COVERAGE",
        `dominated on the Pareto dimensions, but the only remaining endpoint of this release serving region ${region}`,
        null,
      ),
    )
  }
  return { restored, decisions }
}

/**
 * Re-point every `supersededBy` at an endpoint that actually survived.
 *
 * A duplicate cites its class survivor, but that survivor can itself be
 * dominated and eliminated later in the same release — leaving the
 * duplicate citing a row absent from the result, which is useless to a
 * consumer asking "what should I use instead?".
 *
 * Following the chain is not just cosmetic re-pointing: if X is identical
 * to Y on every dimension and Y is dominated by D, then D dominates X too.
 * So a duplicate whose chain passes through a dominance link is genuinely
 * ELIMINATED_DOMINATED, and saying so is more accurate than calling it a
 * duplicate of something that is gone.
 */
function resolveSupersededChains(
  decisionByKey: Map<string, ParetoDecision>,
  retainedKeys: ReadonlySet<string>,
): void {
  for (const [key, current] of [...decisionByKey]) {
    if (current.supersededBy === null || retainedKeys.has(current.supersededBy)) continue

    const visited = new Set<string>([key])
    let cursor: string | null = current.supersededBy
    let passedThroughDominance = current.outcome === "ELIMINATED_DOMINATED"

    while (cursor !== null && !retainedKeys.has(cursor) && !visited.has(cursor)) {
      visited.add(cursor)
      const next: ParetoDecision | undefined = decisionByKey.get(cursor)
      if (next === undefined) break
      if (next.outcome === "ELIMINATED_DOMINATED") passedThroughDominance = true
      cursor = next.supersededBy
    }

    // Unresolvable (cycle or dangling): leave the original attribution rather
    // than invent one.
    if (cursor === null || !retainedKeys.has(cursor)) continue

    decisionByKey.set(
      key,
      passedThroughDominance
        ? {
            ...current,
            outcome: "ELIMINATED_DOMINATED",
            supersededBy: cursor,
            reason: `dominated by ${cursor} on every Pareto dimension, transitively through an identical endpoint that was itself eliminated`,
          }
        : { ...current, supersededBy: cursor },
    )
  }
}

/**
 * Reduce `endpoints` to the non-dominated set per model release, keeping
 * incomparable offers and never dropping a region the input covered.
 *
 * Pure: no LLM, network, provider, git or filesystem call. The result is a
 * deterministic function of the input — same input, same output, including
 * the order of every list and the choice made for every tie.
 */
export function reduceToParetoFront(endpoints: readonly ParetoEndpoint[]): ParetoReductionResult {
  const parsed: ParetoEndpoint[] = parseBoundary(ParetoEndpointListSchema, "endpoints", endpoints)
  const validated = parsed.map((endpoint) => Object.freeze(endpoint))

  const groups = groupByRelease(validated)
  const decisionByKey = new Map<string, ParetoDecision>()
  const retainedSet = new Set<ParetoEndpoint>()

  for (const [releaseKey, group] of groups) {
    if (group.length === 1) {
      const only = group[0]!
      decisionByKey.set(
        endpointKey(only),
        decision(only, "RETAINED_SOLE_OFFER", `only endpoint serving release ${releaseKey}`, null),
      )
      retainedSet.add(only)
      continue
    }

    const { kept, decisions: dedupDecisions } = dedupExactTies(group)
    for (const item of dedupDecisions) decisionByKey.set(item.endpointKey, item)

    const front = kept.filter((candidate) => !kept.some((other) => dominates(other, candidate)))
    const cut = kept.filter((candidate) => !front.includes(candidate))

    for (const endpoint of front) {
      decisionByKey.set(
        endpointKey(endpoint),
        decision(
          endpoint,
          "RETAINED_PARETO_OPTIMAL",
          `not dominated by any other endpoint serving release ${releaseKey}`,
          null,
        ),
      )
      retainedSet.add(endpoint)
    }

    const { restored, decisions: regionDecisions } = restoreRegionCoverage(front, cut)
    for (const item of regionDecisions) decisionByKey.set(item.endpointKey, item)
    for (const endpoint of restored) retainedSet.add(endpoint)

    for (const endpoint of cut) {
      if (retainedSet.has(endpoint)) continue
      // Deterministic attribution: smallest dominator key, not "first found".
      //
      // The front always contains a dominator for a cut endpoint: Pareto
      // dominance is transitive here, and an `unknown` dimension blocks
      // dominance entirely, so any chain A>B>C has all three measured on
      // every compared dimension and A>C follows. If that ever stops
      // holding, fail loudly rather than emit a decision with an undefined
      // superseder.
      const dominator = front
        .filter((other) => dominates(other, endpoint))
        .map(endpointKey)
        .sort()[0]
      if (dominator === undefined) {
        throw new Error(
          `pareto-reducer invariant violated: ${endpointKey(endpoint)} was cut from release ${releaseKey} but no front endpoint dominates it`,
        )
      }
      decisionByKey.set(
        endpointKey(endpoint),
        decision(endpoint, "ELIMINATED_DOMINATED", `dominated by ${dominator} on every Pareto dimension`, dominator),
      )
    }
  }

  // Rebuild both lists in input order so the report is diffable.
  const retained = validated.filter((endpoint) => retainedSet.has(endpoint))
  const eliminated = validated.filter((endpoint) => !retainedSet.has(endpoint))

  resolveSupersededChains(decisionByKey, new Set(retained.map(endpointKey)))

  const decisions = validated.map((endpoint) => {
    const item = decisionByKey.get(endpointKey(endpoint))
    // The card requires one explanation per endpoint; a hole here would ship
    // an `undefined` inside the decisions array and surface far from its cause.
    if (item === undefined) {
      throw new Error(`pareto-reducer invariant violated: no decision recorded for ${endpointKey(endpoint)}`)
    }
    return item
  })

  const byOutcome: Partial<Record<ParetoOutcome, number>> = {}
  for (const item of decisions) byOutcome[item.outcome] = (byOutcome[item.outcome] ?? 0) + 1

  return {
    retained,
    eliminated,
    decisions,
    stats: {
      totalEndpoints: validated.length,
      retainedCount: retained.length,
      eliminatedCount: eliminated.length,
      releaseGroupCount: groups.size,
      byOutcome,
      coveredRegions: [...new Set(validated.flatMap((endpoint) => endpoint.regions))].sort(),
    },
  }
}
