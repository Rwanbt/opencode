export type RequirementSource = "explicit" | "inferred"
export type ResolutionKind = "QUESTION" | "CONSTRAINT" | "GATE"
export type ExternalActionKind = "network" | "publish" | "delete" | "deploy" | "message" | "payment" | "unknown"

export interface IntakeInput {
  readonly objective: string
  readonly knownConstraints?: readonly string[]
  readonly irreversibleActions?: readonly string[]
}

export interface TaskRequirement {
  readonly id: string
  readonly statement: string
  readonly source: RequirementSource
}

export interface IntakeAmbiguity {
  readonly id: string
  readonly question: string
  readonly resolution: ResolutionKind
}

export interface ExternalAction {
  readonly id: string
  readonly kind: ExternalActionKind
  readonly description: string
  readonly requiresHumanApproval: true
}

export interface FrozenConstraint {
  readonly id: string
  readonly statement: string
  readonly source: "input" | "safety"
}

export interface TaskRequirements {
  readonly objective: string
  readonly requirements: readonly TaskRequirement[]
  readonly ambiguities: readonly IntakeAmbiguity[]
  readonly externalActions: readonly ExternalAction[]
  readonly frozenConstraints: readonly FrozenConstraint[]
}

const AMBIGUITY_MARKERS = ["maybe", "perhaps", "should", "etc", "as soon as", "best", "quickly"] as const
const ACTION_PATTERNS: readonly [ExternalActionKind, RegExp][] = [
  ["network", /\b(fetch|request|call|upload|download|network|api)\b/i],
  ["publish", /\b(publish|push|release)\b/i],
  ["delete", /\b(delete|remove|erase|drop)\b/i],
  ["deploy", /\b(deploy|ship|production)\b/i],
  ["message", /\b(email|message|notify|slack|send)\b/i],
  ["payment", /\b(pay|payment|purchase|charge)\b/i],
]

function assertObjective(objective: string): void {
  if (objective.trim().length === 0) throw new TypeError("objective must not be empty")
}

function sentences(objective: string): readonly string[] {
  return objective.split(/[.!?\n]+/).map((part) => part.trim()).filter(Boolean)
}

function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)]
}

export function buildTaskRequirements(input: IntakeInput): TaskRequirements {
  assertObjective(input.objective)
  const objective = input.objective.trim()
  const parts = sentences(objective)
  const requirements = parts.map((statement, index) => ({ id: `REQ-${index + 1}`, statement, source: "explicit" as const }))
  const ambiguities: IntakeAmbiguity[] = []
  for (const marker of AMBIGUITY_MARKERS) {
    if (objective.toLowerCase().includes(marker)) ambiguities.push({ id: `AMB-${ambiguities.length + 1}`, question: `What exact meaning and acceptance criterion should replace “${marker}” in the objective?`, resolution: "QUESTION" })
  }
  const externalActions: ExternalAction[] = []
  for (const [kind, pattern] of ACTION_PATTERNS) {
    if (pattern.test(objective) || input.irreversibleActions?.some((action) => pattern.test(action))) {
      externalActions.push({ id: `EXT-${externalActions.length + 1}`, kind, description: `Objective requests a ${kind} action and must not execute it implicitly.`, requiresHumanApproval: true })
    }
  }
  for (const action of input.irreversibleActions ?? []) {
    const recognized = ACTION_PATTERNS.some(([, pattern]) => pattern.test(action))
    if (!recognized) {
      externalActions.push({ id: `EXT-${externalActions.length + 1}`, kind: "unknown", description: `Irreversible action requires human approval: ${action}`, requiresHumanApproval: true })
    }
  }
  if (externalActions.length > 0) ambiguities.push({ id: `AMB-${ambiguities.length + 1}`, question: "Which human approval and target scope authorize each external action?", resolution: "GATE" })
  const frozenConstraints = unique([...(input.knownConstraints ?? []), ...(externalActions.length > 0 ? ["External actions require explicit human approval before execution."] : [])]).map((statement, index) => ({ id: `CON-${index + 1}`, statement, source: externalActions.length > 0 && statement.startsWith("External actions") ? "safety" as const : "input" as const }))
  return { objective, requirements, ambiguities, externalActions, frozenConstraints }
}
