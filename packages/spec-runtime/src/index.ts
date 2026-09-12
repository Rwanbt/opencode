/* SPDX-License-Identifier: MIT */

/**
 * SpecRuntime — Plan V3 section 25 (spec-driven development and OpenDesign).
 *
 * The load-bearing requirement of that section is one sentence: *une spec ne
 * peut pas élargir les permissions du workspace*. A spec is authored content —
 * often authored by a model — so if declaring a capability granted it, a spec
 * would be a privilege-escalation primitive. Everything else here exists to
 * make that boundary explicit and auditable.
 *
 * SCOPE — what this package deliberately does NOT do, so the gap is not
 * mistaken for an oversight:
 *
 * - **No code generation.** ADR-0017 sketches `generateCode(spec, target)`.
 *   Deriving code from a spec is a product in its own right, and shipping a
 *   half-generator would create a second authority over the codebase.
 * - **No diagram import/export.** Mermaid, draw.io and Excalidraw round-trips
 *   need format parsers that are a supply-chain decision, not a coding task.
 * - **JSON specs only.** ADR-0017 assumes YAML. Adding a YAML parser means
 *   adding a third-party dependency, which this repo gates on provenance
 *   review. JSON needs no dependency and the schema is identical, so the format
 *   choice is deferred rather than smuggled in.
 */

import type { ArtifactInput } from "@unifia/artifact-runtime"

export type SpecTarget = "code" | "work" | "design" | "automate"
export const SPEC_TARGETS = ["code", "work", "design", "automate"] as const

export type SpecRule = { id: string; statement: string }

export type DesignTokens = {
  colors?: Record<string, string>
  spacing?: Record<string, number>
  typography?: Record<string, string>
}

export type Spec = {
  id: string
  version: string
  target: SpecTarget
  title: string
  /** Capabilities the spec *requests*. Requesting is not receiving. */
  capabilities: readonly string[]
  rules: readonly SpecRule[]
  tokens?: DesignTokens
}

export type CapabilityResolution = {
  /** Strictly a subset of what the workspace already grants. */
  granted: readonly string[]
  /** Requested but not granted. Never silently dropped: reported and auditable. */
  denied: readonly string[]
}

export type SpecAudit = { record(specId: string, capability: string, decision: "allow" | "deny"): unknown }

export type InjectedRule = { specId: string; specVersion: string; ruleId: string; statement: string }

export class SpecValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SpecValidationError"
  }
}

const ID = /^[a-z][a-z0-9-]{2,63}$/
const VERSION = /^\d+\.\d+\.\d+$/
const CAPABILITY = /^[a-z][a-z0-9._-]{1,63}$/
const COLOR = /^#[0-9a-f]{6}$/i
const TOKEN_NAME = /^[a-z][a-z0-9-]{0,31}$/
const TARGETS: ReadonlySet<string> = new Set<SpecTarget>(SPEC_TARGETS)
const MAX_RULES = 256
const MAX_STATEMENT_LENGTH = 2048

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Parses and validates an untrusted spec document.
 *
 * @throws SpecValidationError — a spec that does not validate is refused
 * outright rather than partially applied, because a half-applied spec injects
 * rules whose provenance nobody can reconstruct.
 */
export function parseSpec(source: string | unknown): Spec {
  let value: unknown
  if (typeof source === "string") {
    try {
      value = JSON.parse(source)
    } catch {
      throw new SpecValidationError("spec is not valid JSON")
    }
  } else {
    value = source
  }
  if (!isRecord(value)) throw new SpecValidationError("spec must be an object")
  const { id, version, target, title } = value
  if (typeof id !== "string" || !ID.test(id)) throw new SpecValidationError("spec id must be kebab-case")
  if (typeof version !== "string" || !VERSION.test(version)) throw new SpecValidationError("spec version must be semver")
  if (typeof target !== "string" || !TARGETS.has(target)) throw new SpecValidationError("spec target must be code, work, design or automate")
  if (typeof title !== "string" || title.trim().length === 0) throw new SpecValidationError("spec title is required")
  return {
    id,
    version,
    target: target as SpecTarget,
    title,
    capabilities: parseCapabilities(value.capabilities),
    rules: parseRules(value.rules),
    tokens: value.tokens === undefined ? undefined : parseTokens(value.tokens),
  }
}

function parseCapabilities(value: unknown): readonly string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !CAPABILITY.test(entry))) {
    throw new SpecValidationError("spec capabilities must be capability identifiers")
  }
  return [...new Set(value as string[])]
}

function parseRules(value: unknown): readonly SpecRule[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_RULES) throw new SpecValidationError("spec rules must be an array within the size limit")
  const seen = new Set<string>()
  return value.map((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || !ID.test(entry.id)) throw new SpecValidationError("spec rule id must be kebab-case")
    if (typeof entry.statement !== "string" || entry.statement.trim().length === 0 || entry.statement.length > MAX_STATEMENT_LENGTH) {
      throw new SpecValidationError(`spec rule ${entry.id} has an empty or oversized statement`)
    }
    if (seen.has(entry.id)) throw new SpecValidationError(`duplicate spec rule id: ${entry.id}`)
    seen.add(entry.id)
    return { id: entry.id, statement: entry.statement }
  })
}

function parseTokens(value: unknown): DesignTokens {
  if (!isRecord(value)) throw new SpecValidationError("spec tokens must be an object")
  const tokens: DesignTokens = {}
  if (value.colors !== undefined) tokens.colors = parseTokenMap(value.colors, "colors", (entry) => typeof entry === "string" && COLOR.test(entry)) as Record<string, string>
  if (value.typography !== undefined) tokens.typography = parseTokenMap(value.typography, "typography", (entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 128) as Record<string, string>
  if (value.spacing !== undefined) tokens.spacing = parseTokenMap(value.spacing, "spacing", (entry) => typeof entry === "number" && Number.isFinite(entry) && entry >= 0) as Record<string, number>
  return tokens
}

function parseTokenMap(value: unknown, group: string, valid: (entry: unknown) => boolean): Record<string, unknown> {
  if (!isRecord(value)) throw new SpecValidationError(`spec ${group} tokens must be an object`)
  const result: Record<string, unknown> = {}
  for (const [name, entry] of Object.entries(value)) {
    // WHY names are constrained: tokens end up in generated documents and
    // stylesheets, so an unconstrained name is an injection surface.
    if (!TOKEN_NAME.test(name)) throw new SpecValidationError(`invalid ${group} token name: ${name}`)
    if (!valid(entry)) throw new SpecValidationError(`invalid ${group} token value for ${name}`)
    result[name] = entry
  }
  return result
}

/**
 * Intersects what a spec asks for with what the workspace already grants.
 *
 * This is the whole security point of the phase. The result is computed by
 * intersection, never union, so there is no code path along which a spec can
 * add a capability. Denials are returned and audited rather than dropped,
 * because a silently ignored request is indistinguishable from a granted one
 * at the call site.
 */
export function resolveEffectiveCapabilities(spec: Spec, workspaceGrant: Iterable<string>, audit?: SpecAudit): CapabilityResolution {
  const grant = new Set(workspaceGrant)
  const granted: string[] = []
  const denied: string[] = []
  for (const capability of spec.capabilities) {
    const allowed = grant.has(capability)
    ;(allowed ? granted : denied).push(capability)
    audit?.record(spec.id, capability, allowed ? "allow" : "deny")
  }
  return { granted, denied }
}

/**
 * Returns the spec's rules carrying their origin.
 *
 * Plan section 25 requires rule injection to be *visible and auditable*. A bare
 * list of statements is neither: once merged into a prompt nobody can say which
 * spec and version produced a given instruction, so provenance travels with
 * each rule.
 */
export function injectedRules(spec: Spec): readonly InjectedRule[] {
  return spec.rules.map((rule) => ({ specId: spec.id, specVersion: spec.version, ruleId: rule.id, statement: rule.statement }))
}

/**
 * Flattens tokens for a document pack, prefixed by group so names cannot collide.
 *
 * The prefixes are the contract with `applyDesignTokens` in
 * `@unifia/document-packs`, which is what actually places them into a package.
 * Until that existed this function's output went nowhere — it was imported by
 * nothing but its own test, which is how "document packs can consume design
 * tokens" looked delivered while no pack consumed anything.
 */
export function resolveDesignTokens(spec: Spec): Record<string, string> {
  const tokens = spec.tokens ?? {}
  const flattened: Record<string, string> = {}
  for (const [name, value] of Object.entries(tokens.colors ?? {})) flattened[`color.${name}`] = value
  for (const [name, value] of Object.entries(tokens.typography ?? {})) flattened[`typography.${name}`] = value
  for (const [name, value] of Object.entries(tokens.spacing ?? {})) flattened[`spacing.${name}`] = String(value)
  return flattened
}

export type SpecReview = { specId: string; reviewer: string; verdict: "approved" | "changes-requested"; findings: readonly string[] }

/**
 * Turns a design review into an artefact input.
 *
 * Plan section 25 requires design reviewers to produce ArtifactVersions: a
 * review that lives only in a chat log cannot be versioned, diffed or exported.
 */
export function reviewToArtifactInput(review: SpecReview): ArtifactInput {
  if (!ID.test(review.specId)) throw new SpecValidationError("review references an invalid spec id")
  const body = [`# Design review — ${review.specId}`, "", `Reviewer: ${review.reviewer}`, `Verdict: ${review.verdict}`, "", ...review.findings.map((finding) => `- ${finding}`), ""].join("\n")
  return { kind: "text", filename: `review-${review.specId}.md`, content: body, metadata: { specId: review.specId, verdict: review.verdict, reviewer: review.reviewer } }
}
