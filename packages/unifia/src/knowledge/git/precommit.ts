/* SPDX-License-Identifier: MIT */
/**
 * Hardening: Git pre-commit hook (P8.1).
 *
 * Per runbook §18 P8: "pre-commit scan, outgoing-range scan,
 * worktrees, hooks policy, conflict UX et diagnostics".
 *
 * The pre-commit hook scans the staged changes for secrets
 * before allowing the commit. If a secret is detected, the
 * commit is refused (exit 1) and the operator is told which
 * locator triggered the rule.
 *
 * The hook is delivered as a TS module so it can be:
 *  - imported and run from `unifia knowledge precommit`;
 *  - installed into `.git/hooks/pre-commit` via a one-shot
 *    `installPrecommitHook` helper.
 */

import { existsSync, writeFileSync, chmodSync, readFileSync, mkdirSync } from "node:fs"
import { resolve, isAbsolute } from "node:path"
import { classifyText, decideWrite } from "../context/dataflow.js"

export interface PrecommitScanInput {
  /** Absolute path to the workspace root (where `.git/` lives). */
  workspaceRoot: string
  /** List of locators (relative to workspaceRoot) that are staged. */
  staged: string[]
  /** Read a locator's content. Caller decides how to read. */
  read: (locator: string) => string | null
}

export interface PrecommitScanFinding {
  locator: string
  /** The classification result from dataflow.classifyText. */
  classification: string
  /** The decision from dataflow.decideWrite. */
  decision: "allow" | "deny"
  /** The byte range that triggered the rule. */
  excerpt: string
}

export interface PrecommitScanResult {
  /** True if the commit is allowed (no findings, or all allow). */
  ok: boolean
  findings: PrecommitScanFinding[]
  scanned: number
  durationMs: number
}

const HOOK_RELATIVE = ".git/hooks/pre-commit"
const HOOK_MARKER = "# unifia-knowledge-precommit-hook"

const HOOK_SCRIPT = `${HOOK_MARKER}
#!/usr/bin/env bun
# Installed by unifia knowledge precommit install
# This hook scans staged changes for secrets before allowing the commit.

set -e

# Get the list of staged files (added, copied, modified, renamed).
STAGED=$(git diff --cached --name-only --diff-filter=ACMR || true)

if [ -z "$STAGED" ]; then
  exit 0
fi

# Run the Unifia pre-commit scanner.
exec bun x unifia-knowledge precommit --staged <<< "$STAGED"
`

/** Scan the staged changes for secrets. */
export function scanStaged(input: PrecommitScanInput): PrecommitScanResult {
  const t0 = Date.now()
  if (!isAbsolute(input.workspaceRoot)) {
    throw new Error(`workspaceRoot must be absolute, got ${input.workspaceRoot}`)
  }

  const findings: PrecommitScanFinding[] = []
  for (const locator of input.staged) {
    const content = input.read(locator)
    if (content === null) continue
    const cls = classifyText(content)
    if (cls.classification !== "secret") continue
    const decision = decideWrite("secret", false)
    if (decision.allowed) continue
    findings.push({
      locator,
      classification: cls.classification,
      decision: "deny",
      excerpt: content.slice(0, 80),
    })
  }

  return {
    ok: findings.length === 0,
    findings,
    scanned: input.staged.length,
    durationMs: Date.now() - t0,
  }
}

/** Result of an install/uninstall operation. */
export interface PrecommitHookInstallResult {
  ok: boolean
  hookPath: string
  reason?: string
}

/** Install the pre-commit hook into `.git/hooks/pre-commit`. */
export function installPrecommitHook(workspaceRoot: string): PrecommitHookInstallResult {
  if (!isAbsolute(workspaceRoot)) {
    return { ok: false, hookPath: "", reason: "workspaceRoot must be absolute" }
  }
  const hookPath = resolve(workspaceRoot, HOOK_RELATIVE)
  if (!existsSync(resolve(workspaceRoot, ".git"))) {
    return { ok: false, hookPath, reason: "no .git directory found" }
  }
  // Ensure the hooks directory exists.
  mkdirSync(resolve(workspaceRoot, ".git/hooks"), { recursive: true })
  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, "utf8")
    if (!existing.includes(HOOK_MARKER)) {
      return {
        ok: false,
        hookPath,
        reason: "a pre-commit hook already exists; refusing to overwrite",
      }
    }
  }
  writeFileSync(hookPath, HOOK_SCRIPT, "utf8")
  // Best-effort chmod; Windows may not support it.
  try {
    chmodSync(hookPath, 0o755)
  } catch {
    // Ignore on Windows.
  }
  return { ok: true, hookPath }
}

/** Uninstall the pre-commit hook. */
export function uninstallPrecommitHook(workspaceRoot: string): PrecommitHookInstallResult {
  if (!isAbsolute(workspaceRoot)) {
    return { ok: false, hookPath: "", reason: "workspaceRoot must be absolute" }
  }
  const hookPath = resolve(workspaceRoot, HOOK_RELATIVE)
  if (!existsSync(hookPath)) {
    return { ok: true, hookPath }
  }
  const existing = readFileSync(hookPath, "utf8")
  if (!existing.includes(HOOK_MARKER)) {
    return {
      ok: false,
      hookPath,
      reason: "pre-commit hook is not managed by unifia-knowledge; refusing to delete",
    }
  }
  // Unlink is intentionally not used here so the operator can decide.
  // V1 returns the path; the operator deletes manually.
  return { ok: true, hookPath }
}
