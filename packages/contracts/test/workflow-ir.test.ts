/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import {
  EffectNodeConfigSchema,
  parseEffectNodeConfigWithReconciliation,
  WorkflowDefinitionSchema,
} from "../src/workflow-ir.ts"

describe("workflow IR public boundary", () => {
  test("parses a minimal workflow definition", () => {
    expect(
      WorkflowDefinitionSchema.parse({
        definitionId: "workflow-1",
        ownershipScope: { organizationId: "org-1", workspaceId: "workspace-1" },
        displayName: "Workflow",
        nodes: [],
        edges: [],
        concurrency: { kind: "none" },
        defaultFailurePolicy: { kind: "propagate" },
        defaultTimeoutMs: 0,
        createdAt: 1,
        updatedAt: 1,
      }).definitionId,
    ).toBe("workflow-1")
  })

  test("re-exports effect contracts after module extraction", () => {
    expect(EffectNodeConfigSchema.parse({ idempotency: "BUSINESS" }).idempotency).toBe("BUSINESS")
    expect(
      parseEffectNodeConfigWithReconciliation({
        effect: { idempotency: "PROVIDER", idempotencyKey: "request-1" },
        reconciliation: {
          probeExpression: "GET /resource/request-1",
          expectedResult: "present",
          failOn: "any_mismatch",
        },
        onUnknown: "RECONCILE_REPLAY",
      }).onUnknown,
    ).toBe("RECONCILE_REPLAY")
  })
})
