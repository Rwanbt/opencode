import z from "zod"
import { ProviderID, ModelID } from "../provider/schema"

export namespace Collective {
  export const DebateSelection = z.object({
    primary: z.object({
      providerID: ProviderID.zod,
      modelID: ModelID.zod,
    }),
    participants: z
      .array(
        z.object({
          providerID: ProviderID.zod,
          modelID: ModelID.zod,
          role: z.string().optional(),
        }),
      )
      .min(2),
  })

  export type DebateSelection = z.infer<typeof DebateSelection>
  // ── Identifiers ───────────────────────────────────────────────────────────

  export type DebateID = string & { readonly __brand: "DebateID" }
  export type ClaimID = string & { readonly __brand: "ClaimID" }

  export const DebateID = {
    make: () => `dbt_${crypto.randomUUID().replace(/-/g, "")}` as DebateID,
    zod: z.string().startsWith("dbt_").pipe(z.custom<DebateID>()),
  }

  export const ClaimID = {
    make: () => `clm_${crypto.randomUUID().replace(/-/g, "")}` as ClaimID,
    zod: z.string().startsWith("clm_").pipe(z.custom<ClaimID>()),
  }

  // ── Debate tiers ──────────────────────────────────────────────────────────

  export const DebateTier = z.enum(["free", "quick", "standard", "deep"])
  export type DebateTier = z.infer<typeof DebateTier>

  // ── Debate status ─────────────────────────────────────────────────────────

  export const DebateStatus = z.enum([
    "pending",
    "phase1_diverge",
    "phase2_extract",
    "phase3_converge",
    "phase4_synthesize",
    "completed",
    "failed",
    "cancelled",
  ])
  export type DebateStatus = z.infer<typeof DebateStatus>

  // ── Provider auth ─────────────────────────────────────────────────────────

  export const ProviderAuth = z.discriminatedUnion("method", [
    z.object({ method: z.literal("api_key"), key: z.string() }),
    z.object({ method: z.literal("credential_file"), path: z.string(), content: z.string() }),
    z.object({ method: z.literal("cli_subprocess"), binary: z.string(), args: z.array(z.string()) }),
  ])
  export type ProviderAuth = z.infer<typeof ProviderAuth>

  // ── Participant ───────────────────────────────────────────────────────────

  export const Participant = z.object({
    providerID: ProviderID.zod,
    modelID: ModelID.zod,
    role: z.string().optional(),
    anonymousHash: z.string(),
    authMethod: z.enum(["api_key", "credential_file", "cli_subprocess"]).optional(),
  })
  export type Participant = z.infer<typeof Participant>

  // ── Claim categories ──────────────────────────────────────────────────────

  export const ClaimCategory = z.enum([
    "security",
    "performance",
    "maintainability",
    "correctness",
    "ux",
    "architecture",
    "other",
    "out_of_role",
  ])
  export type ClaimCategory = z.infer<typeof ClaimCategory>

  // ── Novelty marker ────────────────────────────────────────────────────────

  export const NoveltyMarker = z.enum(["unique", "minority", "consensus"])
  export type NoveltyMarker = z.infer<typeof NoveltyMarker>

  // ── Claim (atomic insight extracted from a response) ───────────────────

  export const Claim = z.object({
    claimId: ClaimID.zod,
    sourceId: z.string(),
    sourceProvider: z.string(),
    category: ClaimCategory,
    content: z.string(),
    evidenceRefs: z.array(z.string()).optional(),
    confidenceSelf: z.number().min(0).max(1),
    noveltyMarker: NoveltyMarker,
    isActionable: z.boolean(),
    verificationHint: z.string().optional(),
    isExistenceClaim: z.boolean().optional(),
    jargonRisk: z.number().min(0).max(1).optional(),
    isRecovered: z.boolean().optional(),
    supportedBy: z.array(z.string()),
    contradictedBy: z.array(z.string()),
  })
  export type Claim = z.infer<typeof Claim>

  // ── Phase 1 response (raw model output) ───────────────────────────────

  export const PhaseOneResponse = z.object({
    participantHash: z.string(),
    providerID: ProviderID.zod,
    modelID: ModelID.zod,
    role: z.string().optional(),
    content: z.string(),
    outOfRoleInsights: z.array(z.string()),
    tokenUsage: z.object({
      input: z.number(),
      output: z.number(),
    }),
    durationMs: z.number(),
  })
  export type PhaseOneResponse = z.infer<typeof PhaseOneResponse>

  // ── Phase 3 convergence response ──────────────────────────────────────

  export const ConvergenceResponse = z.object({
    participantHash: z.string(),
    critiques: z.array(
      z.object({
        claimId: z.string(),
        verdict: z.enum(["agree", "disagree", "nuance"]),
        argument: z.string(),
      }),
    ),
    tokenUsage: z.object({ input: z.number(), output: z.number() }),
  })
  export type ConvergenceResponse = z.infer<typeof ConvergenceResponse>

  // ── Unresolved conflict ───────────────────────────────────────────────

  export const UnresolvedConflict = z.object({
    topic: z.string(),
    positions: z.record(z.string(), z.string()),
  })
  export type UnresolvedConflict = z.infer<typeof UnresolvedConflict>

  // ── Budget ────────────────────────────────────────────────────────────────

  export const BudgetEstimate = z.object({
    estimatedTokens: z.number(),
    estimatedCostUsd: z.number(),
    breakdown: z.array(
      z.object({
        phase: z.string(),
        providerID: ProviderID.zod,
        modelID: ModelID.zod,
        inputTokens: z.number(),
        outputTokens: z.number(),
        costUsd: z.number(),
      }),
    ),
  })
  export type BudgetEstimate = z.infer<typeof BudgetEstimate>

  export const BudgetConfig = z.object({
    maxTotalTokens: z.number().default(500_000),
    maxCostUsd: z.number().default(2.0),
    warnAtPercent: z.number().default(80),
  })
  export type BudgetConfig = z.infer<typeof BudgetConfig>

  // ── Debate config ─────────────────────────────────────────────────────────

  export const DebateConfig = z.object({
    question: z.string().min(1),
    context: z.string().optional(),
    tier: DebateTier.default("quick"),
    participants: z
      .array(
        z.object({
          providerID: ProviderID.zod,
          modelID: ModelID.zod,
          role: z.string().optional(),
        }),
      )
      .optional(),
    budget: BudgetConfig.optional(),
    judgeProviderID: ProviderID.zod.optional(),
    judgeModelID: ModelID.zod.optional(),
    redTeam: z.enum(["off", "auto", "always"]).default("auto"),
    enableMeta: z.boolean().default(true),
    enableCanary: z.boolean().default(false),
    enableShadowBaseline: z.boolean().default(true),
    noMemory: z.boolean().default(false),
    maxRounds: z.number().default(2),
    roles: z.record(z.string(), z.string()).optional(),
  })
  export type DebateConfig = z.infer<typeof DebateConfig>

  // ── Value metrics ─────────────────────────────────────────────────────────

  export const ValueMetrics = z.object({
    blindSpotCount: z.number(),
    coverageDimensionality: z.number(),
    hallucinationReduction: z.number().optional(),
    costPerValidInsight: z.number().optional(),
    userActionRate: z.number().optional(),
  })
  export type ValueMetrics = z.infer<typeof ValueMetrics>

  // ── Report metadata ───────────────────────────────────────────────────────

  export const ReportMeta = z.object({
    fragility: z.number().min(0).max(1),
    haltingAnalysis: z.string().optional(),
    canaryDetected: z.boolean().optional(),
    diversityScore: z.number().optional(),
  })
  export type ReportMeta = z.infer<typeof ReportMeta>

  // ── Traceability ──────────────────────────────────────────────────────────

  export const Traceability = z.object({
    provider: z.string(),
    claimIds: z.array(z.string()),
  })
  export type Traceability = z.infer<typeof Traceability>

  // ── Debate report ─────────────────────────────────────────────────────────

  export const DebateReport = z.object({
    id: DebateID.zod,
    prompt: z.string(),
    timestamp: z.string(),
    tier: DebateTier,
    providers: z.array(z.string()),
    failedProviders: z.array(z.object({ provider: z.string(), error: z.string() })).default([]),
    roles: z.record(z.string(), z.string()),
    cost: z.number(),
    durationMs: z.number(),
    consensus: z.array(Claim),
    blindSpots: z.array(Claim),
    unresolvedConflicts: z.array(UnresolvedConflict),
    traceability: z.array(Traceability),
    meta: ReportMeta.optional(),
    valueMetrics: ValueMetrics.optional(),
    tokenUsage: z.object({
      total: z.number(),
      byPhase: z.record(z.string(), z.number()),
      byProvider: z.record(z.string(), z.number()),
    }),
    markdown: z.string(),
    shadowBaselineDelta: z
      .object({
        blindSpotDelta: z.number(),
        coverageDelta: z.number(),
      })
      .optional(),
  })
  export type DebateReport = z.infer<typeof DebateReport>

  // ── Streaming events (TUI) ────────────────────────────────────────────────

  export type DebateEvent =
    | { type: "phase_changed"; phase: DebateStatus }
    | { type: "provider_started"; provider: string; role?: string }
    | { type: "provider_completed"; provider: string; tokens: number; durationMs: number }
    | { type: "provider_failed"; provider: string; error: string }
    | { type: "claim_extracted"; claim: Claim }
    | { type: "cost_update"; spent: number; budget: number; percent: number }
    | { type: "red_team_activated"; reason: string }
    | { type: "convergence_round"; round: number; claimsResubmitted: number }
    | { type: "canary_result"; detected: boolean }
    | { type: "halting"; reason: string; marginalGain: number; marginalCost: number }
    | { type: "debate_complete"; report: DebateReport }

  // ── Tier configuration ────────────────────────────────────────────────────

  export const TIER_CONFIG: Record<
    DebateTier,
    {
      maxProviders: number
      phases: DebateStatus[]
      redTeam: "off" | "auto" | "always"
      enableMeta: boolean
      enableCanary: boolean
      cosineSimilarityThreshold: number
      maxConvergenceRounds: number
      budgetDefaults: { maxTotalTokens: number; maxCostUsd: number }
    }
  > = {
    free: {
      maxProviders: 3,
      phases: ["phase1_diverge", "phase4_synthesize"],
      redTeam: "off",
      enableMeta: false,
      enableCanary: false,
      cosineSimilarityThreshold: 1.0,
      maxConvergenceRounds: 0,
      budgetDefaults: { maxTotalTokens: 50_000, maxCostUsd: 0 },
    },
    quick: {
      maxProviders: 3,
      phases: ["phase1_diverge", "phase2_extract", "phase4_synthesize"],
      redTeam: "off",
      enableMeta: false,
      enableCanary: false,
      cosineSimilarityThreshold: 1.0,
      maxConvergenceRounds: 0,
      budgetDefaults: { maxTotalTokens: 200_000, maxCostUsd: 0.5 },
    },
    standard: {
      maxProviders: 5,
      phases: ["phase1_diverge", "phase2_extract", "phase3_converge", "phase4_synthesize"],
      redTeam: "auto",
      enableMeta: true,
      enableCanary: false,
      cosineSimilarityThreshold: 0.85,
      maxConvergenceRounds: 2,
      budgetDefaults: { maxTotalTokens: 500_000, maxCostUsd: 3.0 },
    },
    deep: {
      maxProviders: 8,
      phases: ["phase1_diverge", "phase2_extract", "phase3_converge", "phase4_synthesize"],
      redTeam: "always",
      enableMeta: true,
      enableCanary: true,
      cosineSimilarityThreshold: 0.75,
      maxConvergenceRounds: 3,
      budgetDefaults: { maxTotalTokens: 1_500_000, maxCostUsd: 15.0 },
    },
  }
}
