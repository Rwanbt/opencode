import { NamedError } from "@unifia/util/error"
import z from "zod"
import { isTerminalStage, LifecycleStageSchema, type LifecycleStage } from "../model-intelligence/lifecycle"

// =============================================================================
// candidate-generator.ts — TEAM-F01
//
// Reduces a large endpoint registry (~1000 provider/model endpoints) to the
// subset that is TECHNICALLY eligible for a given task, and explains every
// elimination. This is a pure hard-filter stage: no LLM call, no network, no
// provider probe, no scoring or ranking — an endpoint either satisfies a
// stated requirement or it does not. Preference ordering between surviving
// candidates belongs to the later reduce/rank cards, not here.
//
// Reuse, not redefinition:
//  - Lifecycle eligibility defers to TEAM-C08's `isTerminalStage` /
//    `LifecycleStageSchema` (model-intelligence/lifecycle.ts), the sole
//    owner of the lifecycle state machine.
//  - `CandidateEndpoint` follows C08's own `FilterableModel` precedent
//    (collections.ts): a deliberately minimal projection rather than the
//    frozen full `Model`, so callers and tests don't have to build a
//    complete Model + provenance + sourceRefs object just to filter.
//  - Eliminations project cleanly onto TEAM-D01's `RoutingCandidate`
//    ({ workerId, modelFamily, rejectedReason }) via
//    `toRoutingCandidateInputs()`, so a routing decision can record WHY an
//    endpoint lost without this module owning D01's persisted shape.
// =============================================================================

// -----------------------------------------------------------------------
// Boundary validation
// -----------------------------------------------------------------------

export const CandidateGeneratorInputError = NamedError.create(
  "CandidateGeneratorInputError",
  z.object({
    entity: z.string(),
    issues: z.array(z.object({ path: z.string(), code: z.string(), message: z.string() })),
  }),
)

function parseBoundary<Schema extends z.ZodTypeAny>(schema: Schema, entity: string, raw: unknown): z.infer<Schema> {
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new CandidateGeneratorInputError({
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

/** ISO 3166-1 alpha-2, canonical uppercase. See `providerRegions` below. */
const REGION_CODE = z.string().regex(/^[A-Z]{2}$/, "region must be ISO 3166-1 alpha-2 uppercase")

/** Capability flags this stage can gate on — a subset of C08 `ModelCapabilities`. */
export const CandidateCapabilitySchema = z.enum([
  "structuredOutput",
  "toolCalls",
  "parallelToolCalls",
  "visionInput",
  "audioInput",
  "videoInput",
  "pdfInput",
  "reasoning",
  "caching",
  "promptCaching",
  "systemMessages",
])
export type CandidateCapability = z.infer<typeof CandidateCapabilitySchema>

export const CandidateModalitySchema = z.enum(["text", "audio", "image", "video", "pdf"])
export type CandidateModality = z.infer<typeof CandidateModalitySchema>

/** Mirrors `Model.status` (model-intelligence/schema.ts). */
export const CandidateStatusSchema = z.enum(["alpha", "beta", "active", "deprecated", "quarantined"])
export type CandidateStatus = z.infer<typeof CandidateStatusSchema>

export const CandidateEndpointSchema = z
  .object({
    providerID: z.string().min(1),
    modelID: z.string().min(1),
    /** Model family, e.g. "claude" — `null` when the registry has none. */
    family: z.string().min(1).nullable(),
    status: CandidateStatusSchema,
    lifecycleStage: LifecycleStageSchema,
    capabilities: z.record(CandidateCapabilitySchema, z.boolean()),
    inputModalities: z.array(CandidateModalitySchema).min(1),
    contextTotalTokens: z.number().int().positive(),
    contextOutputTokens: z.number().int().positive(),
    /**
     * ISO 3166-1 alpha-2 regions the provider may serve this endpoint from.
     * Uppercase is enforced rather than normalized: region comparison is a
     * set intersection, so a lowercase code would silently match nothing
     * and quietly eliminate an endpoint on privacy grounds. A loud boundary
     * rejection is the correct failure mode for a privacy filter.
     */
    providerRegions: z.array(REGION_CODE),
    /** Mirrors `Provider.regionPolicy.dataResidencyRequired`. */
    providerGuaranteesDataResidency: z.boolean(),
    /** Mirrors `Provider.privacyPolicyRef`; `null` = no published policy. */
    privacyPolicyRef: z.string().min(1).nullable(),
  })
  .strict()
/**
 * `Readonly` at compile time and frozen at index-build time: `CandidateIndex`
 * is documented as an immutable snapshot, and endpoint objects are handed
 * straight back in `eligible`. Without both, a caller mutating a returned
 * candidate would silently corrupt the index for every later query.
 */
export type CandidateEndpoint = Readonly<z.infer<typeof CandidateEndpointSchema>>

/** Stable endpoint key. Mirrors collections.ts `refKey`. */
export function endpointKey(endpoint: Pick<CandidateEndpoint, "providerID" | "modelID">): string {
  return `${endpoint.providerID}::${endpoint.modelID}`
}

// -----------------------------------------------------------------------
// Requirements
// -----------------------------------------------------------------------

export const ReviewerSeparationSchema = z
  .object({
    /** Endpoint key of the implementer; that exact endpoint can never review its own work. */
    implementerEndpointKey: z.string().min(1).nullable(),
    /** Implementer's model family. */
    implementerFamily: z.string().min(1).nullable(),
    /**
     * D-010 §6 reviewer rotation: when true, no endpoint sharing the
     * implementer's family may review — a same-family reviewer shares the
     * implementer's blind spots and is not meaningfully independent.
     */
    forbidSameFamily: z.boolean(),
  })
  .strict()
export type ReviewerSeparation = z.infer<typeof ReviewerSeparationSchema>

export const CandidateRequirementsSchema = z
  .object({
    allowedProviderIDs: z.array(z.string().min(1)).min(1).nullable().default(null),
    deniedProviderIDs: z.array(z.string().min(1)).default([]),
    allowedLifecycleStages: z.array(LifecycleStageSchema).min(1).nullable().default(null),
    allowedStatuses: z.array(CandidateStatusSchema).min(1).nullable().default(null),
    requiredCapabilities: z.array(CandidateCapabilitySchema).default([]),
    requiredInputModalities: z.array(CandidateModalitySchema).default([]),
    minContextTotalTokens: z.number().int().positive().nullable().default(null),
    minContextOutputTokens: z.number().int().positive().nullable().default(null),
    /** Data-residency requirement: provider must guarantee residency. */
    requiresDataResidency: z.boolean().default(false),
    /** Endpoint's provider must be able to serve from at least one of these regions. */
    allowedRegions: z.array(REGION_CODE).min(1).nullable().default(null),
    requiresPublishedPrivacyPolicy: z.boolean().default(false),
    reviewerSeparation: ReviewerSeparationSchema.nullable().default(null),
  })
  .strict()
/**
 * Public input shape. Declared by hand rather than via `z.input<>` so every
 * array is `readonly`: callers routinely hold frozen or `as const`
 * configuration and should not have to hand over mutable arrays (nor fear
 * that this module mutates them — it does not). The zod schema above stays
 * the single runtime validator.
 */
export interface CandidateRequirements {
  readonly allowedProviderIDs?: readonly string[] | null
  readonly deniedProviderIDs?: readonly string[]
  readonly allowedLifecycleStages?: readonly LifecycleStage[] | null
  readonly allowedStatuses?: readonly CandidateStatus[] | null
  readonly requiredCapabilities?: readonly CandidateCapability[]
  readonly requiredInputModalities?: readonly CandidateModality[]
  readonly minContextTotalTokens?: number | null
  readonly minContextOutputTokens?: number | null
  readonly requiresDataResidency?: boolean
  readonly allowedRegions?: readonly string[] | null
  readonly requiresPublishedPrivacyPolicy?: boolean
  readonly reviewerSeparation?: ReviewerSeparation | null
}

type ResolvedRequirements = z.output<typeof CandidateRequirementsSchema>

// -----------------------------------------------------------------------
// Elimination rules
// -----------------------------------------------------------------------

/**
 * Every reason an endpoint can be eliminated. Evaluated in this exact
 * order; the FIRST failing rule is the reported one, so an endpoint that
 * violates several requirements always reports the same rule for the same
 * input — the report is deterministic and diffable.
 */
export const EliminationRuleSchema = z.enum([
  "PROVIDER_NOT_ALLOWED",
  "PROVIDER_DENIED",
  "LIFECYCLE_TERMINAL",
  "LIFECYCLE_STAGE_NOT_ALLOWED",
  "STATUS_NOT_ALLOWED",
  "MISSING_CAPABILITY",
  "MISSING_INPUT_MODALITY",
  "CONTEXT_TOTAL_TOO_SMALL",
  "CONTEXT_OUTPUT_TOO_SMALL",
  "PRIVACY_NO_DATA_RESIDENCY",
  "PRIVACY_REGION_NOT_ALLOWED",
  "PRIVACY_NO_POLICY",
  "REVIEWER_SAME_ENDPOINT",
  "REVIEWER_SAME_FAMILY",
])
export type EliminationRule = z.infer<typeof EliminationRuleSchema>

export interface EliminatedCandidate {
  readonly endpointKey: string
  readonly providerID: string
  readonly modelID: string
  readonly family: string | null
  readonly rule: EliminationRule
  /** Human-readable explanation naming the concrete value that failed. */
  readonly reason: string
}

/**
 * First failing rule for `endpoint`, or `null` when it survives every
 * hard filter. Pure and allocation-light: this runs once per endpoint per
 * query over registries of ~1000 endpoints.
 */
function firstFailingRule(
  endpoint: CandidateEndpoint,
  requirements: ResolvedRequirements,
): { rule: EliminationRule; reason: string } | null {
  if (requirements.deniedProviderIDs.includes(endpoint.providerID)) {
    return { rule: "PROVIDER_DENIED", reason: `provider ${endpoint.providerID} is explicitly denied` }
  }
  if (isTerminalStage(endpoint.lifecycleStage)) {
    return {
      rule: "LIFECYCLE_TERMINAL",
      reason: `lifecycle stage "${endpoint.lifecycleStage}" is terminal (C08) and never eligible`,
    }
  }
  if (requirements.allowedLifecycleStages && !requirements.allowedLifecycleStages.includes(endpoint.lifecycleStage)) {
    return {
      rule: "LIFECYCLE_STAGE_NOT_ALLOWED",
      reason: `lifecycle stage "${endpoint.lifecycleStage}" is not in the allowed set [${requirements.allowedLifecycleStages.join(", ")}]`,
    }
  }
  if (requirements.allowedStatuses && !requirements.allowedStatuses.includes(endpoint.status)) {
    return {
      rule: "STATUS_NOT_ALLOWED",
      reason: `status "${endpoint.status}" is not in the allowed set [${requirements.allowedStatuses.join(", ")}]`,
    }
  }
  for (const capability of requirements.requiredCapabilities) {
    if (endpoint.capabilities[capability] !== true) {
      return { rule: "MISSING_CAPABILITY", reason: `required capability "${capability}" is not supported` }
    }
  }
  for (const modality of requirements.requiredInputModalities) {
    if (!endpoint.inputModalities.includes(modality)) {
      return { rule: "MISSING_INPUT_MODALITY", reason: `required input modality "${modality}" is not supported` }
    }
  }
  if (requirements.minContextTotalTokens !== null && endpoint.contextTotalTokens < requirements.minContextTotalTokens) {
    return {
      rule: "CONTEXT_TOTAL_TOO_SMALL",
      reason: `context window ${endpoint.contextTotalTokens} < required ${requirements.minContextTotalTokens}`,
    }
  }
  if (
    requirements.minContextOutputTokens !== null &&
    endpoint.contextOutputTokens < requirements.minContextOutputTokens
  ) {
    return {
      rule: "CONTEXT_OUTPUT_TOO_SMALL",
      reason: `output window ${endpoint.contextOutputTokens} < required ${requirements.minContextOutputTokens}`,
    }
  }
  if (requirements.requiresDataResidency && !endpoint.providerGuaranteesDataResidency) {
    return { rule: "PRIVACY_NO_DATA_RESIDENCY", reason: "provider does not guarantee data residency" }
  }
  if (requirements.allowedRegions) {
    const served = endpoint.providerRegions.some((region) => requirements.allowedRegions!.includes(region))
    if (!served) {
      return {
        rule: "PRIVACY_REGION_NOT_ALLOWED",
        reason: `provider regions [${endpoint.providerRegions.join(", ")}] do not intersect allowed [${requirements.allowedRegions.join(", ")}]`,
      }
    }
  }
  if (requirements.requiresPublishedPrivacyPolicy && endpoint.privacyPolicyRef === null) {
    return { rule: "PRIVACY_NO_POLICY", reason: "provider has no published privacy policy reference" }
  }
  const separation = requirements.reviewerSeparation
  if (separation) {
    if (separation.implementerEndpointKey !== null && endpointKey(endpoint) === separation.implementerEndpointKey) {
      return { rule: "REVIEWER_SAME_ENDPOINT", reason: "an endpoint cannot review its own implementation" }
    }
    if (
      separation.forbidSameFamily &&
      separation.implementerFamily !== null &&
      endpoint.family === separation.implementerFamily
    ) {
      return {
        rule: "REVIEWER_SAME_FAMILY",
        reason: `family "${endpoint.family}" is the implementer's family; a same-family reviewer is not independent (D-010 §6)`,
      }
    }
  }
  return null
}

// -----------------------------------------------------------------------
// Index
// -----------------------------------------------------------------------

/**
 * A pre-built, immutable view over an endpoint registry snapshot.
 *
 * Build cost is paid once per snapshot; a plan issues one query per task
 * (and one more per reviewer assignment), so the per-query work is what
 * matters. `byProvider` lets a provider-scoped query skip every endpoint
 * outside the allowed providers WITHOUT testing them one by one — their
 * elimination rule is known from bucket membership alone
 * (PROVIDER_NOT_ALLOWED), which keeps the explanation complete while
 * still short-circuiting the scan.
 */
export interface CandidateIndex {
  readonly all: readonly CandidateEndpoint[]
  readonly byProvider: ReadonlyMap<string, readonly CandidateEndpoint[]>
  readonly byLifecycleStage: ReadonlyMap<LifecycleStage, readonly CandidateEndpoint[]>
}

export const CandidateEndpointListSchema = z.array(CandidateEndpointSchema).superRefine((list, ctx) => {
  const seen = new Set<string>()
  list.forEach((endpoint, index) => {
    const key = endpointKey(endpoint)
    if (seen.has(key)) {
      ctx.addIssue({ code: "custom", path: [index], message: `duplicate endpoint ${key}` })
    }
    seen.add(key)
  })
})

export function buildCandidateIndex(endpoints: readonly CandidateEndpoint[]): CandidateIndex {
  const parsed: CandidateEndpoint[] = parseBoundary(CandidateEndpointListSchema, "endpoints", endpoints)
  // One-time cost per snapshot, outside the per-query budget the card's p95
  // criterion measures.
  const validated = parsed.map((endpoint) => Object.freeze(endpoint))
  const byProvider = new Map<string, CandidateEndpoint[]>()
  const byLifecycleStage = new Map<LifecycleStage, CandidateEndpoint[]>()
  for (const endpoint of validated) {
    const providerBucket = byProvider.get(endpoint.providerID)
    if (providerBucket) providerBucket.push(endpoint)
    else byProvider.set(endpoint.providerID, [endpoint])
    const stageBucket = byLifecycleStage.get(endpoint.lifecycleStage)
    if (stageBucket) stageBucket.push(endpoint)
    else byLifecycleStage.set(endpoint.lifecycleStage, [endpoint])
  }
  return { all: Object.freeze(validated), byProvider, byLifecycleStage }
}

// -----------------------------------------------------------------------
// Generation
// -----------------------------------------------------------------------

export interface CandidateGenerationStats {
  readonly totalEndpoints: number
  readonly eligibleCount: number
  readonly eliminatedCount: number
  /** Elimination count per rule. Only rules that fired at least once appear. */
  readonly byRule: Readonly<Partial<Record<EliminationRule, number>>>
  /**
   * Entries of `allowedProviderIDs` that match no endpoint in the index —
   * almost always a typo or a stale config. Without this, such a mistake
   * looks exactly like a legitimate "everything was filtered out" result:
   * every endpoint eliminated as PROVIDER_NOT_ALLOWED, zero candidates, and
   * no signal that the allow-list itself was wrong. Empty in the normal case.
   */
  readonly unknownAllowedProviderIDs: readonly string[]
}

export interface CandidateGenerationResult {
  readonly eligible: readonly CandidateEndpoint[]
  readonly eliminated: readonly EliminatedCandidate[]
  readonly stats: CandidateGenerationStats
}

function eliminate(
  endpoint: CandidateEndpoint,
  rule: EliminationRule,
  reason: string,
): EliminatedCandidate {
  return {
    endpointKey: endpointKey(endpoint),
    providerID: endpoint.providerID,
    modelID: endpoint.modelID,
    family: endpoint.family,
    rule,
    reason,
  }
}

/**
 * Reduce `index` to the endpoints that satisfy every stated hard filter,
 * explaining each elimination.
 *
 * Makes NO LLM, network, provider, git, or filesystem call — the result is
 * a pure function of the index snapshot and the requirements. Input order
 * is preserved in both output lists, so two runs over the same snapshot
 * produce identical, diffable reports.
 */
export function generateCandidates(
  index: CandidateIndex,
  requirements: CandidateRequirements = {},
): CandidateGenerationResult {
  const resolved = parseBoundary(CandidateRequirementsSchema, "requirements", requirements)

  const eligible: CandidateEndpoint[] = []
  const eliminated: EliminatedCandidate[] = []
  const byRule: Partial<Record<EliminationRule, number>> = {}

  const record = (candidate: EliminatedCandidate) => {
    eliminated.push(candidate)
    byRule[candidate.rule] = (byRule[candidate.rule] ?? 0) + 1
  }

  // Provider-scoped fast path: endpoints outside the allowed providers are
  // eliminated by bucket membership, never individually re-tested.
  const allowed = resolved.allowedProviderIDs
  if (allowed) {
    const allowedSet = new Set(allowed)
    for (const endpoint of index.all) {
      if (allowedSet.has(endpoint.providerID)) continue
      record(
        eliminate(
          endpoint,
          "PROVIDER_NOT_ALLOWED",
          `provider ${endpoint.providerID} is not in the allowed set [${allowed.join(", ")}]`,
        ),
      )
    }
  }

  // Dedupe before expanding buckets: a caller passing the same providerID
  // twice must not have that provider's endpoints scanned (and reported)
  // twice, which would double-count candidates and break the
  // eligible + eliminated == totalEndpoints invariant.
  const scanned = allowed
    ? [...new Set(allowed)].flatMap((providerID) => index.byProvider.get(providerID) ?? [])
    : index.all

  for (const endpoint of scanned) {
    const failure = firstFailingRule(endpoint, resolved)
    if (failure === null) eligible.push(endpoint)
    else record(eliminate(endpoint, failure.rule, failure.reason))
  }

  return {
    eligible,
    eliminated,
    stats: {
      totalEndpoints: index.all.length,
      eligibleCount: eligible.length,
      eliminatedCount: eliminated.length,
      byRule,
      unknownAllowedProviderIDs: allowed
        ? [...new Set(allowed)].filter((providerID) => !index.byProvider.has(providerID))
        : [],
    },
  }
}

// -----------------------------------------------------------------------
// D01 bridge
// -----------------------------------------------------------------------

/** Field shape TEAM-D01's `RoutingCandidate` accepts. */
export interface RoutingCandidateInput {
  readonly workerId: null
  readonly modelFamily: string | null
  readonly rejectedReason: string | null
}

/**
 * Project a generation result onto the field shape TEAM-D01's
 * `RoutingCandidate` expects ({ workerId, modelFamily, rejectedReason }),
 * so a `RoutingDecision` can record the full considered set with reasons.
 *
 * `workerId` is always `null` here: this stage reasons about model
 * endpoints, not about which Team worker will drive them — binding an
 * endpoint to a worker is a later routing decision, and inventing a
 * WorkerID at this point would be fabricated provenance. Eliminated
 * candidates precede eligible ones so the rejected set reads first.
 */
export function toRoutingCandidateInputs(result: CandidateGenerationResult): readonly RoutingCandidateInput[] {
  return [
    ...result.eliminated.map((candidate) => ({
      workerId: null,
      modelFamily: candidate.family,
      rejectedReason: `${candidate.rule}: ${candidate.reason}`,
    })),
    ...result.eligible.map((endpoint) => ({
      workerId: null,
      modelFamily: endpoint.family,
      rejectedReason: null,
    })),
  ]
}
