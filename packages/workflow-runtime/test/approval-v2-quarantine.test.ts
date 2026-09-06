/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Legacy approval V2 quarantine gates (master plan D-02 section 6).
 *
 * The store-backed V2 broker (LocalApprovalBrokerV2 + ApprovalStore) must stay
 * unreachable from production code: static import gate + runtime constructor
 * gate. One WorkflowRun has one durable authority — the legacy store-backed
 * broker is a second-authority footgun and is LEGACY/TEST-ONLY.
 */

import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { FileBackedApprovalStore, InMemoryApprovalStore, LocalApprovalBrokerV2 } from "../src/approval-v2.js"

const PRUNED = new Set(["node_modules", "dist", "build", ".turbo", "coverage"])

const repoRoot = join(import.meta.dir, "..", "..", "..")
const legacyModule = join(repoRoot, "packages", "workflow-runtime", "src", "approval-v2.ts").replace(/\\/g, "/")

// Production surface only: the packages' src trees. Test suites are the
// sanctioned legacy consumer; anything under src is production wiring.
function listSourceFiles(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && PRUNED.has(entry.name)) continue
    const full = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...listSourceFiles(full))
    else if (entry.isFile() && entry.name.endsWith(".ts")) found.push(full)
  }
  return found
}

function listPackageSrcTrees(): string[] {
  const trees: string[] = []
  for (const entry of readdirSync(join(repoRoot, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory() || PRUNED.has(entry.name)) continue
    const src = join(repoRoot, "packages", entry.name, "src")
    try {
      if (statSync(src).isDirectory()) trees.push(src)
    } catch {
      // package without a src tree contributes nothing to the production scan
    }
  }
  return trees
}

// Import-shaped scan: prose comments may legitimately document the quarantine
// (e.g. index.ts), so only real module references count as a wiring violation.
const importPattern = /(from\s+["'][^"']*approval-v2["'])|((import|require)\s*\(\s*["'][^"']*approval-v2["']\s*\))/

describe("legacy approval V2 quarantine", () => {
  test("no production source module imports the quarantined legacy broker", () => {
    const needle = Buffer.from("approval-v2")
    const violations = listPackageSrcTrees()
      .flatMap((tree) => listSourceFiles(tree))
      .map((file) => file.replace(/\\/g, "/"))
      .filter((file) => file !== legacyModule)
      .filter((file) => readFileSync(file).includes(needle))
      .filter((file) => importPattern.test(readFileSync(file, "utf8")))
    expect(violations).toEqual([])
  }, 30000)

  test("runtime guard blocks legacy instantiation without the test opt-in", () => {
    const previous = process.env.UNIFIA_ALLOW_LEGACY_APPROVAL_V2
    delete process.env.UNIFIA_ALLOW_LEGACY_APPROVAL_V2
    try {
      expect(() => new LocalApprovalBrokerV2(new InMemoryApprovalStore())).toThrow("LEGACY_APPROVAL_V2_QUARANTINED")
      expect(() => new InMemoryApprovalStore()).toThrow("LEGACY_APPROVAL_V2_QUARANTINED")
      expect(() => new FileBackedApprovalStore(join(repoRoot, "quarantine-probe.json"))).toThrow("LEGACY_APPROVAL_V2_QUARANTINED")
    } finally {
      if (previous !== undefined) process.env.UNIFIA_ALLOW_LEGACY_APPROVAL_V2 = previous
    }
  })
})