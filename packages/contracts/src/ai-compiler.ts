/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * AI Compiler contracts (Plan V2.3.1 §222, ADR-002 cross-ref).
 *
 * Defines the interface between Unifia's natural-language workflow
 * editor and the LLM-backed compiler that turns prompts into a
 * WorkflowDefinition. The contracts here are the *shape* of the
 * input / output; the LLM call itself is in the worktree's
 * ai-compiler package (out of scope for contracts).
 *
 * AI-01 — prompt -> IR request envelope.
 * AI-02 — IR validation result (cross-references the canonical
 *         WorkflowDefinitionSchema from workflow-ir.ts so the
 *         validated IR is the *same* type the runtime consumes).
 */
import { z } from "zod"
import { WorkflowDefinitionSchema, type WorkflowDefinition } from "./workflow-ir.js"

/* ------------------------------------------------------------------ */
/* AI-01 — Prompt -> IR request                                       */
/* ------------------------------------------------------------------ */

/**
 * Maximum prompt length. ~32k characters ~= 8k tokens for typical
 * English, which fits every current generation's context window
 * with room for the system prompt + examples + the IR response.
 */
export const COMPILER_PROMPT_MAX_CHARS = 32_000

export const AiCompilerRequestSchema = z.object({
  /** The natural-language description to compile. */
  prompt: z.string().min(1).max(COMPILER_PROMPT_MAX_CHARS),
  /** Optional examples to guide the LLM (few-shot). */
  examples: z.array(z.string()).readonly().default([]),
  /** Optional constraints (e.g. "must use no human.approval nodes"). */
  constraints: z.array(z.string().min(1).max(1024)).readonly().default([]),
})
export type AiCompilerRequest = z.infer<typeof AiCompilerRequestSchema>

export function parseAiCompilerRequest(input: unknown): AiCompilerRequest {
  return AiCompilerRequestSchema.parse(input)
}

/* ------------------------------------------------------------------ */
/* AI-02 — IR validation result                                       */
/* ------------------------------------------------------------------ */

export const VALIDATION_SEVERITY_VALUES = ["error", "warning", "info"] as const

export const ValidationIssueSchema = z.object({
  severity: z.enum(VALIDATION_SEVERITY_VALUES),
  code: z.string().min(1).max(64),
  message: z.string().min(1).max(1024),
  /** Optional IR node id this issue refers to. */
  nodeId: z.string().min(1).max(128).optional(),
})
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>

export const IrValidatorResultSchema = z.object({
  /** The validated IR (after compilation). */
  workflow: WorkflowDefinitionSchema,
  /** Validation issues — may be empty if the IR is clean. */
  issues: z.array(ValidationIssueSchema).readonly().default([]),
  /** Convenience flag: any error-severity issue? */
  hasErrors: z.boolean(),
})
export type IrValidatorResult = z.infer<typeof IrValidatorResultSchema>

/**
 * Stub IR validator. The real validation (uses graph-validators,
 * M2-TEST workflow-graph, the cross-family node schema) is in the
 * worktree's ai-compiler package. This stub preserves the contract
 * surface (input / output shapes match) and is enough to keep the
 * AI-02 invariant "the validator accepts a WorkflowDefinition and
 * returns an IrValidatorResult" green at the contract level.
 */
export function validateIr(workflow: WorkflowDefinition): IrValidatorResult {
  return {
    workflow,
    issues: [],
    hasErrors: false,
  }
}
