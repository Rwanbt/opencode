/* SPDX-License-Identifier: MIT */
import type { WorkflowDefinition } from "@unifia/contracts"

export class WorkflowStaticValidationError extends Error { constructor(message: string) { super(message); this.name = "WorkflowStaticValidationError" } }

export function validateStatic(definition: WorkflowDefinition): void {
  const nodeIds = new Set(definition.nodes.map((node) => node.id))
  for (const edge of definition.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new WorkflowStaticValidationError(`edge references unknown node: ${edge.from} -> ${edge.to}`)
  }
  for (const node of definition.nodes) {
    if (node.family === "tool.http" && !node.requirements?.capabilities?.includes("network.request")) throw new WorkflowStaticValidationError(`tool.http node ${node.id} requires network.request`)
    if ((node.family as string) === "tool.shell") throw new WorkflowStaticValidationError(`unsupported node family: ${node.family}`)
  }
}
