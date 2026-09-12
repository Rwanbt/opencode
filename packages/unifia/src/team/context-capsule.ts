import { createHash } from "node:crypto"

export const CONTEXT_CAPSULE_SCHEMA_VERSION = "1.0.0"
export const DEFAULT_MAX_TOKENS = 20_000
export const DEFAULT_MAX_BYTES = 50 * 1024
const DEFAULT_HANDOFF_SUMMARY_CHARS = 1_200

export interface CapsuleReference { readonly path: string; readonly sha256: string }
export interface HandoffSummary { readonly id: string; readonly summary: string; readonly remaining: readonly string[]; readonly risks: readonly string[] }
export interface ContextCapsuleInput {
  readonly objective: string
  readonly acceptance: readonly string[]
  readonly decisions: readonly string[]
  readonly invariants: readonly string[]
  readonly baseSha: string
  readonly allowedReferences: readonly CapsuleReference[]
  readonly predecessorOutputs: readonly CapsuleReference[]
  readonly toolGrants: readonly string[]
  readonly budget: Readonly<Record<string, number>>
  readonly rollback: readonly string[]
  readonly handoffs: readonly HandoffSummary[]
  readonly artifacts: readonly CapsuleReference[]
}
export interface LossChecklist {
  readonly preservedVerbatim: readonly string[]
  readonly summarized: readonly string[]
  readonly referencedByHash: readonly string[]
  readonly omitted: readonly string[]
  readonly rerouteRequired: boolean
}
export interface ContextCapsule {
  readonly schemaVersion: typeof CONTEXT_CAPSULE_SCHEMA_VERSION
  readonly objective: string
  readonly acceptance: readonly string[]
  readonly decisions: readonly string[]
  readonly invariants: readonly string[]
  readonly baseSha: string
  readonly allowedReferences: readonly CapsuleReference[]
  readonly predecessorOutputs: readonly CapsuleReference[]
  readonly toolGrants: readonly string[]
  readonly budget: Readonly<Record<string, number>>
  readonly rollback: readonly string[]
  readonly handoffs: readonly string[]
  readonly artifacts: readonly CapsuleReference[]
  readonly lossChecklist: LossChecklist
}
export interface CapsuleLimits { readonly maxTokens?: number; readonly maxBytes?: number; readonly handoffSummaryChars?: number }
export interface ContextCapsuleBuildResult {
  readonly status: "BUILT" | "REROUTE_REQUIRED"
  readonly capsule?: ContextCapsule
  readonly serialized?: string
  readonly sha256?: string
  readonly estimatedTokens: number
  readonly byteLength: number
  readonly reasons: readonly string[]
}

export class ContextCapsuleBuilder {
  build(input: ContextCapsuleInput, limits: CapsuleLimits = {}): ContextCapsuleBuildResult {
    validateInput(input)
    const maxTokens = limits.maxTokens ?? DEFAULT_MAX_TOKENS
    const maxBytes = limits.maxBytes ?? DEFAULT_MAX_BYTES
    const handoffSummaryChars = limits.handoffSummaryChars ?? DEFAULT_HANDOFF_SUMMARY_CHARS
    validateLimits(maxTokens, maxBytes, handoffSummaryChars)
    const capsule = createCapsule(input, handoffSummaryChars)
    const serialized = canonicalJson(capsule)
    const byteLength = Buffer.byteLength(serialized, "utf8")
    const estimatedTokens = Math.ceil(serialized.length / 4)
    const reasons = [] as string[]
    if (byteLength > maxBytes) reasons.push(`capsule is ${byteLength} bytes; limit is ${maxBytes}`)
    if (estimatedTokens > maxTokens) reasons.push(`capsule is estimated at ${estimatedTokens} tokens; limit is ${maxTokens}`)
    if (reasons.length > 0) return { status: "REROUTE_REQUIRED", estimatedTokens, byteLength, reasons }
    return { status: "BUILT", capsule, serialized, sha256: digest(serialized), estimatedTokens, byteLength, reasons: [] }
  }
}

function createCapsule(input: ContextCapsuleInput, handoffSummaryChars: number): ContextCapsule {
  return {
    schemaVersion: CONTEXT_CAPSULE_SCHEMA_VERSION,
    objective: input.objective,
    acceptance: [...input.acceptance],
    decisions: [...input.decisions],
    invariants: [...input.invariants],
    baseSha: input.baseSha,
    allowedReferences: sortReferences(input.allowedReferences),
    predecessorOutputs: sortReferences(input.predecessorOutputs),
    toolGrants: [...input.toolGrants].sort(),
    budget: sortRecord(input.budget),
    rollback: [...input.rollback],
    handoffs: input.handoffs.map((handoff) => summarizeHandoff(handoff, handoffSummaryChars)),
    artifacts: sortReferences(input.artifacts),
    lossChecklist: {
      preservedVerbatim: ["objective", "acceptance", "decisions", "invariants", "baseSha", "toolGrants", "budget", "rollback"],
      summarized: ["handoffs"],
      referencedByHash: ["allowedReferences", "predecessorOutputs", "artifacts"],
      omitted: [],
      rerouteRequired: false,
    },
  }
}

function summarizeHandoff(handoff: HandoffSummary, maxChars: number): string {
  const content = [handoff.id, handoff.summary, ...handoff.remaining, ...handoff.risks].join(" | ")
  return content.length <= maxChars ? content : `${content.slice(0, maxChars - 1)}…`
}
function validateInput(input: ContextCapsuleInput): void {
  for (const [field, value] of Object.entries({ objective: input.objective, baseSha: input.baseSha })) if (!value.trim()) throw new TypeError(`${field} must not be empty`)
  for (const field of ["acceptance", "decisions", "invariants", "allowedReferences", "predecessorOutputs", "toolGrants", "rollback", "handoffs", "artifacts"] as const) if (!Array.isArray(input[field])) throw new TypeError(`${field} must be an array`)
  validateStringArray(input.acceptance, "acceptance")
  validateStringArray(input.decisions, "decisions")
  validateStringArray(input.invariants, "invariants")
  validateStringArray(input.toolGrants, "toolGrants")
  validateStringArray(input.rollback, "rollback")
  for (const handoff of input.handoffs) {
    if (!handoff.id.trim() || !handoff.summary.trim()) throw new TypeError("handoff id and summary must not be empty")
    validateStringArray(handoff.remaining, "handoff.remaining")
    validateStringArray(handoff.risks, "handoff.risks")
  }
  validateReferences(input.allowedReferences, "allowedReferences")
  validateReferences(input.predecessorOutputs, "predecessorOutputs")
  validateReferences(input.artifacts, "artifacts")
  if (input.budget === null || typeof input.budget !== "object" || Array.isArray(input.budget)) throw new TypeError("budget must be an object")
  for (const [key, value] of Object.entries(input.budget)) if (!Number.isFinite(value) || value < 0) throw new TypeError(`budget.${key} must be a non-negative number`)
}
function validateStringArray(values: readonly unknown[], field: string): void {
  for (const value of values) if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must contain non-empty strings`)
}
function validateReferences(references: readonly CapsuleReference[], field: string): void {
  for (const reference of references) {
    if (!reference.path.trim()) throw new TypeError(`${field}.path must not be empty`)
    if (!/^[a-f0-9]{64}$/.test(reference.sha256)) throw new TypeError(`${field}.sha256 must be a lowercase SHA-256 digest`)
  }
}
function validateLimits(maxTokens: number, maxBytes: number, handoffSummaryChars: number): void {
  if (!Number.isInteger(maxTokens) || maxTokens <= 0) throw new RangeError("maxTokens must be positive")
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new RangeError("maxBytes must be positive")
  if (!Number.isInteger(handoffSummaryChars) || handoffSummaryChars <= 0) throw new RangeError("handoffSummaryChars must be positive")
}
function sortReferences(references: readonly CapsuleReference[]): readonly CapsuleReference[] {
  return [...references].sort((left, right) => left.path.localeCompare(right.path) || left.sha256.localeCompare(right.sha256))
}
function sortRecord(record: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)))
}
function canonicalJson(value: unknown): string {
  const encoded = JSON.stringify(stableValue(value))
  if (encoded === undefined) throw new TypeError("capsule must be JSON serializable")
  return encoded
}
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stableValue(child)]))
  return value
}
function digest(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex") }
