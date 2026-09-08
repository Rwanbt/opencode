/* SPDX-License-Identifier: MIT */
/**
 * Workspace-state and policy commands (card C24).
 *
 * Split out of `main.ts` (which reached 970 LOC against a 500-line target for
 * a new file). These commands read or modify the workspace-level state:
 * the portable store, Class A/B reachability, the corpus classifier, the
 * policy file, garbage collection, similarity probes, summaries, and the
 * long-form markdown report. They all take a workspace root and almost all
 * of them print the same five-line header (vault / scanned / …).
 */

import {
  upsertPortableEntry,
  removePortableEntry,
  listPortableEntries,
} from "../../knowledge/classb/portable-store.js"
import { scanReachability } from "../../knowledge/classb/reachability.js"
import { classifyCorpus } from "../../knowledge/admin/corpus-classify.js"
import { readPolicy, patchPolicy, } from "../../knowledge/policy/store.js"
import { recommendGc, applyGcRecommendation } from "../../knowledge/classb/gc.js"
import { simulateSimilarity } from "../../knowledge/semantic/simulate.js"
import { summarise as summariseWorkspace, formatSummaryOneLine } from "../../knowledge/admin/summary.js"
import { generateReport } from "../../knowledge/admin/report.js"
import { parseFlags } from "./shared.js"

export async function cmdPortable(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("portable: missing workspace path\n")
    return 2
  }
  const sub = rest[1]
  try {
    switch (sub) {
      case "list":
      case "show": {
        const entries = listPortableEntries(ws)
        if (entries.length === 0) {
          process.stdout.write("(empty portable store)\n")
          return 0
        }
        for (const e of entries) {
          process.stdout.write(
            `- ${e.alias}  locator=${e.locator}  revision=${e.revision}${e.externalSource ? `  external=${e.externalSource}` : ""}\n`,
          )
        }
        return 0
      }
      case "upsert": {
        const alias = rest[2]
        const locator = rest[3]
        const external = rest[4]
        if (!alias || !locator) {
          process.stderr.write("portable upsert: missing alias or locator\n")
          return 2
        }
        const s = upsertPortableEntry(ws, alias, locator, external)
        process.stdout.write(`upserted ${alias} -> ${locator} (revision=${s.entries[alias]?.revision})\n`)
        return 0
      }
      case "remove": {
        const alias = rest[2]
        if (!alias) {
          process.stderr.write("portable remove: missing alias\n")
          return 2
        }
        removePortableEntry(ws, alias)
        process.stdout.write(`removed ${alias}\n`)
        return 0
      }
      default:
        process.stderr.write(`portable: unknown subcommand: ${sub ?? "(missing)"}\n`)
        return 2
    }
  } catch (e) {
    process.stderr.write(`portable error: ${(e as Error).message}\n`)
    return 1
  }
}

export async function cmdReachability(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("reachability: missing workspace path\n")
    return 2
  }
  try {
    const r = scanReachability(ws)
    process.stdout.write(`vault:      ${r.workspaceRoot}\n`)
    process.stdout.write(`class A:    ${r.classALocators.length} note(s)\n`)
    process.stdout.write(`class B:    ${r.classBEntries.length} entry(ies)\n`)
    process.stdout.write(`reachable:  ${r.reachable.length}\n`)
    process.stdout.write(`orphans:    ${r.orphans.length}\n`)
    process.stdout.write(`missing:    ${r.missingSidecars.length} (no sidecar)\n`)
    if (r.orphans.length > 0) {
      process.stdout.write(`\norphans (Class B without Class A):\n`)
      for (const o of r.orphans) process.stdout.write(`  - ${o}\n`)
    }
    if (r.missingSidecars.length > 0) {
      process.stdout.write(`\nmissing sidecars (Class A without Class B):\n`)
      for (const m of r.missingSidecars) process.stdout.write(`  - ${m}\n`)
    }
    process.stdout.write(`\nelapsed:    ${r.durationMs}ms\n`)
    return 0
  } catch (e) {
    process.stderr.write(`reachability error: ${(e as Error).message}\n`)
    return 1
  }
}

export async function cmdClassify(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("classify: missing workspace path\n")
    return 2
  }
  try {
    const r = classifyCorpus(ws)
    process.stdout.write(`vault:        ${r.vaultRoot}\n`)
    process.stdout.write(`notes parsed: ${r.notesParsed}\n`)
    process.stdout.write(`notes failed: ${r.notesFailed}\n`)
    process.stdout.write(`total chunks: ${r.totalChunks}\n`)
    process.stdout.write(`total edges:  ${r.totalEdges}\n`)
    process.stdout.write(`duration:     ${r.durationMs}ms\n`)
    process.stdout.write(`findings:     ${r.findings.length}\n`)
    for (const f of r.findings) {
      process.stdout.write(`  - [${f.category}] ${f.message}\n`)
    }
    return r.findings.length === 0 ? 0 : 1
  } catch (e) {
    process.stderr.write(`classify error: ${(e as Error).message}\n`)
    return 1
  }
}

export async function cmdPolicy(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("policy: missing workspace path\n")
    return 2
  }
  const sub = rest[1]
  try {
    switch (sub) {
      case "show": {
        const p = readPolicy(ws)
        process.stdout.write(`workspace: ${ws}\n`)
        process.stdout.write(`egress:    ${p.egress}\n`)
        process.stdout.write(`features:  embedding=${p.features.embedding} mcpServer=${p.features.mcpServer} gitAutoPush=${p.features.gitAutoPush}\n`)
        process.stdout.write(`token TTL: ${p.defaultTokenTtlMs}ms\n`)
        process.stdout.write(`devices:   ${p.trustedDevices.length}\n`)
        process.stdout.write(`updatedAt: ${p.updatedAt}\n`)
        if (Object.keys(p.egressByDestination).length > 0) {
          process.stdout.write(`\ndestination overrides:\n`)
          for (const [k, v] of Object.entries(p.egressByDestination)) {
            process.stdout.write(`  - ${k}: ${v}\n`)
          }
        }
        return 0
      }
      case "set-egress": {
        const value = rest[2]
        if (value !== "allow" && value !== "deny") {
          process.stderr.write("policy set-egress: value must be 'allow' or 'deny'\n")
          return 2
        }
        const next = patchPolicy(ws, { egress: value })
        process.stdout.write(`egress: ${value}\n`)
        process.stdout.write(`updatedAt: ${next.updatedAt}\n`)
        return 0
      }
      case "set-feature": {
        const feature = rest[2]
        const value = rest[3]
        if (value !== "true" && value !== "false") {
          process.stderr.write("policy set-feature: value must be 'true' or 'false'\n")
          return 2
        }
        if (feature !== "embedding" && feature !== "mcpServer" && feature !== "gitAutoPush") {
          process.stderr.write("policy set-feature: feature must be 'embedding', 'mcpServer', or 'gitAutoPush'\n")
          return 2
        }
        const current = readPolicy(ws)
        const next = patchPolicy(ws, {
          features: { ...current.features, [feature]: value === "true" },
        })
        process.stdout.write(`${feature}: ${value}\n`)
        process.stdout.write(`updatedAt: ${next.updatedAt}\n`)
        return 0
      }
      default:
        process.stderr.write(`policy: unknown subcommand: ${sub ?? "(missing)"}\n`)
        return 2
    }
  } catch (e) {
    process.stderr.write(`policy error: ${(e as Error).message}\n`)
    return 1
  }
}

export async function cmdGc(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("gc: missing workspace path\n")
    return 2
  }
  const sub = rest[1]
  try {
    switch (sub) {
      case "recommend": {
        const r = recommendGc(ws)
        process.stdout.write(`vault:        ${r.workspaceRoot}\n`)
        process.stdout.write(`action:       ${r.action}\n`)
        process.stdout.write(`safe to apply: ${r.safeToApply}\n`)
        process.stdout.write(`orphans:      ${r.orphanAliases.length}\n`)
        process.stdout.write(`reachable:    ${r.reachableAliases.length}\n`)
        process.stdout.write(`missing:      ${r.missingSidecarLocators.length}\n`)
        if (r.orphanAliases.length > 0) {
          process.stdout.write(`\norphan aliases (Class B without Class A):\n`)
          for (const a of r.orphanAliases) process.stdout.write(`  - ${a}\n`)
        }
        if (r.missingSidecarLocators.length > 0) {
          process.stdout.write(`\nmissing sidecars (Class A without Class B):\n`)
          for (const m of r.missingSidecarLocators) process.stdout.write(`  - ${m}\n`)
        }
        return 0
      }
      case "apply": {
        const r = recommendGc(ws)
        if (!r.safeToApply) {
          process.stderr.write(`gc: not safe to apply (missing sidecars present); rebuild Class B first\n`)
          return 1
        }
        const after = applyGcRecommendation(ws, r)
        process.stdout.write(`applied. remaining entries: ${Object.keys(after.entries).length}\n`)
        return 0
      }
      default:
        process.stderr.write(`gc: unknown subcommand: ${sub ?? "(missing)"}\n`)
        return 2
    }
  } catch (e) {
    process.stderr.write(`gc error: ${(e as Error).message}\n`)
    return 1
  }
}

export async function cmdSimilarity(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("similarity: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const topKStr = flags.get("topk")
  const topK = topKStr && Number.isFinite(Number(topKStr)) ? Number(topKStr) : 5
  try {
    const r = simulateSimilarity({ vaultRoot: ws, topK })
    process.stdout.write(`vault:    ${r.vaultRoot}\n`)
    process.stdout.write(`notes:    ${r.notes}\n`)
    process.stdout.write(`index:    ${r.indexMs}ms\n`)
    process.stdout.write(`query:    ${r.queryMs}ms\n`)
    process.stdout.write(`top pairs (${r.topPairs.length}):\n`)
    for (const p of r.topPairs) {
      process.stdout.write(`  - ${p.a} ~ ${p.b}  cosine=${p.cosine.toFixed(4)}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`similarity error: ${(e as Error).message}\n`)
    return 1
  }
}

export async function cmdSummary(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("summary: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  try {
    const s = summariseWorkspace({ vaultRoot: ws })
    if (flags.has("one-line")) {
      process.stdout.write(formatSummaryOneLine(s) + "\n")
      return 0
    }
    process.stdout.write(`vault:        ${s.vaultRoot}\n`)
    process.stdout.write(`total notes:  ${s.totalNotes}\n`)
    process.stdout.write(`parse fail:   ${s.parseFailures}\n`)
    process.stdout.write(`class B:      ${s.portableStoreEntries} entry(ies)\n`)
    process.stdout.write(`policy:       ${s.policyEgress}\n`)
    process.stdout.write(`\nlifecycle:\n`)
    for (const [k, v] of Object.entries(s.byLifecycle)) {
      process.stdout.write(`  - ${k}: ${v}\n`)
    }
    process.stdout.write(`\ntype:\n`)
    for (const [k, v] of Object.entries(s.byType)) {
      process.stdout.write(`  - ${k}: ${v}\n`)
    }
    if (s.policyFeatures) {
      process.stdout.write(`\nfeatures:\n`)
      process.stdout.write(`  - embedding: ${s.policyFeatures.embedding}\n`)
      process.stdout.write(`  - mcpServer: ${s.policyFeatures.mcpServer}\n`)
      process.stdout.write(`  - gitAutoPush: ${s.policyFeatures.gitAutoPush}\n`)
    }
    process.stdout.write(`\nelapsed:      ${s.totalMs}ms\n`)
    return 0
  } catch (e) {
    process.stderr.write(`summary error: ${(e as Error).message}\n`)
    return 1
  }
}

export async function cmdReport(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("report: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  try {
    const md = generateReport({
      vaultRoot: ws,
      options: {
        includeValidation: !flags.has("no-validation"),
        includeTypeBreakdown: !flags.has("no-types"),
        includePolicy: !flags.has("no-policy"),
        title: flags.get("title") ?? "Knowledge Workspace Report",
      },
    })
    process.stdout.write(md)
    if (!md.endsWith("\n")) process.stdout.write("\n")
    return 0
  } catch (e) {
    process.stderr.write(`report error: ${(e as Error).message}\n`)
    return 1
  }
}
