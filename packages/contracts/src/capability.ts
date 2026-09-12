/* SPDX-License-Identifier: MIT */
/**
 * CapabilityPort — abstraction sur les capabilities (skills, plugins, MCP)
 *
 * ADR-0003
 * Source : Plan V3 §7.3
 */
export type CapabilityId = string

export interface CapabilityDescriptor {
  id: CapabilityId
  name: string
  description: string
  version: string
  author: string
  license: string
  schema: Record<string, unknown>
  tags: string[]
  trustLevel: "untrusted" | "verified" | "official"
}

export interface CapabilityQuery {
  namePattern?: string
  tags?: string[]
  trustLevel?: string[]
}

export interface CapabilityRequest {
  capabilityId: CapabilityId
  inputs: Record<string, unknown>
  context: {
    workspaceId: string
    userId: string
  }
}

export type AuthorizationDecision =
  | { type: "allow" }
  | { type: "allow-once"; token: string }
  | { type: "deny"; reason: string }
  | { type: "require-approval"; approvers: string[] }

export interface CapabilityExecutionRequest extends CapabilityRequest {
  executionId?: string
}

export interface CapabilityExecution {
  executionId: string
  status: "pending" | "running" | "completed" | "failed" | "cancelled"
  output?: unknown
  error?: string
  startedAt: number
  completedAt?: number
}

export interface CapabilityPort {
  search(query: CapabilityQuery): Promise<CapabilityDescriptor[]>
  authorize(request: CapabilityRequest): Promise<AuthorizationDecision>
  execute(request: CapabilityExecutionRequest): Promise<CapabilityExecution>
  cancel(executionId: string): Promise<void>
}
