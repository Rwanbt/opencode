/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Connector / MCP contracts (Plan V2.3.1 §206, ADR-011, ADR-012, ADR-024).
 *
 * Defines the trust boundary for extension workers (connectors,
 * MCP servers). The 5 gates from §206 must all hold:
 *   - ambient secret leak = 0
 *   - host filesystem escape = 0
 *   - network bypass = 0
 *   - Capability bypass = 0
 *   - Secret Broker bypass = 0
 *
 * The contracts here are the *shape* of the trust boundary; the
 * runtime enforcement is in the worktree's extension worker
 * (out of scope for M2/M3/Post-M3-contracts).
 */
import { z } from "zod"

// CO-01 Extension worker isolation
export const EXTENSION_WORKER_ID_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/
export const ExtensionWorkerIdSchema = z.string().regex(EXTENSION_WORKER_ID_PATTERN, "extension: worker id must match /^[a-zA-Z0-9._-]{1,128}$/")
export type ExtensionWorkerId = z.infer<typeof ExtensionWorkerIdSchema>

export const ExtensionScopeSchema = z.object({
  workerId: ExtensionWorkerIdSchema,
  /** The home directory the extension can read/write. Absolute path. */
  workspaceRoot: z.string().min(1).max(1024),
  /** Mounted sub-paths under workspaceRoot. Empty array = no extra mounts. */
  mounts: z.array(z.string()).readonly().default([]),
  /** CPU time budget per minute, in milliseconds. */
  cpuMsPerMinute: z.number().int().nonnegative().max(60_000).default(60_000),
  /** Memory peak budget, in MB. */
  memoryMbPeak: z.number().int().positive().max(8192).default(2048),
  /** Network bytes per hour (combined in+out). 0 = no network. */
  networkBytesPerHour: z.number().int().nonnegative().max(1_073_741_824).default(0),
})
export type ExtensionScope = z.infer<typeof ExtensionScopeSchema>

export function parseExtensionScope(input: unknown): ExtensionScope {
  return ExtensionScopeSchema.parse(input)
}

// CO-02 Clean env
export const ALLOWED_ENV_VARS = new Set([
  "PATH", "HOME", "USER", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "TZ",
])

export const CleanEnvSchema = z.object({
  /** Env vars explicitly passed through (whitelist applied). */
  inherit: z.array(z.string().min(1).max(256)).readonly().default([]),
  /** Env vars explicitly set. */
  set: z.record(z.string().min(1).max(256), z.string().max(8192)).readonly().default({}),
})
export type CleanEnv = z.infer<typeof CleanEnvSchema>

export function isAllowedEnvVar(name: string): boolean {
  return ALLOWED_ENV_VARS.has(name)
}

export function parseCleanEnv(input: unknown): CleanEnv {
  return CleanEnvSchema.parse(input)
}

// CO-04 Network broker (consumes NW-01..07)
export { NetworkCapabilitiesSchema, type NetworkCapabilities, parseNetworkCapabilities } from "./network.js"

// CO-05 Filesystem broker
export const FS_PATH_MAX_CHARS = 4096
export const FS_OP_MAX_BYTES = 100 * 1024 * 1024  // 100 MB

export const FsOperationSchema = z.enum(["read", "write", "append", "list", "stat", "mkdir", "delete"])
export type FsOperation = z.infer<typeof FsOperationSchema>

export const FsGrantSchema = z.object({
  /** Absolute path or path prefix the extension can operate on. */
  path: z.string().min(1).max(FS_PATH_MAX_CHARS),
  operations: z.array(FsOperationSchema).min(1).readonly(),
  /** Optional max bytes per read/write operation. */
  maxBytes: z.number().int().positive().max(FS_OP_MAX_BYTES).optional(),
})
export type FsGrant = z.infer<typeof FsGrantSchema>

export const FilesystemBrokerConfigSchema = z.object({
  grants: z.array(FsGrantSchema).readonly(),
  /** Optional: deny any path that contains these substrings (defense in depth). */
  denylist: z.array(z.string()).readonly().default([]),
})
export type FilesystemBrokerConfig = z.infer<typeof FilesystemBrokerConfigSchema>

export function parseFilesystemBrokerConfig(input: unknown): FilesystemBrokerConfig {
  return FilesystemBrokerConfigSchema.parse(input)
}

// CO-06 Resource limits
export const RESOURCE_LIMIT_DEFAULT_TIMEOUT_MS = 30_000
export const RESOURCE_LIMIT_MAX_TIMEOUT_MS = 600_000  // 10 min

export const ResourceLimitsSchema = z.object({
  /** Max wall-clock duration per request, in milliseconds. */
  timeoutMs: z.number().int().positive().max(RESOURCE_LIMIT_MAX_TIMEOUT_MS).default(RESOURCE_LIMIT_DEFAULT_TIMEOUT_MS),
  /** Max memory peak per request, in MB. */
  memoryMb: z.number().int().positive().max(8192).default(512),
  /** Max CPU time per request, in milliseconds. */
  cpuMs: z.number().int().positive().max(60_000).default(10_000),
  /** Max file descriptors open simultaneously. */
  fds: z.number().int().positive().max(1024).default(64),
  /** Max subprocesses spawned simultaneously. */
  subprocesses: z.number().int().positive().max(32).default(4),
})
export type ResourceLimits = z.infer<typeof ResourceLimitsSchema>

// CO-07 Local MCP isolation
export const MCP_ISOLATION_SCOPES = new Set([
  "tools", "resources", "prompts",
])

export const McpIsolationConfigSchema = z.object({
  /** Unique identifier for the isolated MCP server. */
  serverId: z.string().min(1).max(256),
  /** Capabilities this server exposes. */
  capabilities: z.array(z.enum(["tools", "resources", "prompts", "logging", "sampling"])).readonly(),
  /** Identity token — extension proves it is the registered server. */
  identityToken: z.string().min(1).max(512),
  /** Whether to allow the server to access the local filesystem. Default false. */
  allowFilesystem: z.boolean().default(false),
  /** Whether to allow the server to spawn subprocesses. Default false. */
  allowSubprocess: z.boolean().default(false),
})
export type McpIsolationConfig = z.infer<typeof McpIsolationConfigSchema>

export function parseMcpIsolationConfig(input: unknown): McpIsolationConfig {
  return McpIsolationConfigSchema.parse(input)
}
