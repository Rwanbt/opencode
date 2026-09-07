/* SPDX-License-Identifier: MIT */
/**
 * Runtime policy store (P11.14).
 *
 * V1 ships a JSON policy file at `<workspace>/.unifia/policy.json`
 * that the operator can edit to control the runtime without
 * rebuilding the binary. The schema is intentionally minimal:
 *  - egress defaults (allow / deny);
 *  - feature flags (embedding model, MCP server, etc.);
 *  - default token TTL;
 *  - list of trusted devices.
 *
 * The runtime MUST default to deny if the file is absent or
 * malformed. A bad policy is a hard fail-closed.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs"
import { resolve, dirname, isAbsolute } from "node:path"

export const POLICY_DIR = ".unifia"
export const POLICY_FILE = `${POLICY_DIR}/policy.json`
export const POLICY_TMP = `${POLICY_DIR}/policy.json.tmp`

export interface KnowledgePolicy {
  /** Schema version. Always 1 in V1. */
  version: 1
  /** Default egress posture. */
  egress: "allow" | "deny"
  /** Per-destination overrides. */
  egressByDestination: Record<string, "allow" | "deny">
  /** Feature flags. */
  features: {
    /** Enable the local embedding model. */
    embedding: boolean
    /** Enable the MCP server. */
    mcpServer: boolean
    /** Enable the Git push automation. Default false. */
    gitAutoPush: boolean
  }
  /** Default token TTL in ms. */
  defaultTokenTtlMs: number
  /** Trusted devices (V1: opaque device ids). */
  trustedDevices: string[]
  /** Last update timestamp. */
  updatedAt: string
}

export const DEFAULT_POLICY: KnowledgePolicy = {
  version: 1,
  egress: "deny",
  egressByDestination: {},
  features: {
    embedding: false,
    mcpServer: false,
    gitAutoPush: false,
  },
  defaultTokenTtlMs: 60 * 60 * 1000,
  trustedDevices: [],
  updatedAt: new Date(0).toISOString(),
}

export class PolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PolicyError"
  }
}

/** Read the policy from disk. Returns DEFAULT_POLICY if absent. */
export function readPolicy(workspaceRoot: string): KnowledgePolicy {
  if (!isAbsolute(workspaceRoot)) {
    throw new PolicyError(`workspaceRoot must be absolute, got ${workspaceRoot}`)
  }
  const file = resolve(workspaceRoot, POLICY_FILE)
  if (!existsSync(file)) {
    return { ...DEFAULT_POLICY, updatedAt: new Date(0).toISOString() }
  }
  try {
    const text = readFileSync(file, "utf8")
    const parsed = JSON.parse(text) as unknown
    if (!isPolicy(parsed)) {
      throw new PolicyError(`policy has invalid shape at ${file}`)
    }
    return parsed
  } catch (e) {
    if (e instanceof PolicyError) throw e
    throw new PolicyError(`failed to read policy at ${file}: ${(e as Error).message}`)
  }
}

/** Atomically write the policy to disk. */
export function writePolicy(workspaceRoot: string, policy: KnowledgePolicy): void {
  if (!isAbsolute(workspaceRoot)) {
    throw new PolicyError(`workspaceRoot must be absolute, got ${workspaceRoot}`)
  }
  if (policy.version !== 1) {
    throw new PolicyError(`unsupported policy version: ${policy.version}`)
  }
  const file = resolve(workspaceRoot, POLICY_FILE)
  const tmp = resolve(workspaceRoot, POLICY_TMP)
  const dir = dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const text = JSON.stringify(policy, null, 2)
  writeFileSync(tmp, text, "utf8")
  renameSync(tmp, file)
}

/** Update one or more fields, preserving the rest. */
export function patchPolicy(
  workspaceRoot: string,
  patch: Partial<Omit<KnowledgePolicy, "version" | "updatedAt">>,
): KnowledgePolicy {
  const current = readPolicy(workspaceRoot)
  const next: KnowledgePolicy = {
    ...current,
    ...patch,
    version: 1,
    updatedAt: new Date().toISOString(),
  }
  writePolicy(workspaceRoot, next)
  return next
}

/** Decide whether a destination is allowed by the current policy. */
export function isDestinationAllowed(policy: KnowledgePolicy, destination: string): boolean {
  const override = policy.egressByDestination[destination]
  if (override !== undefined) return override === "allow"
  return policy.egress === "allow"
}

function isPolicy(v: unknown): v is KnowledgePolicy {
  if (typeof v !== "object" || v === null) return false
  const o = v as Record<string, unknown>
  if (o.version !== 1) return false
  if (o.egress !== "allow" && o.egress !== "deny") return false
  if (typeof o.egressByDestination !== "object" || o.egressByDestination === null) return false
  if (typeof o.features !== "object" || o.features === null) return false
  if (typeof o.defaultTokenTtlMs !== "number") return false
  if (!Array.isArray(o.trustedDevices)) return false
  return true
}
