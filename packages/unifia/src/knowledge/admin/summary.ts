/* SPDX-License-Identifier: MIT */
/**
 * Workspace summary (P11.19).
 *
 * One-line + sectioned view of the Sovereign Knowledge Core V1
 * state of a workspace. Operator-facing: prints the count of
 * notes per space, per lifecycle, per type, plus the result of
 * the most recent verify.
 *
 * Pure / read-only. No filesystem mutation, no network, no
 * subprocess. Designed to be safe to call on any workspace.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { readPortableStore } from "../classb/portable-store.js"
import { readPolicy, POLICY_FILE, DEFAULT_POLICY } from "../policy/store.js"
import { isAbsolute } from "node:path"
import { readFileSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseFrontmatter } from "../parser/frontmatter.js"
import type { KnowledgeLifecycleState } from "@unifia/contracts/knowledge"

export interface SummaryInput {
  vaultRoot: string
}

export interface Summary {
  vaultRoot: string
  totalNotes: number
  byLifecycle: Record<KnowledgeLifecycleState, number>
  byType: Record<string, number>
  portableStoreEntries: number
  policyEgress: "allow" | "deny" | "absent"
  policyFeatures: {
    embedding: boolean
    mcpServer: boolean
    gitAutoPush: boolean
  } | null
  parseFailures: number
  totalMs: number
}

export function summarise(input: SummaryInput): Summary {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  const t0 = Date.now()
  const locators = listMarkdownLocators(input.vaultRoot)
  const byLifecycle: Record<KnowledgeLifecycleState, number> = {
    candidate: 0,
    active: 0,
    superseded: 0,
    archived: 0,
  }
  const byType: Record<string, number> = {}
  let parseFailures = 0

  for (const locator of locators) {
    let text: string
    try {
      text = readFileSync(join(input.vaultRoot, locator), "utf8")
    } catch {
      parseFailures += 1
      continue
    }
    let parsed: ReturnType<typeof parseFrontmatter>
    try {
      parsed = parseFrontmatter(text)
    } catch {
      parseFailures += 1
      continue
    }
    const fm = parsed.frontmatter
    byLifecycle[fm.unifia_lifecycle] = (byLifecycle[fm.unifia_lifecycle] ?? 0) + 1
    byType[fm.unifia_type] = (byType[fm.unifia_type] ?? 0) + 1
  }

  // Portable store.
  let portableStoreEntries = 0
  try {
    const store = readPortableStore(input.vaultRoot)
    portableStoreEntries = Object.keys(store.entries).length
  } catch {
    portableStoreEntries = 0
  }

  // Policy.
  let policyEgress: Summary["policyEgress"] = "absent"
  let policyFeatures: Summary["policyFeatures"] = null
  const policyFilePath = resolve(input.vaultRoot, POLICY_FILE)
  if (existsSync(policyFilePath)) {
    try {
      const p = readPolicy(input.vaultRoot)
      policyEgress = p.egress
      policyFeatures = {
        embedding: p.features.embedding,
        mcpServer: p.features.mcpServer,
        gitAutoPush: p.features.gitAutoPush,
      }
    } catch {
      policyEgress = "absent"
      policyFeatures = {
        embedding: DEFAULT_POLICY.features.embedding,
        mcpServer: DEFAULT_POLICY.features.mcpServer,
        gitAutoPush: DEFAULT_POLICY.features.gitAutoPush,
      }
    }
  } else {
    // No policy file: mark as "absent" so the operator knows.
    policyEgress = "absent"
    policyFeatures = null
  }

  return {
    vaultRoot: input.vaultRoot,
    totalNotes: locators.length,
    byLifecycle,
    byType,
    portableStoreEntries,
    policyEgress,
    policyFeatures,
    parseFailures,
    totalMs: Date.now() - t0,
  }
}

export interface SummaryOneLineOptions {
  /** Maximum length of the one-line summary. */
  maxLen?: number
}

/** Format a Summary as a single line. */
export function formatSummaryOneLine(s: Summary, opts: SummaryOneLineOptions = {}): string {
  const maxLen = opts.maxLen ?? 200
  const lcd = (s.byLifecycle.active ?? 0)
  const lines = [
    `vault=${shortPath(s.vaultRoot)}`,
    `notes=${s.totalNotes} (active=${lcd})`,
    `parse-failures=${s.parseFailures}`,
    `class-B=${s.portableStoreEntries}`,
    `policy.egress=${s.policyEgress}`,
  ]
  const one = lines.join("  ")
  return one.length > maxLen ? one.slice(0, maxLen - 1) + "..." : one
}

function shortPath(p: string): string {
  if (p.length <= 60) return p
  return "..." + p.slice(p.length - 60)
}
