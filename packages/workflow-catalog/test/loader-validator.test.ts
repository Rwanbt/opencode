/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { loadDefinition, loadIR, promoteToVersion, validateStatic, WorkflowStaticValidationError } from "../src/index.ts"

const base = (node = { id: "read", family: "human.approval" as const, config: {} }) => ({ definitionId: "wf-1", ownershipScope: { organizationId: "org", workspaceId: "ws" }, displayName: "Workflow", nodes: [node], edges: [], concurrency: { kind: "none" as const }, defaultFailurePolicy: { kind: "propagate" as const }, defaultTimeoutMs: 1_000, createdAt: 1, updatedAt: 1 })

describe("Workflow V2 loader and static validator", () => {
  test("loads and promotes an immutable content-addressed version", () => { const definition = loadDefinition(base()); const version = promoteToVersion(definition, 1, "human-1", 2); expect(version.versionId).toMatch(/^[0-9a-f]{64}$/); expect(version.versionDigest.domain).toBe("workflow-version"); expect(version.definition).toEqual(definition) })
  test("rejects malformed definitions at the boundary", () => expect(() => loadDefinition({ ...base(), definitionId: "" })).toThrow())
  test("requires network.request for HTTP nodes", () => expect(() => validateStatic(loadDefinition(base({ id: "http", family: "tool.http", config: {} })))).toThrow(WorkflowStaticValidationError))
  test("accepts an HTTP node with its declared capability", () => expect(() => validateStatic(loadDefinition(base({ id: "http", family: "tool.http", config: {}, requirements: { capabilities: ["network.request"] } })))).not.toThrow())
  test("loads a complete IR through the same schema boundary", () => { const definition = loadDefinition(base()); const version = promoteToVersion(definition, 1, "human-1", 2); const ir = loadIR({ definition, version, deployment: { deploymentId: "dep-1", deploymentScope: { ownershipScope: definition.ownershipScope, environmentId: "test" }, workflowVersionId: version.versionId, pinnedAt: 2, pinnedBy: "human-1", active: true }, triggers: [] }); expect(ir.version.versionId).toBe(version.versionId) })
})
