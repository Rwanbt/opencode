/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * V1 WorkflowDefinition shape, as captured by `workflow-runtime` (legacy
 * package) before the V2.3.1 IR redesign.
 *
 * Per ADR-017 §70-84, a V1 workflow was a flat list of `steps` with
 * implicit sequential execution, no edges, no typed node families, and
 * a `requiresApproval: boolean` flag on each step. The migration tool
 * reads this shape and produces a V2 `WorkflowDefinition` (ADR-002 +
 * `@unifia/contracts/workflow-ir.ts`) with explicit nodes, edges, and
 * a `human.approval` node family wherever V1 set the flag.
 *
 * This file is the **contract** — what the V1 authority used to emit
 * and what an archived V1 fixture is expected to contain. The runtime
 * V1 emitter is *out of scope* (legacy `workflow-runtime` package,
 * post-cutover dark).
 */

import { z } from "zod"

/**
 * The set of capability strings V1 understood. We do not model every
 * field of the legacy `Capability` union; we only need the discriminator
 * for the V1 → V2 mapping (step → node family). Anything outside this
 * set is `unsupported` and the migrator refuses it.
 */
export const V1_CAPABILITY_KINDS = [
  "http",
  "shell",
  "openapi",
  "approval",
  "wait",
  "schedule",
  "manual",
] as const

export const V1CapabilityKindSchema = z.enum(V1_CAPABILITY_KINDS)
export type V1CapabilityKind = z.infer<typeof V1CapabilityKindSchema>

/**
 * A V1 step. One capability, one input, optional `requiresApproval`
 * flag. Inputs are untyped JSON in V1; the migrator treats them as
 * `unknown` and emits a CEL binding of the form `step.input` (ADR-003).
 */
export const V1StepSchema = z.object({
  id: z.string().min(1, "v1: step id must be non-empty"),
  capability: V1CapabilityKindSchema,
  input: z.unknown(),
  requiresApproval: z.boolean().default(false),
})
export type V1Step = z.infer<typeof V1StepSchema>
/** Input shape accepted by `V1StepSchema.parse`. `requiresApproval` is
 * optional in input (defaults to `false`). */
export type V1StepInput = z.input<typeof V1StepSchema>

/**
 * A V1 `WorkflowDefinition`. Top-level identity + workspace + ordered
 * step list. No explicit edges (sequential by default). No policies
 * (V1 had global defaults; see `V1_GLOBAL_DEFAULTS`).
 */
export const V1WorkflowDefinitionSchema = z.object({
  id: z.string().min(1, "v1: workflow id must be non-empty"),
  version: z
    .union([z.number().int().positive(), z.string().min(1)])
    .describe("V1 accepted either an int or a semver-like string"),
  workspaceId: z.string().min(1, "v1: workspaceId must be non-empty"),
  steps: z.array(V1StepSchema).min(1, "v1: at least one step is required"),
})
export type V1WorkflowDefinition = z.infer<typeof V1WorkflowDefinitionSchema>
/** Input shape accepted by `V1WorkflowDefinitionSchema.parse`. */
export type V1WorkflowDefinitionInput = z.input<typeof V1WorkflowDefinitionSchema>

/**
 * V1 global defaults that the migrator lifts into the V2 `policies`
 * block. Kept here as constants, not in the schema, because they were
 * not present in the V1 fixture itself.
 */
export const V1_GLOBAL_DEFAULTS = {
  /** V1 ran every step exactly once, with a single attempt. */
  maxAttempts: 1,
  /** V1 had no backoff. */
  backoff: "none" as const,
  /** V1 supported only `none` (no concurrency limit) and `group`. */
  concurrency: "none" as const,
  /** V1 retention: 30 days. */
  retentionDays: 30,
} as const

/**
 * Result of parsing a V1 fixture. A successful parse + the parsed
 * object. Errors carry line-level diagnostics when source is JSON or
 * YAML (parser not bundled; consumers are expected to feed already-
 * parsed objects to the migrator).
 */
export const V1ParseResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: V1WorkflowDefinitionSchema }),
  z.object({
    ok: z.literal(false),
    issues: z.array(
      z.object({
        path: z.string(),
        message: z.string(),
      }),
    ),
  }),
])
export type V1ParseResult = z.infer<typeof V1ParseResultSchema>
