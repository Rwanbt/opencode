/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * PostM3-R2 — AI Compiler (AI-01..02) (Plan V2.3.1 §222, ADR-002).
 *
 * Locked invariants (regression net, 10 tests):
 *   AI-01 Prompt -> IR (4):
 *     (1) AiCompilerRequestSchema — minimal request (prompt only) parses.
 *     (2) AiCompilerRequestSchema — request with examples parses.
 *     (3) AiCompilerRequestSchema — empty prompt is rejected.
 *     (4) AiCompilerRequestSchema — prompt of COMPILER_PROMPT_MAX_CHARS+1
 *         characters is rejected.
 *
 *   AI-02 IR validation (6):
 *     (5) ValidationIssueSchema — accepts all 3 severities.
 *     (6) ValidationIssueSchema — rejects an unknown severity.
 *     (7) IrValidatorResultSchema — parses with an empty issues list.
 *     (8) IrValidatorResultSchema — rejects a non-WorkflowDefinition
 *         workflow (cross-ref to workflow-ir.ts).
 *     (9) validateIr — stub returns no issues for a valid workflow.
 *     (10) validateIr — stub preserves the input workflow.
 */
import { describe, expect, test } from "bun:test"
import {
  COMPILER_PROMPT_MAX_CHARS,
  parseAiCompilerRequest,
  ValidationIssueSchema,
  IrValidatorResultSchema,
  validateIr,
  VALIDATION_SEVERITY_VALUES,
} from "../src/ai-compiler.ts"
import type { WorkflowDefinition } from "../src/workflow-ir.ts"

// =========================================================================
// AI-01 — Prompt -> IR
// =========================================================================

describe("AI-01 AiCompilerRequest — happy path", () => {
  test("(1) AiCompilerRequestSchema_ParsesMinimal — prompt only", () => {
    const parsed = parseAiCompilerRequest({ prompt: "Run a daily backup" })
    expect(parsed.prompt).toBe("Run a daily backup")
    expect(parsed.examples).toEqual([])
    expect(parsed.constraints).toEqual([])
  })

  test("(2) AiCompilerRequestSchema_ParsesWithExamples — prompt + examples + constraints", () => {
    const parsed = parseAiCompilerRequest({
      prompt: "Run a daily backup",
      examples: ["ex1: send an email if failure", "ex2: post to slack"],
      constraints: ["no human.approval nodes", "use the default timeout"],
    })
    expect(parsed.examples).toHaveLength(2)
    expect(parsed.constraints).toHaveLength(2)
  })
})

describe("AI-01 AiCompilerRequest — validation", () => {
  test("(3) AiCompilerRequestSchema_RejectsEmptyPrompt", () => {
    expect(() => parseAiCompilerRequest({ prompt: "" })).toThrow()
  })

  test("(4) AiCompilerRequestSchema_RejectsTooLongPrompt", () => {
    const longPrompt = "x".repeat(COMPILER_PROMPT_MAX_CHARS + 1)
    expect(() => parseAiCompilerRequest({ prompt: longPrompt })).toThrow()
  })
})

// =========================================================================
// AI-02 — IR validation
// =========================================================================

describe("AI-02 ValidationIssue — severity coverage", () => {
  test("(5) ValidationIssueSchema_AcceptsAllSeverities — error / warning / info", () => {
    for (const severity of VALIDATION_SEVERITY_VALUES) {
      const parsed = ValidationIssueSchema.parse({
        severity,
        code: "TEST-001",
        message: `test ${severity}`,
      })
      expect(parsed.severity).toBe(severity)
    }
  })

  test("(6) ValidationIssueSchema_RejectsBadSeverity — 'fatal' is not a valid severity", () => {
    expect(() =>
      ValidationIssueSchema.parse({
        severity: "fatal",
        code: "X",
        message: "x",
      }),
    ).toThrow()
  })
})

describe("AI-02 IrValidatorResult — schema", () => {
  /** Build a minimal valid WorkflowDefinition for cross-ref tests. */
  const validWorkflow: WorkflowDefinition = {
    definitionId: "def-1",
    ownershipScope: {
      organizationId: "org-1",
      workspaceId: "ws-1",
    },
    displayName: "Test",
    nodes: [],
    edges: [],
    concurrency: { kind: "none" },
    defaultFailurePolicy: { kind: "propagate" },
    defaultTimeoutMs: 0,
    createdAt: 0,
    updatedAt: 0,
  }

  test("(7) IrValidatorResultSchema_ParsesEmptyIssues — workflow + empty issues + hasErrors=false", () => {
    const parsed = IrValidatorResultSchema.parse({
      workflow: validWorkflow,
      issues: [],
      hasErrors: false,
    })
    expect(parsed.issues).toEqual([])
    expect(parsed.hasErrors).toBe(false)
    expect(parsed.workflow.definitionId).toBe("def-1")
  })

  test("(8) IrValidatorResultSchema_RejectsBadWorkflow — non-WorkflowDefinition is refused", () => {
    expect(() =>
      IrValidatorResultSchema.parse({
        workflow: { notAWorkflow: true },
        issues: [],
        hasErrors: false,
      }),
    ).toThrow()
  })

  test("(9) validateIr_ReturnsEmptyIssues — stub returns no issues for a valid workflow", () => {
    const result = validateIr(validWorkflow)
    expect(result.issues).toEqual([])
    expect(result.hasErrors).toBe(false)
  })

  test("(10) validateIr_PreservesWorkflow — stub returns the same workflow object", () => {
    const result = validateIr(validWorkflow)
    expect(result.workflow).toEqual(validWorkflow)
  })
})
