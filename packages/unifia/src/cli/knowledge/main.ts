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

import { doctor, type DoctorInput } from "../../knowledge/admin/doctor.js"
import {
  benchmarkOne,
  summarise,
} from "../../knowledge/semantic/benchmark.js"
import { simulateLargeVault } from "../../knowledge/hardening/large-vault.js"
import { planRecovery, simulateRecovery } from "../../knowledge/hardening/disaster-recovery.js"
import { runSovereigntyProbes } from "../../knowledge/hardening/sovereignty-runner.js"
import { dryRunMigration, planRollback, MIGRATION_V1_TO_V2 } from "../../knowledge/hardening/migration.js"
import { scanStaged, installPrecommitHook } from "../../knowledge/git/precommit.js"
import {
  upsertPortableEntry,
  removePortableEntry,
  listPortableEntries,
} from "../../knowledge/classb/portable-store.js"
import { scanReachability } from "../../knowledge/classb/reachability.js"
import { classifyCorpus } from "../../knowledge/admin/corpus-classify.js"
import { runVerify } from "../../knowledge/hardening/verify.js"
import { readPolicy, patchPolicy, } from "../../knowledge/policy/store.js"
import { recommendGc, applyGcRecommendation } from "../../knowledge/classb/gc.js"
import { simulateSimilarity } from "../../knowledge/semantic/simulate.js"
import { summarise as summariseWorkspace, formatSummaryOneLine } from "../../knowledge/admin/summary.js"
import { runDrill, stubFsWithClassA } from "../../knowledge/hardening/drill.js"
import { validate } from "../../knowledge/admin/validate.js"
import { generateReport } from "../../knowledge/admin/report.js"
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

async function cmdDoctor(): Promise<number> {
  const input: DoctorInput = {
    byId: new Map(),
    knownLocators: new Set(),
    edges: [],
    index: { rebuiltAt: new Date().toISOString(), candidatesCount: 0 },
    indexedLocators: new Set(),
  }
  const r = doctor(input)
  process.stdout.write(`doctor: ${r.findings.length} finding(s)\n`)
  for (const f of r.findings) process.stdout.write(`  - ${f.category}: ${f.message}\n`)
  return 0
}

async function cmdBench(): Promise<number> {
  const candidates = ["a", "b", "c"].map((id, i) => ({
    id: id as never,
    locator: `m/${id}.md` as never,
    type: "decision" as const,
    space: "personal" as const,
    trust: "verified" as const,
    authority: "user" as const,
    restriction: "allow" as const,
    relevance: 1 - i * 0.1,
    snippet: "",
    snippetBytes: 0,
    snippetHash: "0".repeat(64),
  }))
  const r = benchmarkOne(
    { query: "q", expected: ["a"] as never },
    candidates,
    5,
  )
  const s = summarise([r])
  process.stdout.write(
    `recall@5=${s.meanRecallAt5.toFixed(3)}  recall@10=${s.meanRecallAt10.toFixed(3)}  mrr=${s.meanMrr.toFixed(3)}  ndcg@10=${s.meanNdcgAt10.toFixed(3)}  forbidden=${s.meanForbiddenRate}  activate=${s.activate}\n`,
  )
  return 0
}

async function cmdBenchLarge(rest: readonly string[]): Promise<number> {
  const count = Number(rest[0] ?? "100")
  const bodySize = Number(rest[1] ?? "256")
  if (!Number.isFinite(count) || !Number.isFinite(bodySize) || count <= 0 || bodySize <= 0) {
    process.stderr.write("bench-large: count and bodySize must be positive numbers\n")
    return 2
  }
  const r = simulateLargeVault(count, bodySize, 1024)
  process.stdout.write(
    `simulated ${r.count} notes, parse=${r.totalParseMs}ms (mean ${r.meanParseMs.toFixed(2)}ms), index=${r.totalIndexMs}ms (mean ${r.meanIndexMs.toFixed(2)}ms), peak body bytes=${r.peakBodyBytes}\n`,
  )
  return 0
}


async function cmdSovereignty(rest: readonly string[]): Promise<number> {
  const flags = parseFlags(rest)
  const vaultRoot = flags.get("vault") ?? "."
  const derivedDb = flags.get("derived") ?? "./derived.db"
  const report = await runSovereigntyProbes({
    vaultRoot,
    derivedDbPath: derivedDb,
    // In V1 the operator is asked once at install time. The CLI
    // defaults assume offline; pass --online to override.
    internetOff: !flags.has("online"),
    cloudOff: !flags.has("cloud"),
    deviceIsolated: !flags.has("device"),
  })
  process.stdout.write(
    `vault:      ${report.vaultRoot}\nderived:    ${report.derivedDbPath}\n`,
  )
  for (const p of report.probes) {
    process.stdout.write(
      `  ${p.ok ? "PASS" : "FAIL"}  ${p.kind.padEnd(22)}  ${p.message}  (${p.durationMs}ms)\n`,
    )
  }
  process.stdout.write(`\nverdict:    ${report.ok ? "OK" : "FAIL"}  (total ${report.totalMs}ms)\n`)
  return report.ok ? 0 : 1
}

async function cmdDisasterRecovery(rest: readonly string[]): Promise<number> {
  const flags = parseFlags(rest)
  // No vault is opened here: this command plans and simulates recovery
  // against a stub filesystem. It read a `--vault` value and never used
  // it, so the usage screen has stopped advertising the flag.
  const plan = planRecovery({
    classAReadable: true,
    classBReachable: true,
    classCPresent: !flags.has("no-class-c"),
    classDPresent: !flags.has("no-class-d"),
    unifiaBinaryPresent: !flags.has("no-unifia"),
    networkAvailable: !flags.has("offline"),
  })
  process.stdout.write(`detected missing: [${plan.missing.join(", ")}]\n`)
  process.stdout.write(`requires network: ${plan.requiresNetwork}\n`)
  process.stdout.write(`requires unifia:  ${plan.requiresUnifiaBinary}\n\n`)
  for (const step of plan.steps) {
    process.stdout.write(`- [${step.kind}] ${step.description}\n`)
  }
  // Simulate against a stub fs.
  const sim = simulateRecovery(plan, {
    read: (loc) => (loc === "memory/any.md" ? "# hello" : null),
    exists: (loc) => loc === "memory/any.md" || loc === "memory/any.md.unifia.json",
  })
  process.stdout.write(
    `\nsimulation: ${sim.ok ? "OK" : "FAIL"} (classA=${sim.classAStillReadable} classB=${sim.classBStillReachable} steps=${sim.stepsExecuted})\n`,
  )
  return sim.ok ? 0 : 1
}

async function cmdMigrate(rest: readonly string[]): Promise<number> {
  const dryRun = rest.includes("--dry-run")
  const rollback = rest.includes("--rollback")
  if (rollback) {
    const p = planRollback(MIGRATION_V1_TO_V2)
    process.stdout.write(
      `rollback plan: ${p.reversibleOps} reversible op(s), ${p.nonReversibleOps} reconstructible op(s), fullRollback=${p.fullRollback}\n`,
    )
    for (const op of p.reverseOps) {
      process.stdout.write(`  - ${op.kind} ${op.target} :: ${op.details}\n`)
    }
    // We are only printing a plan; we never apply it from the CLI in V1.
    return 0
  }
  const r = dryRunMigration(MIGRATION_V1_TO_V2)
  process.stdout.write(
    `V1→V2 migration (${dryRun ? "DRY-RUN" : "REVIEW"}): ${r.totalOps} op(s), ${r.additiveOps} additive, ${r.destructiveOps} destructive\n`,
  )
  process.stdout.write(`all reconstructible: ${r.allReconstructible}\n`)
  for (const label of r.stepLabels) process.stdout.write(`  - ${label}\n`)
  if (dryRun) {
    process.stdout.write(`\nNo state was mutated. Apply with caution after review.\n`)
    return 0
  }
  process.stdout.write(
    `\nRun with --dry-run for a safe preview or --rollback to see the reverse plan.\n`,
  )
  return 0
}

async function cmdPrecommit(rest: readonly string[]): Promise<number> {
  const sub = rest[0]
  if (sub === "install") {
    const ws = rest[1]
    if (!ws) {
      process.stderr.write("precommit install: missing workspace path\n")
      return 2
    }
    const r = installPrecommitHook(ws)
    if (!r.ok) {
      process.stderr.write(`precommit install failed: ${r.reason}\n`)
      return 1
    }
    process.stdout.write(`installed hook at ${r.hookPath}\n`)
    return 0
  }
  if (sub === "scan") {
    const staged = rest.slice(1)
    const ws = process.cwd()
    const r = scanStaged({
      workspaceRoot: ws,
      staged,
      read: (loc) => {
        try {
          return require("node:fs").readFileSync(loc, "utf8") as string
        } catch {
          return null
        }
      },
    })
    if (!r.ok) {
      for (const f of r.findings) {
        process.stderr.write(`DENY  ${f.locator}  :: ${f.classification}\n`)
      }
      return 1
    }
    process.stdout.write(`scanned ${r.scanned} staged file(s), no secrets found\n`)
    return 0
  }
  process.stderr.write(`precommit: unknown subcommand: ${sub ?? "(missing)"}\n`)
  return 2
}

async function cmdPortable(rest: readonly string[]): Promise<number> {
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

async function cmdReachability(rest: readonly string[]): Promise<number> {
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

async function cmdClassify(rest: readonly string[]): Promise<number> {
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

async function cmdVerify(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("verify: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const derived = flags.get("derived") ?? join_(ws, "derived.db")
  const r = await runVerify({
    vaultRoot: ws,
    derivedDbPath: derived,
    internetOff: !flags.has("online"),
    cloudOff: !flags.has("cloud"),
    deviceIsolated: !flags.has("device"),
    classCPresent: !flags.has("no-class-c"),
    classDPresent: !flags.has("no-class-d"),
    unifiaBinaryPresent: !flags.has("no-unifia"),
  })
  process.stdout.write(`vault:  ${r.vaultRoot}\n\n`)
  for (const c of r.checks) {
    process.stdout.write(
      `  ${c.status.padEnd(13)}${c.name.padEnd(20)}  ${c.details}  (${c.durationMs}ms)\n`,
    )
    // Name what is behind a WARN or a FAIL; a bare count is not actionable.
    for (const f of c.findings ?? []) {
      process.stdout.write(`      - ${f}\n`)
    }
  }
  const verdict = !r.ok ? "FAIL" : r.allPassed ? "OK" : "OK (warnings / not executed)"
  process.stdout.write(`\nverdict: ${verdict}  (total ${r.totalMs}ms)\n`)

  // `--strict` is what a CI gate should run: a check that warned or never
  // executed is not evidence of health, and exiting 0 on it turns the gate
  // into decoration. Interactive runs keep the lenient exit.
  const strict = flags.has("strict") || process.env.UNIFIA_VERIFY_STRICT === "1"
  if (strict && !r.allPassed) {
    process.stdout.write("strict: failing because not every check passed\n")
    return 1
  }
  return r.ok ? 0 : 1
}

// Tiny helper for joining paths without importing node:path
// at the top of this file (kept in one place for clarity).
function join_(...parts: string[]): string {
  return parts.join("/").replace(/[\\/]+/g, "/")
}

async function cmdPolicy(rest: readonly string[]): Promise<number> {
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

async function cmdGc(rest: readonly string[]): Promise<number> {
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

async function cmdSimilarity(rest: readonly string[]): Promise<number> {
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

async function cmdSummary(rest: readonly string[]): Promise<number> {
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

async function cmdDrill(): Promise<number> {
  try {
    const r = runDrill({ fs: stubFsWithClassA() })
    process.stdout.write(`drill: ${r.passed}/${r.total} scenarios OK (${r.durationMs}ms)\n`)
    for (const s of r.scenarios) {
      process.stdout.write(`  ${s.ok ? "PASS" : "FAIL"}  ${s.point.padEnd(34)}  ${s.invariant}\n`)
    }
    return r.failed === 0 ? 0 : 1
  } catch (e) {
    process.stderr.write(`drill error: ${(e as Error).message}\n`)
    return 1
  }
}

async function cmdValidate(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("validate: missing workspace path\n")
    return 2
  }
  try {
    const r = validate({ vaultRoot: ws })
    process.stdout.write(`vault:        ${r.vaultRoot}\n`)
    process.stdout.write(`notes parsed: ${r.notesParsed}\n`)
    process.stdout.write(`notes failed: ${r.notesFailed}\n`)
    process.stdout.write(`findings:     ${r.findings.length}\n`)
    for (const [cat, count] of Object.entries(r.byCategory)) {
      process.stdout.write(`  - ${cat}: ${count}\n`)
    }
    process.stdout.write(`\nelapsed:      ${r.durationMs}ms\n`)
    return r.findings.length === 0 ? 0 : 1
  } catch (e) {
    process.stderr.write(`validate error: ${(e as Error).message}\n`)
    return 1
  }
}

async function cmdReport(rest: readonly string[]): Promise<number> {
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
