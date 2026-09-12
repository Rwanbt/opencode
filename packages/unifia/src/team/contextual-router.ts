export const CONTEXTUAL_ROUTER_VERSION = "1.0.0" as const

const RISK_LEVELS = ["TRIVIAL", "STANDARD", "CRITICAL"] as const
const ROUTING_MODES = ["rules_fallback", "learned", "exploration"] as const

export const ContextualRouterInputError = new Error("Contextual router input is invalid")

export type ContextRiskLevel = (typeof RISK_LEVELS)[number]
export type ContextualRoutingMode = (typeof ROUTING_MODES)[number]

export interface ContextFeatureVector {
  readonly domain: string
  readonly taskKind: string
  readonly riskLevel: ContextRiskLevel
  readonly expectedInputTokens: number
  readonly expectedOutputTokens: number
  readonly baselineConfidence: number
  readonly learnedConfidence: number
  readonly driftScore: number
}

export interface ContextualCandidate {
  readonly endpointKey: string
  readonly learnedScore: number
}

export interface OfflineRoutingEvaluation {
  readonly baselineReward: number
  readonly learnedReward: number
  readonly sampleCount: number
}

export interface ContextualRouterConfig {
  readonly minConfidence: number
  readonly maxRegression: number
  readonly maxDriftScore: number
  readonly minOfflineSamples: number
  readonly killSwitch: boolean
}

export const DEFAULT_CONTEXTUAL_ROUTER_CONFIG: ContextualRouterConfig = Object.freeze({
  minConfidence: 0.8,
  maxRegression: 0.02,
  maxDriftScore: 0.2,
  minOfflineSamples: 20,
  killSwitch: false,
})

export interface ContextualRouteInput {
  readonly context: ContextFeatureVector
  readonly baselineEndpointKey: string
  readonly learnedCandidate: ContextualCandidate | null
  readonly explorationEndpointKey?: string | null
  readonly explorationRequested?: boolean
  readonly offlineEvaluation: OfflineRoutingEvaluation | null
  readonly config?: ContextualRouterConfig
}

export interface ContextualRouteDecision {
  readonly routerVersion: typeof CONTEXTUAL_ROUTER_VERSION
  readonly endpointKey: string
  readonly mode: ContextualRoutingMode
  readonly confidence: number
  readonly reason: string
  readonly explorationAllowed: boolean
  readonly driftDetected: boolean
}

function requireUnitInterval(value: number, entity: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${ContextualRouterInputError.message}: ${entity}`)
}

function validateInput(input: ContextualRouteInput): void {
  const { context } = input
  if (!context.domain || !context.taskKind || !RISK_LEVELS.includes(context.riskLevel)) {
    throw new Error(`${ContextualRouterInputError.message}: context`)
  }
  if (!Number.isInteger(context.expectedInputTokens) || context.expectedInputTokens < 0) {
    throw new Error(`${ContextualRouterInputError.message}: expectedInputTokens`)
  }
  if (!Number.isInteger(context.expectedOutputTokens) || context.expectedOutputTokens < 0) {
    throw new Error(`${ContextualRouterInputError.message}: expectedOutputTokens`)
  }
  requireUnitInterval(context.baselineConfidence, "baselineConfidence")
  requireUnitInterval(context.learnedConfidence, "learnedConfidence")
  requireUnitInterval(context.driftScore, "driftScore")
  if (!input.baselineEndpointKey) throw new Error(`${ContextualRouterInputError.message}: baselineEndpointKey`)
  if (input.learnedCandidate !== null) {
    if (!input.learnedCandidate.endpointKey) throw new Error(`${ContextualRouterInputError.message}: learnedCandidate`)
    requireUnitInterval(input.learnedCandidate.learnedScore, "learnedScore")
  }
  if (input.offlineEvaluation !== null) {
    requireUnitInterval(input.offlineEvaluation.baselineReward, "baselineReward")
    requireUnitInterval(input.offlineEvaluation.learnedReward, "learnedReward")
    if (!Number.isInteger(input.offlineEvaluation.sampleCount) || input.offlineEvaluation.sampleCount < 0) {
      throw new Error(`${ContextualRouterInputError.message}: sampleCount`)
    }
  }
}
function fallbackDecision(
  input: ContextualRouteInput,
  confidence: number,
  reason: string,
  driftDetected: boolean,
  explorationAllowed: boolean,
): ContextualRouteDecision {
  return {
    routerVersion: CONTEXTUAL_ROUTER_VERSION,
    endpointKey: input.baselineEndpointKey,
    mode: "rules_fallback",
    confidence,
    reason,
    explorationAllowed,
    driftDetected,
  }
}

export function routeContextually(input: ContextualRouteInput): ContextualRouteDecision {
  validateInput(input)
  const config = input.config ?? DEFAULT_CONTEXTUAL_ROUTER_CONFIG
  requireUnitInterval(config.minConfidence, "minConfidence")
  requireUnitInterval(config.maxRegression, "maxRegression")
  requireUnitInterval(config.maxDriftScore, "maxDriftScore")
  if (!Number.isInteger(config.minOfflineSamples) || config.minOfflineSamples < 0) {
    throw new Error(`${ContextualRouterInputError.message}: minOfflineSamples`)
  }
  const { context } = input
  const explorationAllowed = context.riskLevel === "TRIVIAL" && context.driftScore <= config.maxDriftScore
  const driftDetected = context.driftScore > config.maxDriftScore

  if (config.killSwitch) return fallbackDecision(input, context.baselineConfidence, "kill switch enabled", driftDetected, explorationAllowed)
  if (driftDetected) return fallbackDecision(input, context.baselineConfidence, "context drift exceeds threshold", true, explorationAllowed)
  if (context.baselineConfidence < config.minConfidence || context.learnedConfidence < config.minConfidence) {
    return fallbackDecision(input, Math.min(context.baselineConfidence, context.learnedConfidence), "confidence below threshold", false, explorationAllowed)
  }
  if (!input.offlineEvaluation || input.offlineEvaluation.sampleCount < config.minOfflineSamples) {
    return fallbackDecision(input, context.baselineConfidence, "offline evidence is insufficient", false, explorationAllowed)
  }
  const regression = input.offlineEvaluation.baselineReward - input.offlineEvaluation.learnedReward
  if (regression > config.maxRegression) {
    return fallbackDecision(input, context.learnedConfidence, "offline evaluation exceeds regression threshold", false, explorationAllowed)
  }
  if (input.explorationRequested && explorationAllowed && input.explorationEndpointKey) {
    return {
      routerVersion: CONTEXTUAL_ROUTER_VERSION,
      endpointKey: input.explorationEndpointKey,
      mode: "exploration",
      confidence: context.learnedConfidence,
      reason: "low-risk exploration is enabled",
      explorationAllowed,
      driftDetected: false,
    }
  }
  if (!input.learnedCandidate) return fallbackDecision(input, context.baselineConfidence, "no learned candidate is available", false, explorationAllowed)
  return {
    routerVersion: CONTEXTUAL_ROUTER_VERSION,
    endpointKey: input.learnedCandidate.endpointKey,
    mode: "learned",
    confidence: context.learnedConfidence,
    reason: "learned route passed offline and safety gates",
    explorationAllowed,
    driftDetected: false,
  }
}
