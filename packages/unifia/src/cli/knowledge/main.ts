/* SPDX-License-Identifier: MIT */
/**
 * `unifia knowledge` — CLI surface for the Sovereign Knowledge Core.
 *
 * This was a standalone script under `bin/`, deliberately outside the yargs
 * tree. That choice made the whole Sovereign Knowledge Core unreachable from
 * the product: `script/build.ts` compiles one entrypoint, `src/index.ts`, and
 * nothing here was imported from it. A string search of the built 185 MB
 * sidecar returned zero hits for `control-log.jsonl`, `unifia_restrictions`
 * and `egress.decision`, against 607 for `unifia` — the bundler had dropped
 * the module entirely. Every test was green and the feature was not shipped.
 *
 * It now lives under `src/cli/` and exports `runKnowledgeCli`, registered as a
 * real subcommand by `src/cli/cmd/knowledge.ts`. `bin/` keeps a thin launcher.
 *
 * Known shape, left deliberately: thirteen `cmd*` declarations sit physically
 * inside the dispatch `switch`. It is legal — declarations hoist — but biome
 * flags it, and three mechanical attempts to lift them out corrupted the
 * file. Moving them is its own change, with its own review. See R-0020.
 *
 * The V1 commands are:
 *
 *   status      — print the status of the knowledge subsystem.
 *   doctor      — run the doctor over the canonical knowledge.
 *   search      — search the corpus (uses the default in-memory
 *                 registry; full FTS needs the runtime).
 *   sources     — list the registered sources.
 *   bench       — run the semantic benchmark on a synthetic corpus.
 *
 * This is the in-process surface; the same logic backs the
 * `McpKnowledgeServer` and the `KnowledgeService` facade.
 */

import {
  cmdDoctor,
  cmdBench,
  cmdBenchLarge,
  cmdSovereignty,
  cmdDisasterRecovery,
  cmdMigrate,
  cmdPrecommit,
  cmdVerify,
  cmdDrill,
  cmdValidate,
} from "./commands-hardening.js"
import {
  cmdPortable,
  cmdReachability,
  cmdClassify,
  cmdPolicy,
  cmdGc,
  cmdSimilarity,
  cmdSummary,
  cmdReport,
} from "./commands-workspace.js"
import { tagSearch } from "../../knowledge/admin/tag-search.js"
import { findBacklinks } from "../../knowledge/admin/backlinks.js"
import { computeStats } from "../../knowledge/admin/stats.js"
import { listByType } from "../../knowledge/admin/by-type.js"
import { scanBrokenLinks } from "../../knowledge/admin/broken-links.js"
import { listHeadings } from "../../knowledge/admin/headings.js"
import { listNotes } from "../../knowledge/admin/list.js"
import { cmdStatus, cmdSources, cmdSearch, } from "./runtime.js"
import { printUsage } from "./usage.js"
import { cmdMcp, cmdMcpToken } from "./commands-mcp.js"
// One flag parser for the whole CLI. The local copy ignored bare
// `--flag` forms, so a switch like `--strict` was silently dropped.
import { parseFlags } from "./shared.js"
import {
  cmdShow,
  cmdTags,
  cmdProjects,
  cmdSupersede,
  cmdByLifecycle,
  cmdByProject,
  cmdOrphans,
  cmdLifecycleDistribution,
  cmdStale,
  cmdReferences,
  cmdFingerprint,
  cmdByTag,
  cmdVaultCompare,
  cmdRecent,
} from "./commands-vault.js"
import {
  cmdSupersedeGraph,
  cmdDuplicates,
  cmdTimeline,
  cmdTagCooccurrence,
  cmdSupersedeClassify,
  cmdNoteDiff,
  cmdLifecycleTransitions,
  cmdNoteStats,
  cmdSizeDistribution,
  cmdWeekdayDistribution,
  cmdEdgeDensity,
  cmdFrontmatterDiff,
} from "./commands-graph.js"
import type { ParsedArgs } from "./shared.js"


function parseArgs(argv: readonly string[]): ParsedArgs {
  if (argv.length === 0) return { cmd: null, rest: [] }
  const [first, ...rest] = argv
  return { cmd: first ?? null, rest: rest as string[] }
}

/**
 * Run one `unifia knowledge` invocation.
 *
 * Takes its arguments instead of reading `process.argv`, and returns an exit
 * code instead of calling `process.exit`: a subcommand inside the main yargs
 * tree owns neither of those, and a test can call this directly.
 */
export async function runKnowledgeCli(argv: readonly string[]): Promise<number> {
  const { cmd, rest } = parseArgs(argv)
  switch (cmd) {
    case null:
    case "help":
    case "-h":
    case "--help":
      printUsage()
      return 0
    case "status":
      return cmdStatus(rest)
    case "sources":
      return cmdSources(rest)
    case "search":
      return cmdSearch(rest)
    case "doctor":
      return cmdDoctor()
    case "bench":
      return cmdBench()
    case "bench-large":
      return cmdBenchLarge(rest)
    case "sovereignty":
      return cmdSovereignty(rest)
    case "disaster-recovery":
      return cmdDisasterRecovery(rest)
    case "migrate":
      return cmdMigrate(rest)
    case "precommit":
      return cmdPrecommit(rest)
    case "portable":
      return cmdPortable(rest)
    case "reachability":
      return cmdReachability(rest)
    case "mcp-token":
      return cmdMcpToken(rest)
    case "mcp":
      return cmdMcp(rest)
    case "classify":
      return cmdClassify(rest)
    case "verify":
      return cmdVerify(rest)


    case "policy":
      return cmdPolicy(rest)


    case "gc":
      return cmdGc(rest)


    case "similarity":
      return cmdSimilarity(rest)


    case "summary":
      return cmdSummary(rest)


    case "drill":
      return cmdDrill()


    case "validate":
      return cmdValidate(rest)


    case "report":
      return cmdReport(rest)


    case "tag-search":
      return cmdTagSearch(rest)


    case "backlinks":
      return cmdBacklinks(rest)


    case "stats":
      return cmdStats(rest)


    case "by-type":
      return cmdByType(rest)


    case "broken-links":
      return cmdBrokenLinks(rest)


    case "headings":
      return cmdHeadings(rest)
    case "list":
      return cmdList(rest)
    case "show":
      return cmdShow(rest)
    case "tags":
      return cmdTags(rest)
    case "projects":
      return cmdProjects(rest)
    case "supersede":
      return cmdSupersede(rest)
    case "by-lifecycle":
      return cmdByLifecycle(rest)
    case "by-project":
      return cmdByProject(rest)
    case "orphans":
      return cmdOrphans(rest)
    case "lifecycle-distribution":
      return cmdLifecycleDistribution(rest)
    case "stale":
      return cmdStale(rest)
    case "references":
      return cmdReferences(rest)
    case "fingerprint":
      return cmdFingerprint(rest)
    case "by-tag":
      return cmdByTag(rest)
    case "vault-compare":
      return cmdVaultCompare(rest)
    case "recent":
      return cmdRecent(rest)
    case "supersede-graph":
      return cmdSupersedeGraph(rest)
    case "duplicates":
      return cmdDuplicates(rest)
    case "timeline":
      return cmdTimeline(rest)
    case "tag-cooccurrence":
      return cmdTagCooccurrence(rest)
    case "supersede-classify":
      return cmdSupersedeClassify(rest)
    case "note-diff":
      return cmdNoteDiff(rest)
    case "lifecycle-transitions":
      return cmdLifecycleTransitions(rest)
    case "note-stats":
      return cmdNoteStats(rest)
    case "size-distribution":
      return cmdSizeDistribution(rest)
    case "weekday-distribution":
      return cmdWeekdayDistribution(rest)
    case "edge-density":
      return cmdEdgeDensity(rest)
    case "frontmatter-diff":
      return cmdFrontmatterDiff(rest)
    default:
      process.stderr.write(`unknown subcommand: ${cmd}\n\n`)
      printUsage()
      return 2
  }
}

async function cmdTagSearch(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("tag-search: missing workspace path\n")
    return 2
  }
  const tags = rest.slice(1).filter((r) => !r.startsWith("--"))
  const flags = parseFlags(rest.slice(1 + tags.length))
  const limitStr = flags.get("limit")
  const limit = limitStr && Number.isFinite(Number(limitStr)) ? Number(limitStr) : 50
  try {
    const r = tagSearch({ vaultRoot: ws, tags, limit })
    process.stdout.write(`vault:    ${r.vaultRoot}\n`)
    process.stdout.write(`query:    ${JSON.stringify(r.query)}\n`)
    process.stdout.write(`scanned:  ${r.scanned}\n`)
    process.stdout.write(`hits:     ${r.hits.length}\n`)
    for (const h of r.hits) {
      process.stdout.write(`  - ${h.id}  ${h.locator}  ${h.type}/${h.lifecycle}  [${h.tags.join(", ")}]\n`)
    }
    process.stdout.write(`\nelapsed:  ${r.totalMs}ms\n`)
    return 0
  } catch (e) {
    process.stderr.write(`tag-search error: ${(e as Error).message}\n`)
    return 1
  }
}

async function cmdBacklinks(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  const target = rest[1]
  if (!ws || !target) {
    process.stderr.write("backlinks: usage: backlinks <workspace> <target>\n")
    return 2
  }
  try {
    const r = findBacklinks({ vaultRoot: ws, target })
    process.stdout.write(`vault:    ${r.vaultRoot}\n`)
    process.stdout.write(`target:   ${r.target}\n`)
    process.stdout.write(`scanned:  ${r.scanned}\n`)
    process.stdout.write(`hits:     ${r.hits.length}\n`)
    for (const h of r.hits) {
      process.stdout.write(`  - ${h.id}  ${h.source}  ${h.type}/${h.lifecycle}  -> ${h.matchedTarget}\n`)
    }
    process.stdout.write(`\nelapsed:  ${r.totalMs}ms\n`)
    return 0
  } catch (e) {
    process.stderr.write(`backlinks error: ${(e as Error).message}\n`)
    return 1
  }
}

async function cmdStats(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("stats: missing workspace path\n")
    return 2
  }
  try {
    const s = computeStats(ws)
    process.stdout.write(`vault:        ${s.vaultRoot}\n`)
    process.stdout.write(`total notes:  ${s.totalNotes}\n`)
    process.stdout.write(`parse fail:   ${s.parseFailures}\n`)
    process.stdout.write(`class B:      ${s.portableStoreEntries} entry(ies)\n`)
    process.stdout.write(`policy:       ${s.policyEgress}\n\n`)
    process.stdout.write(`by lifecycle:\n`)
    for (const b of s.byLifecycle) {
      process.stdout.write(`  ${b.name.padEnd(12)} ${String(b.count).padStart(4)}  ${b.percent.toFixed(1)}%\n`)
    }
    process.stdout.write(`\nby type:\n`)
    for (const b of s.byType) {
      process.stdout.write(`  ${b.name.padEnd(12)} ${String(b.count).padStart(4)}  ${b.percent.toFixed(1)}%\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`stats error: ${(e as Error).message}\n`)
    return 1
  }
}

async function cmdByType(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  const type = rest[1]
  if (!ws || !type) {
    process.stderr.write("by-type: usage: by-type <workspace> <type> [--only-active] [--limit=N]\n")
    return 2
  }
  const flags = parseFlags(rest.slice(2))
  const limitStr = flags.get("limit")
  const limit = limitStr && Number.isFinite(Number(limitStr)) ? Number(limitStr) : 50
  try {
    const r = listByType({ vaultRoot: ws, type, limit, onlyActive: flags.has("only-active") })
    process.stdout.write(`vault:    ${r.vaultRoot}\n`)
    process.stdout.write(`type:     ${r.type}\n`)
    process.stdout.write(`scanned:  ${r.scanned}\n`)
    process.stdout.write(`hits:     ${r.hits.length}\n`)
    for (const h of r.hits) {
      process.stdout.write(`  - ${h.id}  ${h.locator}  ${h.lifecycle}  updatedAt=${h.updatedAt}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`by-type error: ${(e as Error).message}\n`)
    return 1
  }
}

async function cmdBrokenLinks(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("broken-links: missing workspace path\n")
    return 2
  }
  try {
    const r = scanBrokenLinks({ vaultRoot: ws })
    process.stdout.write(`vault:    ${r.vaultRoot}\n`)
    process.stdout.write(`scanned:  ${r.scanned}\n`)
    process.stdout.write(`broken:   ${r.totalBroken}\n`)
    for (const [src, links] of Object.entries(r.bySource)) {
      process.stdout.write(`\n${src} :\n`)
      for (const l of links) {
        process.stdout.write(`  -> ${l.target}  (raw: ${l.raw})\n`)
      }
    }
    return r.totalBroken === 0 ? 0 : 1
  } catch (e) {
    process.stderr.write(`broken-links error: ${(e as Error).message}\n`)
    return 1
  }
}

async function cmdHeadings(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  const loc = rest[1]
  if (!ws || !loc) {
    process.stderr.write("headings: usage: headings <workspace> <locator>\n")
    return 2
  }
  try {
    const r = listHeadings({ workspaceRoot: ws, locator: loc })
    process.stdout.write(`note:    ${loc}\n`)
    process.stdout.write(`count:   ${r.length}\n`)
    for (const h of r) {
      const indent = "  ".repeat(h.level - 1)
      process.stdout.write(`${indent}h${h.level}  L${h.line}  ${h.text}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`headings error: ${(e as Error).message}\n`)
    return 1
  }
}

async function cmdList(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("list: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const limitStr = flags.get("limit")
  const offsetStr = flags.get("offset")
  const limit = limitStr && Number.isFinite(Number(limitStr)) ? Number(limitStr) : 100
  const offset = offsetStr && Number.isFinite(Number(offsetStr)) ? Number(offsetStr) : 0
  try {
    const r = listNotes({ vaultRoot: ws, limit, offset })
    process.stdout.write(`vault:    ${r.vaultRoot}\n`)
    process.stdout.write(`hits:     ${r.hits.length}\n`)
    for (const h of r.hits) {
      process.stdout.write(`  - ${h.locator}  ${h.type}/${h.lifecycle}  ${h.updatedAt}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`list error: ${(e as Error).message}\n`)
    return 1
  }
}
