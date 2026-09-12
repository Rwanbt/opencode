/**
 * multi-model/prompt-registry.ts — TEAM-B04
 *
 * Centralized, versioned prompt registry.
 *
 * Every prompt template used anywhere in the multi-model layer must be
 * registered here under an explicit, mandatory `version`. This module never
 * infers a version, never defaults a missing version, and never returns a
 * fallback prompt for an unknown id/version — callers get a typed error
 * instead, so prompt drift is impossible to introduce silently.
 *
 * Design decisions (see B04 handoff doc for full rationale):
 *   - Content hash: SHA-256 hex digest over a canonical, fixed-key-order
 *     JSON encoding of {id, version, template, description}. Because the
 *     canonical object is rebuilt field-by-field (not `JSON.stringify` on
 *     the caller's object directly), the hash is provably independent of
 *     the caller's property insertion order.
 *   - The hash is CONTENT-SENSITIVE, including whitespace. Prompt templates
 *     sent to an LLM are whitespace-significant (indentation, trailing
 *     newlines can shift tokenization/behavior); normalizing whitespace
 *     before hashing would hide real prompt drift, defeating the purpose
 *     of this registry.
 *   - Versions are immutable: registering the same id+version twice with
 *     identical content is an idempotent no-op (returns the existing
 *     record); registering the same id+version with *different* content
 *     throws `PromptVersionConflictError` — never silently overwritten.
 *   - Every successful registration appends one changelog entry per prompt
 *     id (version, previous version, content hashes, mandatory change
 *     note, registration timestamp), giving a full audit trail.
 *   - Unknown id/version lookups fail closed: `get()`/`resolveLatest()`/
 *     `listVersions()`/`getChangelog()` throw `PromptNotFoundError` rather
 *     than returning `null`/`undefined`/a default prompt.
 *
 * Hard constraints (B04 scope manifest):
 *   - Never imports packages/unifia/src/team/** (frozen).
 *   - Never imports packages/unifia/src/collective/** (frozen).
 *   - Never imports packages/unifia/src/model-intelligence/** (frozen,
 *     different domain, concurrently touched by other workers).
 *   - Does not import B01/B02/B03 multi-model modules — this card is
 *     self-contained (no genuine need to reuse ModelRef/versionCompare/etc.
 *     from ./types, ./model-ref, ./provider-discovery).
 */

import { createHash } from "node:crypto"
import { NamedError } from "@unifia/util/error"
import z from "zod"

// ---------------------------------------------------------------------------
// Id / version shape validation
// ---------------------------------------------------------------------------

/** Lowercase, starts with a letter, [a-z0-9_.:-], max 128 chars. */
const PROMPT_ID_PATTERN = /^[a-z][a-z0-9_.:-]{0,127}$/

/**
 * Strict MAJOR.MINOR.PATCH semver (no pre-release/build metadata). Kept
 * strict on purpose: prompt versions must sort unambiguously and mandatory
 * version enforcement must not have a "did they mean 1.0 or 1.0.0" escape
 * hatch.
 */
const PROMPT_VERSION_PATTERN = /^\d+\.\d+\.\d+$/

// ---------------------------------------------------------------------------
// Typed errors (NamedError convention, matches model-intelligence/errors.ts
// and multi-model/types.ts)
// ---------------------------------------------------------------------------

export const PromptRegistrationError = NamedError.create(
  "PromptRegistrationError",
  z.object({
    id: z.string().optional(),
    version: z.string().optional(),
    issue: z.string(),
    message: z.string(),
  }),
)

export const PromptNotFoundError = NamedError.create(
  "PromptNotFoundError",
  z.object({
    id: z.string(),
    version: z.string().nullable(),
    message: z.string(),
  }),
)

export const PromptVersionConflictError = NamedError.create(
  "PromptVersionConflictError",
  z.object({
    id: z.string(),
    version: z.string(),
    existingHash: z.string(),
    incomingHash: z.string(),
    message: z.string(),
  }),
)

export const PromptValidationError = NamedError.create(
  "PromptValidationError",
  z.object({
    id: z.string(),
    version: z.string(),
    direction: z.enum(["input", "output"]),
    issue: z.string(),
    message: z.string(),
  }),
)

// ---------------------------------------------------------------------------
// Content hash
// ---------------------------------------------------------------------------

const CONTENT_HASH_ALGORITHM = "sha256" as const

export interface PromptHashInput {
  readonly id: string
  readonly version: string
  readonly template: string
  readonly description: string | null
}

/**
 * Deterministic content hash: same {id, version, template, description}
 * always produces the same hash, regardless of the caller's object key
 * insertion order (the canonical object below is built field-by-field, in
 * a fixed order, rather than serializing the caller's object directly).
 */
export function computePromptContentHash(input: PromptHashInput): string {
  const canonical = JSON.stringify({
    id: input.id,
    version: input.version,
    template: input.template,
    description: input.description ?? null,
  })
  return createHash(CONTENT_HASH_ALGORITHM).update(canonical, "utf8").digest("hex")
}

// ---------------------------------------------------------------------------
// Semver compare (self-contained — strict MAJOR.MINOR.PATCH only)
// ---------------------------------------------------------------------------

function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".").map((s) => Number.parseInt(s, 10))
  const pb = b.split(".").map((s) => Number.parseInt(s, 10))
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na < nb) return -1
    if (na > nb) return 1
  }
  return 0
}

// ---------------------------------------------------------------------------
// Registration envelope (version is mandatory: no `.optional()`, no
// `.default()` — omitting it fails validation and throws
// PromptRegistrationError)
// ---------------------------------------------------------------------------

function isZodSchemaLike(candidate: unknown): candidate is z.ZodType {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof (candidate as { safeParse?: unknown }).safeParse === "function" &&
    typeof (candidate as { parse?: unknown }).parse === "function"
  )
}

/**
 * Validates the full registration envelope in one pass, including
 * `inputSchema`/`outputSchema` (via `z.custom`, since "must be a zod schema
 * instance" cannot be expressed as a plain data shape). Kept `.strict()` so
 * unrecognized extra fields are rejected — a `.strict()` object schema with
 * `inputSchema`/`outputSchema` omitted would reject them as "unknown keys"
 * instead of validating their shape, so they must be declared here.
 */
const PromptEnvelopeSchema = z
  .object({
    id: z.string().regex(PROMPT_ID_PATTERN, "prompt id must be lowercase, start with a letter, match [a-z0-9_.:-], max 128 chars"),
    version: z
      .string()
      .regex(PROMPT_VERSION_PATTERN, "prompt version is mandatory and must be strict semver MAJOR.MINOR.PATCH"),
    template: z.string().min(1, "template must not be empty"),
    description: z.string().optional(),
    inputSchema: z.custom<z.ZodType>(isZodSchemaLike, "inputSchema must be a zod schema exposing parse()/safeParse()"),
    outputSchema: z.custom<z.ZodType>(
      isZodSchemaLike,
      "outputSchema must be a zod schema exposing parse()/safeParse()",
    ),
    changeNote: z.string().min(1, "changeNote is mandatory: describe what changed for the changelog"),
  })
  .strict()

export interface PromptRegistrationInput<Input = unknown, Output = unknown> {
  readonly id: string
  /** Mandatory. Strict semver MAJOR.MINOR.PATCH. Never inferred/defaulted. */
  readonly version: string
  readonly template: string
  readonly description?: string
  readonly inputSchema: z.ZodType<Input>
  readonly outputSchema: z.ZodType<Output>
  /** Mandatory: what changed vs the previous version, for the changelog. */
  readonly changeNote: string
}

// ---------------------------------------------------------------------------
// Records / changelog
// ---------------------------------------------------------------------------

export interface PromptVersionRecord<Input = unknown, Output = unknown> {
  readonly id: string
  readonly version: string
  readonly template: string
  readonly description: string | null
  readonly contentHash: string
  /** ISO 8601 UTC timestamp of registration. */
  readonly registeredAt: string
  readonly inputSchema: z.ZodType<Input>
  readonly outputSchema: z.ZodType<Output>
}

export interface PromptChangelogEntry {
  readonly id: string
  readonly version: string
  readonly previousVersion: string | null
  readonly contentHash: string
  readonly previousContentHash: string | null
  readonly changeNote: string
  readonly registeredAt: string
}

// ---------------------------------------------------------------------------
// Registry interface
// ---------------------------------------------------------------------------

export interface PromptRegistry {
  /**
   * Register a new prompt version. Idempotent no-op if the exact same
   * id+version+content is registered again; throws
   * `PromptVersionConflictError` if the same id+version is registered with
   * different content (versions are immutable once published).
   */
  register<Input = unknown, Output = unknown>(
    input: PromptRegistrationInput<Input, Output>,
  ): PromptVersionRecord<Input, Output>

  /**
   * Fail-closed lookup: throws `PromptNotFoundError` if `id` or `version`
   * is not registered. Never returns a default/fallback prompt.
   */
  get<Input = unknown, Output = unknown>(id: string, version: string): PromptVersionRecord<Input, Output>

  /**
   * Explicit, opt-in "latest version" resolution (highest registered
   * semver for `id`). Distinct from `get()` so "give me whatever is
   * newest" is always a deliberate caller choice, never an implicit
   * fallback from a failed exact lookup. Still fails closed if `id` has no
   * registered versions.
   */
  resolveLatest<Input = unknown, Output = unknown>(id: string): PromptVersionRecord<Input, Output>

  /** All registered versions for `id`, ascending semver order. Fails closed if `id` is unknown. */
  listVersions(id: string): readonly string[]

  /** Full changelog for `id`, in registration order. Fails closed if `id` is unknown. */
  getChangelog(id: string): readonly PromptChangelogEntry[]

  /** Validate `candidate` against the registered inputSchema for id@version. Throws `PromptValidationError` on mismatch. */
  validateInput<Input = unknown>(id: string, version: string, candidate: unknown): Input

  /** Validate `candidate` against the registered outputSchema for id@version. Throws `PromptValidationError` on mismatch. */
  validateOutput<Output = unknown>(id: string, version: string, candidate: unknown): Output
}

export interface PromptRegistryOptions {
  /** Injectable clock for deterministic tests (defaults to `() => new Date()`). */
  readonly clock?: () => Date
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPromptRegistry(options: PromptRegistryOptions = {}): PromptRegistry {
  const clock = options.clock ?? (() => new Date())

  const versionsById = new Map<string, Map<string, PromptVersionRecord<unknown, unknown>>>()
  const changelogById = new Map<string, PromptChangelogEntry[]>()
  const latestVersionById = new Map<string, string>()

  function latestRecordOrNull(id: string): PromptVersionRecord<unknown, unknown> | null {
    const version = latestVersionById.get(id)
    if (!version) return null
    return versionsById.get(id)?.get(version) ?? null
  }

  function register<Input, Output>(
    input: PromptRegistrationInput<Input, Output>,
  ): PromptVersionRecord<Input, Output> {
    const raw = input as unknown as Record<string, unknown>
    const envelope = PromptEnvelopeSchema.safeParse(input)
    if (!envelope.success) {
      throw new PromptRegistrationError({
        id: typeof raw?.["id"] === "string" ? (raw["id"] as string) : undefined,
        version: typeof raw?.["version"] === "string" ? (raw["version"] as string) : undefined,
        issue: envelope.error.message,
        message: "prompt registration failed envelope validation (version is mandatory and must be strict semver)",
      })
    }

    const description = envelope.data.description ?? null
    const contentHash = computePromptContentHash({
      id: envelope.data.id,
      version: envelope.data.version,
      template: envelope.data.template,
      description,
    })

    const existingVersions = versionsById.get(envelope.data.id) ?? new Map<string, PromptVersionRecord<unknown, unknown>>()
    const existing = existingVersions.get(envelope.data.version)
    if (existing) {
      if (existing.contentHash === contentHash) {
        // Identical re-registration: idempotent no-op, not drift.
        return existing as unknown as PromptVersionRecord<Input, Output>
      }
      throw new PromptVersionConflictError({
        id: envelope.data.id,
        version: envelope.data.version,
        existingHash: existing.contentHash,
        incomingHash: contentHash,
        message: `prompt ${envelope.data.id}@${envelope.data.version} is already registered with different content — versions are immutable, bump the version instead`,
      })
    }

    const previous = latestRecordOrNull(envelope.data.id)

    const record: PromptVersionRecord<Input, Output> = {
      id: envelope.data.id,
      version: envelope.data.version,
      template: envelope.data.template,
      description,
      contentHash,
      registeredAt: clock().toISOString(),
      inputSchema: input.inputSchema,
      outputSchema: input.outputSchema,
    }

    existingVersions.set(envelope.data.version, record as unknown as PromptVersionRecord<unknown, unknown>)
    versionsById.set(envelope.data.id, existingVersions)

    if (previous === null || compareSemver(envelope.data.version, previous.version) > 0) {
      latestVersionById.set(envelope.data.id, envelope.data.version)
    }

    const entries = changelogById.get(envelope.data.id) ?? []
    entries.push({
      id: envelope.data.id,
      version: envelope.data.version,
      previousVersion: previous?.version ?? null,
      contentHash,
      previousContentHash: previous?.contentHash ?? null,
      changeNote: envelope.data.changeNote,
      registeredAt: record.registeredAt,
    })
    changelogById.set(envelope.data.id, entries)

    return record
  }

  function get<Input, Output>(id: string, version: string): PromptVersionRecord<Input, Output> {
    const record = versionsById.get(id)?.get(version)
    if (!record) {
      throw new PromptNotFoundError({
        id,
        version,
        message: `prompt ${id}@${version} is not registered — fail-closed policy: no default/fallback returned`,
      })
    }
    return record as unknown as PromptVersionRecord<Input, Output>
  }

  function resolveLatest<Input, Output>(id: string): PromptVersionRecord<Input, Output> {
    const record = latestRecordOrNull(id)
    if (!record) {
      throw new PromptNotFoundError({
        id,
        version: null,
        message: `prompt ${id} has no registered versions — fail-closed policy: no default/fallback returned`,
      })
    }
    return record as unknown as PromptVersionRecord<Input, Output>
  }

  function listVersions(id: string): readonly string[] {
    const versions = versionsById.get(id)
    if (!versions) {
      throw new PromptNotFoundError({ id, version: null, message: `prompt ${id} is not registered` })
    }
    return Array.from(versions.keys()).sort(compareSemver)
  }

  function getChangelog(id: string): readonly PromptChangelogEntry[] {
    const entries = changelogById.get(id)
    if (!entries) {
      throw new PromptNotFoundError({ id, version: null, message: `prompt ${id} is not registered` })
    }
    return entries.slice()
  }

  function validateInput<Input>(id: string, version: string, candidate: unknown): Input {
    const record = get<Input, unknown>(id, version)
    const result = record.inputSchema.safeParse(candidate)
    if (!result.success) {
      throw new PromptValidationError({
        id,
        version,
        direction: "input",
        issue: result.error.message,
        message: `input for prompt ${id}@${version} failed schema validation`,
      })
    }
    return result.data
  }

  function validateOutput<Output>(id: string, version: string, candidate: unknown): Output {
    const record = get<unknown, Output>(id, version)
    const result = record.outputSchema.safeParse(candidate)
    if (!result.success) {
      throw new PromptValidationError({
        id,
        version,
        direction: "output",
        issue: result.error.message,
        message: `output for prompt ${id}@${version} failed schema validation`,
      })
    }
    return result.data
  }

  return {
    register,
    get,
    resolveLatest,
    listVersions,
    getChangelog,
    validateInput,
    validateOutput,
  }
}
