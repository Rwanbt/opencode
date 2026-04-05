/**
 * Policy Engine - Conditional permission rules beyond allow/deny/ask.
 *
 * Policies add context-aware conditions on top of the permission system:
 * - Path-based restrictions (e.g., /prod/ always requires confirmation)
 * - Size limits (e.g., edits > 100 lines require confirmation)
 * - Command restrictions (e.g., never allow rm -rf)
 * - Time-based rules (e.g., no deploys after 6pm)
 */
import { Log } from "../util/log"
import { Config } from "../config/config"

const log = Log.create({ service: "permission.policy" })

export interface PolicyContext {
  /** Permission type (e.g., "bash", "edit", "write") */
  permission: string
  /** Patterns being checked */
  patterns: string[]
  /** Tool metadata (args, diff size, etc.) */
  metadata?: Record<string, unknown>
}

export interface PolicyViolation {
  policy: string
  message: string
  severity: "block" | "warn"
}

interface PolicyRule {
  id: string
  description: string
  /** Return violations if the policy is violated, empty array if OK */
  check: (ctx: PolicyContext) => PolicyViolation[]
}

const BUILT_IN_POLICIES: PolicyRule[] = [
  {
    id: "no-rm-rf",
    description: "Block rm -rf commands on non-safe paths",
    check(ctx) {
      if (ctx.permission !== "bash") return []
      const patterns = ctx.patterns.join(" ")
      if (/rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive\s+--force|-[a-zA-Z]*f[a-zA-Z]*r)\b/.test(patterns)) {
        // Allow rm -rf on clearly safe targets
        if (/rm\s+-rf\s+(node_modules|\.cache|dist|build|tmp|\.tmp|__pycache__|\.next)\b/.test(patterns)) {
          return []
        }
        return [
          {
            policy: "no-rm-rf",
            message: "rm -rf detected on potentially dangerous path. Verify the target before proceeding.",
            severity: "warn",
          },
        ]
      }
      return []
    },
  },
  {
    id: "protected-paths",
    description: "Require confirmation for operations on protected paths",
    check(ctx) {
      if (!["edit", "write", "bash"].includes(ctx.permission)) return []
      const protectedPatterns = getProtectedPaths()
      const violations: PolicyViolation[] = []
      for (const pattern of ctx.patterns) {
        for (const pp of protectedPatterns) {
          if (pattern.includes(pp)) {
            violations.push({
              policy: "protected-paths",
              message: `Operating on protected path: ${pp}. This requires explicit confirmation.`,
              severity: "warn",
            })
          }
        }
      }
      return violations
    },
  },
  {
    id: "large-edit-warning",
    description: "Warn when editing/writing large amounts of content",
    check(ctx) {
      if (!["edit", "write"].includes(ctx.permission)) return []
      const diff = ctx.metadata?.diff as string | undefined
      if (!diff) return []
      const lines = diff.split("\n").length
      const maxLines = getMaxEditLines()
      if (lines > maxLines) {
        return [
          {
            policy: "large-edit-warning",
            message: `Large edit detected (${lines} lines changed, threshold: ${maxLines}). Review carefully.`,
            severity: "warn",
          },
        ]
      }
      return []
    },
  },
  {
    id: "no-force-push",
    description: "Block git push --force to main/master",
    check(ctx) {
      if (ctx.permission !== "bash") return []
      const patterns = ctx.patterns.join(" ")
      if (/git\s+push\s+.*--force.*\s+(main|master)\b/.test(patterns) ||
          /git\s+push\s+.*-f\s+.*\s+(main|master)\b/.test(patterns)) {
        return [
          {
            policy: "no-force-push",
            message: "Force push to main/master is blocked by policy.",
            severity: "block",
          },
        ]
      }
      return []
    },
  },
  {
    id: "no-env-modification",
    description: "Warn when .env files are being modified",
    check(ctx) {
      if (!["edit", "write"].includes(ctx.permission)) return []
      for (const pattern of ctx.patterns) {
        if (/\.env(\.|$)/.test(pattern)) {
          return [
            {
              policy: "no-env-modification",
              message: ".env file modification detected. Ensure no secrets are being committed.",
              severity: "warn",
            },
          ]
        }
      }
      return []
    },
  },
]

/** Evaluate all policies against the given context. */
export function evaluate(ctx: PolicyContext): PolicyViolation[] {
  if (!isEnabled()) return []

  const violations: PolicyViolation[] = []
  for (const policy of BUILT_IN_POLICIES) {
    try {
      violations.push(...policy.check(ctx))
    } catch (e) {
      log.warn("policy check failed", { policy: policy.id, error: e })
    }
  }

  // Also check custom policies from config
  const customPolicies = getCustomPolicies()
  for (const custom of customPolicies) {
    for (const pattern of ctx.patterns) {
      if (new RegExp(custom.match).test(pattern)) {
        violations.push({
          policy: custom.name,
          message: custom.message,
          severity: custom.action === "block" ? "block" : "warn",
        })
      }
    }
  }

  if (violations.length > 0) {
    log.info("policy violations", {
      permission: ctx.permission,
      count: violations.length,
      policies: violations.map((v) => v.policy).join(", "),
    })
  }

  return violations
}

/** Format violations for display. */
export function formatViolations(violations: PolicyViolation[]): string {
  if (violations.length === 0) return ""
  const blocks = violations.filter((v) => v.severity === "block")
  const warns = violations.filter((v) => v.severity === "warn")

  const parts: string[] = []
  if (blocks.length > 0) {
    parts.push(`Policy BLOCKED:\n${blocks.map((v) => `  [${v.policy}] ${v.message}`).join("\n")}`)
  }
  if (warns.length > 0) {
    parts.push(`Policy warnings:\n${warns.map((v) => `  [${v.policy}] ${v.message}`).join("\n")}`)
  }
  return parts.join("\n")
}

/** Check if any violations are blocking. */
export function hasBlockingViolation(violations: PolicyViolation[]): boolean {
  return violations.some((v) => v.severity === "block")
}

// ─── Config helpers ──────────────────────────────────────────────────

function getConfig() {
  try {
    return Config.info()
  } catch {
    return undefined
  }
}

function isEnabled(): boolean {
  return getConfig()?.experimental?.policy?.enabled === true
}

function getProtectedPaths(): string[] {
  return getConfig()?.experimental?.policy?.protected_paths ?? []
}

function getMaxEditLines(): number {
  return getConfig()?.experimental?.policy?.max_edit_lines ?? 500
}

interface CustomPolicy {
  name: string
  match: string
  message: string
  action: "block" | "warn"
}

function getCustomPolicies(): CustomPolicy[] {
  return (getConfig()?.experimental?.policy?.rules ?? []) as CustomPolicy[]
}
