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
import {
  cmdTagSearch,
  cmdBacklinks,
  cmdStats,
  cmdByType,
  cmdBrokenLinks,
  cmdHeadings,
  cmdList,
} from "./commands-list.js"
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
