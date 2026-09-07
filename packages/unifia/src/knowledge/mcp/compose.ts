/* SPDX-License-Identifier: MIT */
/**
 * MCP composition root (card C22).
 *
 * `McpKnowledgeServer` and `McpTokenRegistry` existed as isolated building
 * blocks: the server was constructed nowhere outside tests, and every
 * `mcp-token` CLI invocation created a fresh registry, so a token was invalid
 * the moment the process that issued it exited.
 *
 * This module is the one place that ties a workspace, a policy, a service, a
 * registry and a server together, and it hands back the registry so a caller
 * can issue and revoke tokens against the very server that will honour them.
 */

import type { McpKnowledgeCapability } from "@unifia/contracts/knowledge"
import { composeKnowledgeService } from "../facade/compose.js"
import type { PersistentEgressAudit } from "../policy/control-log.js"
import { KnowledgeFailure } from "../domain/errors.js"
import { McpKnowledgeServer, type McpKnowledgeConfig } from "./server.js"
import { McpTokenRegistry, type McpKnowledgeToken } from "./token.js"

/** PERMISSIONS.md §5 defaults. */
export const DEFAULT_MCP_CONFIG = {
  rateLimitPerMinute: 60,
  maxRequestBytes: 1024 * 1024,
  maxResponseBytes: 1024 * 1024,
} as const

export interface ComposeMcpInput {
  /** Absolute path to the workspace this server serves. */
  workspaceRoot: string
  /** Overrides for the transport bounds. */
  config?: Partial<Omit<McpKnowledgeConfig, "workspace">>
}

export interface ComposedMcp {
  server: McpKnowledgeServer
  /** Same instance the server authenticates against. */
  tokens: McpTokenRegistry
  config: McpKnowledgeConfig
  /**
   * The persisted egress trail (ADR-KNOW-0006 §6).
   *
   * Exposed so the daemon can flush it at a request boundary: the log
   * batches its writes, and a long-lived server that never flushed would
   * keep the current batch in memory for as long as it runs.
   */
  controlLog?: PersistentEgressAudit
  /** Issue a token this server will accept. */
  issue(input?: { ttlMs?: number; methods?: readonly McpKnowledgeCapability[] }): McpKnowledgeToken
}

/**
 * Build an MCP server bound to a workspace.
 *
 * `knowledge_propose` is not grantable here: the service has no Class A
 * writer in V1, so a token scoped to it would authorise a call that can only
 * refuse. Write access returns with the writer.
 */
export function composeMcpServer(input: ComposeMcpInput): ComposedMcp {
  const { service, controlLog } = composeKnowledgeService({
    workspaceRoot: input.workspaceRoot,
    providerId: "mcp",
    // An MCP client is a separate process on the far side of a transport, so
    // it is not the operator's own terminal: treat it as remote and let the
    // workspace policy decide what may reach it.
    destinationKind: "remote",
  })

  const config: McpKnowledgeConfig = {
    rateLimitPerMinute: input.config?.rateLimitPerMinute ?? DEFAULT_MCP_CONFIG.rateLimitPerMinute,
    maxRequestBytes: input.config?.maxRequestBytes ?? DEFAULT_MCP_CONFIG.maxRequestBytes,
    maxResponseBytes: input.config?.maxResponseBytes ?? DEFAULT_MCP_CONFIG.maxResponseBytes,
    workspace: input.workspaceRoot,
  }

  const tokens = new McpTokenRegistry()
  const server = new McpKnowledgeServer(service, config, tokens)

  return {
    server,
    tokens,
    config,
    ...(controlLog !== undefined ? { controlLog } : {}),
    issue(opts = {}) {
      if (opts.methods?.includes("knowledge_propose") === true) {
        throw KnowledgeFailure.mutationRefused(
          "knowledge_propose cannot be granted: no Class A writer is configured",
        )
      }
      return tokens.issue({
        workspace: config.workspace,
        ...(opts.ttlMs !== undefined ? { ttlMs: opts.ttlMs } : {}),
        ...(opts.methods !== undefined ? { methods: opts.methods } : {}),
      })
    },
  }
}
