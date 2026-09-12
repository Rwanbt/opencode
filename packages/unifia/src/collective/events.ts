import z from "zod"
import { BusEvent } from "../bus/bus-event"
import { Collective } from "./types"

export const DebateStarted = BusEvent.define(
  "collective.debate.started",
  z.object({
    debateID: Collective.DebateID.zod,
    tier: Collective.DebateTier,
    providers: z.array(z.string()),
  }),
)

export const DebatePhaseChanged = BusEvent.define(
  "collective.debate.phase_changed",
  z.object({
    debateID: Collective.DebateID.zod,
    phase: Collective.DebateStatus,
  }),
)

// `phase` distinguishes which debate phase a participant event belongs to
// (Phase 1 diverge, Phase 2 extract, Phase 3 converge, Phase 4 synthesize,
// plus canary generation which runs before phase1_diverge). Required so the
// TUI can render a live per-phase participant list instead of a single
// generic spinner (see tool/debate.ts).
export const ProviderStarted = BusEvent.define(
  "collective.provider.started",
  z.object({
    debateID: Collective.DebateID.zod,
    provider: z.string(),
    role: z.string().optional(),
    phase: Collective.DebateStatus,
  }),
)

export const ProviderCompleted = BusEvent.define(
  "collective.provider.completed",
  z.object({
    debateID: Collective.DebateID.zod,
    provider: z.string(),
    tokens: z.number(),
    durationMs: z.number(),
    phase: Collective.DebateStatus,
  }),
)

export const ProviderFailed = BusEvent.define(
  "collective.provider.failed",
  z.object({
    debateID: Collective.DebateID.zod,
    provider: z.string(),
    error: z.string(),
    phase: Collective.DebateStatus,
  }),
)

export const ClaimExtracted = BusEvent.define(
  "collective.claim.extracted",
  z.object({
    debateID: Collective.DebateID.zod,
    claimId: z.string(),
    category: z.string(),
    novelty: z.string(),
  }),
)

export const CostUpdate = BusEvent.define(
  "collective.cost.update",
  z.object({
    debateID: Collective.DebateID.zod,
    spent: z.number(),
    budget: z.number(),
    percent: z.number(),
  }),
)

export const RedTeamActivated = BusEvent.define(
  "collective.redteam.activated",
  z.object({
    debateID: Collective.DebateID.zod,
    reason: z.string(),
  }),
)

export const ConvergenceRound = BusEvent.define(
  "collective.convergence.round",
  z.object({
    debateID: Collective.DebateID.zod,
    round: z.number(),
    claimsResubmitted: z.number(),
  }),
)

export const CanaryResult = BusEvent.define(
  "collective.canary.result",
  z.object({
    debateID: Collective.DebateID.zod,
    detected: z.boolean(),
  }),
)

export const HaltingDecision = BusEvent.define(
  "collective.halting",
  z.object({
    debateID: Collective.DebateID.zod,
    reason: z.string(),
    marginalGain: z.number(),
    marginalCost: z.number(),
  }),
)

export const DebateCompleted = BusEvent.define(
  "collective.debate.completed",
  z.object({
    debateID: Collective.DebateID.zod,
    blindSpotCount: z.number(),
    cost: z.number(),
    durationMs: z.number(),
  }),
)

export const DebateFailed = BusEvent.define(
  "collective.debate.failed",
  z.object({
    debateID: Collective.DebateID.zod,
    error: z.string(),
  }),
)

export const DebateBudgetWarning = BusEvent.define(
  "collective.debate.budget_warning",
  z.object({
    debateID: Collective.DebateID.zod,
    percentUsed: z.number(),
    tokensUsed: z.number(),
    tokenLimit: z.number(),
  }),
)
