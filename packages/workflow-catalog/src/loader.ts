/* SPDX-License-Identifier: MIT */
import { WorkflowDefinitionSchema, WorkflowIRSchema, WorkflowVersionSchema, type WorkflowDefinition, type WorkflowIR, type WorkflowVersion } from "@unifia/contracts"
import { asDomainDigest, digest } from "@unifia/digest-runtime"

export function loadDefinition(input: unknown): WorkflowDefinition {
  const definition = WorkflowDefinitionSchema.parse(input)
  if (definition.definitionId.trim().length === 0) throw new Error("definitionId is required")
  if (definition.displayName.trim().length === 0) throw new Error("displayName is required")
  return definition
}

export function promoteToVersion(definition: WorkflowDefinition, versionNumber: number, createdBy: string, createdAt = Date.now()): WorkflowVersion {
  const parsed = loadDefinition(definition)
  if (!Number.isSafeInteger(versionNumber) || versionNumber < 1) throw new Error("versionNumber must be a positive integer")
  if (createdBy.trim().length === 0) throw new Error("createdBy is required")
  const content = { definitionId: parsed.definitionId, versionNumber, definition: parsed, createdAt, createdBy }
  const versionDigest = asDomainDigest(digest(content, "workflow-version"), "workflow-version")
  return WorkflowVersionSchema.parse({ ...content, versionId: versionDigest.value, versionDigest })
}

export function loadIR(input: unknown): WorkflowIR { return WorkflowIRSchema.parse(input) }
