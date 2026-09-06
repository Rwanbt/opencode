/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Tests for M2-07 (control.while) and M2-08 (control.child) contracts
 * (Plan V2.3.1 §198, ADR-002 §6).
 *
 * Both node families were missing from NodeFamilySchema. This file
 * locks the contract surface: the schema, the parser, and the
 * cross-field validations.
 *
 * Locked invariants (regression net):
 *   (1) control.while is in NodeFamilySchema.
 *   (2) control.child is in NodeFamilySchema.
 *   (3) parseControlWhileConfig rejects non-positive or oversized
 *       maxIterations.
 *   (4) parseControlWhileConfig requires whileCondition.
 *   (5) parseControlChildConfig requires exactly one of definitionId
 *       or {deploymentId, version}.
 *   (6) parseControlChildConfig requires both deploymentId AND
 *       version when in deployment mode.
 *   (7) WaitConfigSchema (M2-09 partial) accepts outputVariable
 *       and round-trips it.
 */

import { describe, expect, test } from "bun:test"
import {
  CONTROL_WHILE_MAX_ITERATIONS,
  NodeFamilySchema,
  parseControlChildConfig,
  parseControlWhileConfig,
  parseWaitConfig,
  WAIT_DURATION_MAX_MS,
  WAIT_JITTER_MAX,
  type ControlWhileConfig,
  type ControlChildConfig,
} from "../src/workflow-ir.ts"

describe("M2-07 control.while schema", () => {
  test("(1) control.while is in NodeFamilySchema", () => {
    const parsed = NodeFamilySchema.parse("control.while")
    expect(parsed).toBe("control.while")
  })

  test("(2) parseControlWhileConfig accepts a minimal valid config", () => {
    const cfg: ControlWhileConfig = {
      maxIterations: 100,
      whileCondition: "i < 10",
      body: "loop-body",
    }
    const parsed = parseControlWhileConfig(cfg)
    expect(parsed.maxIterations).toBe(100)
    expect(parsed.whileCondition).toBe("i < 10")
    expect(parsed.body).toBe("loop-body")
  })

  test("(3) parseControlWhileConfig accepts an indexVariable", () => {
    const parsed = parseControlWhileConfig({
      maxIterations: 10,
      whileCondition: "i < n",
      body: "body",
      indexVariable: "i",
    })
    expect(parsed.indexVariable).toBe("i")
  })

  test("(4) parseControlWhileConfig rejects maxIterations = 0", () => {
    expect(() =>
      parseControlWhileConfig({
        maxIterations: 0,
        whileCondition: "x",
        body: "b",
      }),
    ).toThrow(/maxIterations must be ≥ 1/)
  })

  test("(5) parseControlWhileConfig rejects maxIterations = CONTROL_WHILE_MAX_ITERATIONS + 1", () => {
    expect(() =>
      parseControlWhileConfig({
        maxIterations: CONTROL_WHILE_MAX_ITERATIONS + 1,
        whileCondition: "x",
        body: "b",
      }),
    ).toThrow(/maxIterations must be ≤/)
  })

  test("(6) parseControlWhileConfig accepts maxIterations at the boundary", () => {
    const parsed = parseControlWhileConfig({
      maxIterations: CONTROL_WHILE_MAX_ITERATIONS,
      whileCondition: "x",
      body: "b",
    })
    expect(parsed.maxIterations).toBe(CONTROL_WHILE_MAX_ITERATIONS)
  })

  test("(7) parseControlWhileConfig rejects empty whileCondition", () => {
    expect(() =>
      parseControlWhileConfig({
        maxIterations: 10,
        whileCondition: "",
        body: "b",
      }),
    ).toThrow(/whileCondition must be non-empty/)
  })

  test("(8) parseControlWhileConfig rejects empty body", () => {
    expect(() =>
      parseControlWhileConfig({
        maxIterations: 10,
        whileCondition: "x",
        body: "",
      }),
    ).toThrow(/body must be a non-empty node id/)
  })

  test("(9) parseControlWhileConfig rejects invalid indexVariable identifier", () => {
    expect(() =>
      parseControlWhileConfig({
        maxIterations: 10,
        whileCondition: "x",
        body: "b",
        indexVariable: "1bad",
      }),
    ).toThrow(/indexVariable must be a valid identifier/)
  })
})

describe("M2-08 control.child schema", () => {
  test("(10) control.child is in NodeFamilySchema", () => {
    const parsed = NodeFamilySchema.parse("control.child")
    expect(parsed).toBe("control.child")
  })

  test("(11) parseControlChildConfig accepts definitionId mode", () => {
    const parsed = parseControlChildConfig({
      definitionId: "wf-child-1",
    })
    expect(parsed.definitionId).toBe("wf-child-1")
    expect(parsed.awaitCompletion).toBe(true)
  })

  test("(12) parseControlChildConfig accepts deploymentId + version mode", () => {
    const parsed = parseControlChildConfig({
      deploymentId: "dep-child-1",
      version: "1.0.0",
    })
    expect(parsed.deploymentId).toBe("dep-child-1")
    expect(parsed.version).toBe("1.0.0")
  })

  test("(13) parseControlChildConfig rejects when both definitionId and deploymentId are set", () => {
    expect(() =>
      parseControlChildConfig({
        definitionId: "wf-child-1",
        deploymentId: "dep-child-1",
        version: "1.0.0",
      }),
    ).toThrow(/exactly one of/)
  })

  test("(14) parseControlChildConfig rejects when neither is set", () => {
    expect(() => parseControlChildConfig({})).toThrow(/exactly one of/)
  })

  test("(15) parseControlChildConfig rejects when only deploymentId is set (no version)", () => {
    expect(() =>
      parseControlChildConfig({
        deploymentId: "dep-child-1",
      }),
    ).toThrow(/both `deploymentId` and `version` are required/)
  })

  test("(16) parseControlChildConfig rejects when only version is set (no deploymentId)", () => {
    expect(() =>
      parseControlChildConfig({
        version: "1.0.0",
      }),
    ).toThrow(/both `deploymentId` and `version` are required/)
  })

  test("(17) parseControlChildConfig accepts an outputVariable", () => {
    const parsed = parseControlChildConfig({
      definitionId: "wf-child-1",
      outputVariable: "childRun",
      awaitCompletion: false,
    })
    expect(parsed.outputVariable).toBe("childRun")
    expect(parsed.awaitCompletion).toBe(false)
  })

  test("(18) parseControlChildConfig rejects invalid outputVariable", () => {
    expect(() =>
      parseControlChildConfig({
        definitionId: "wf-child-1",
        outputVariable: "1bad",
      }),
    ).toThrow(/outputVariable must be a valid identifier/)
  })
})

describe("M2-09 wait refine (partial — outputVariable + jitter)", () => {
  test("(19) WaitConfig accepts a duration, unit, and jitter", () => {
    const parsed = parseWaitConfig({
      duration: 5000,
      unit: "ms",
      jitterRatio: 0.5,
    })
    expect(parsed.duration).toBe(5000)
    expect(parsed.unit).toBe("ms")
    expect(parsed.jitterRatio).toBe(0.5)
  })

  test("(20) WaitConfig defaults: unit='ms', jitterRatio=0.1", () => {
    const parsed = parseWaitConfig({ duration: 1000 })
    expect(parsed.unit).toBe("ms")
    expect(parsed.jitterRatio).toBe(0.1)
  })

  test("(21) WaitConfig rejects negative duration", () => {
    expect(() => parseWaitConfig({ duration: -1 })).toThrow(/duration must be positive/)
  })

  test("(22) WaitConfig rejects duration > WAIT_DURATION_MAX_MS", () => {
    expect(() =>
      parseWaitConfig({ duration: WAIT_DURATION_MAX_MS + 1 }),
    ).toThrow(/duration must be ≤/)
  })

  test("(23) WaitConfig rejects jitterRatio > WAIT_JITTER_MAX", () => {
    expect(() =>
      parseWaitConfig({ duration: 100, jitterRatio: WAIT_JITTER_MAX + 0.01 }),
    ).toThrow(/jitterRatio must be ≤/)
  })

  test("(24) WaitConfig accepts outputVariable (M2-09 refinement)", () => {
    const parsed = parseWaitConfig({
      duration: 2000,
      outputVariable: "actualWait",
    })
    expect(parsed.outputVariable).toBe("actualWait")
  })

  test("(25) WaitConfig rejects invalid outputVariable identifier", () => {
    expect(() =>
      parseWaitConfig({ duration: 100, outputVariable: "1bad" }),
    ).toThrow(/outputVariable must be a valid identifier/)
  })
})
