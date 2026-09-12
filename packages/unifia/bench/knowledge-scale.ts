/* SPDX-License-Identifier: MIT */
/**
 * Where the knowledge retrieval stops working (R-0018).
 *
 * Every draft of the Sovereign Knowledge Core report carried the same
 * sentence: *bounded lexical scan validated on 11 notes, no claim beyond*.
 * A caveat repeated often enough starts to read as a measurement. It was not
 * one, so this script makes it one.
 *
 * V1 ships no FTS index: `search` lists a space, reads every note in it and
 * scores the body. That is O(N) file reads, and the deadline is the only
 * thing standing between a large vault and an unbounded call. This measures
 * the constant, and finds the vault size at which a realistic deadline stops
 * being enough.
 *
 * Run:
 *
 *   cd packages/unifia && bun bench/knowledge-scale.ts [sizes...]
 *
 * The numbers are machine-specific — an SSD, a cold cache and a virus
 * scanner move them a lot. What is *not* machine-specific, and is pinned by
 * `test/knowledge/context/scale.test.ts`, is the behaviour when the deadline
 * runs out: the answer must say which spaces it actually opened, so an empty
 * result is never mistaken for "nothing matched".
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { composeKnowledgeService } from "../src/knowledge/facade/compose.js"
import { writePolicy, DEFAULT_POLICY } from "../src/knowledge/policy/store.js"
import { VaultSource } from "../src/knowledge/source/vault.js"
import type { KnowledgeLocator } from "@unifia/contracts/knowledge"

/** The deadline a caller would realistically send. */
const REALISTIC_DEADLINE_MS = 2_000

/** The contract ceiling: `RetrievalRequestSchema` refuses anything larger. */
const MAX_DEADLINE_MS = 60_000

/** Wide enough that the scan is not measuring one lucky page of cache. */
const DEFAULT_SIZES = [100, 250, 500, 1_000, 2_000]

const WORDS = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"]

function buildVault(count: number): string {
  const root = mkdtempSync(join(tmpdir(), "unifia-scale-bench-"))
  mkdirSync(join(root, "memory"), { recursive: true })
  for (let i = 0; i < count; i++) {
    const body = Array.from(
      { length: 40 },
      (_, line) => `${WORDS[(i + line) % WORDS.length]} line ${line} of note ${i}`,
    ).join("\n")
    writeFileSync(
      join(root, "memory", `note-${i}.md`),
      [
        "---",
        "unifia_schema: 1",
        `unifia_id: "0190d2c0-7b00-7000-8000-${String(i).padStart(12, "0")}"`,
        'unifia_type: "decision"',
        'unifia_lifecycle: "active"',
        'unifia_created_at: "2026-01-01T00:00:00Z"',
        'unifia_updated_at: "2026-08-01T00:00:00Z"',
        'unifia_project_ref: "unifia"',
        "unifia_supersedes: []",
        "unifia_tags: []",
        "unifia_restrictions:",
        // Without this the default is deny, and the run would measure the
        // guard refusing everything rather than the scan.
        "  remote_model: allow",
        "---",
        body,
      ].join("\n"),
    )
  }
  writePolicy(root, { ...DEFAULT_POLICY, version: 1, egress: "allow", egressByDestination: {} })
  return root
}

async function measure(count: number): Promise<void> {
  const root = buildVault(count)
  try {
    const source = new VaultSource({
      root: join(root, "memory"),
      space: { kind: "personal", id: "personal", label: "Personal" },
    })
    const listStart = performance.now()
    await source.list({})
    const listMs = performance.now() - listStart

    const { service, controlLog } = composeKnowledgeService({
      workspaceRoot: root,
      providerId: "bench",
      destinationKind: "remote",
    })

    const request = (deadlineMs: number) => ({
      query: "alpha",
      spaces: [] as string[],
      types: [] as string[],
      tags: [] as string[],
      maxCandidates: 50,
      maxPayloadBytes: 1_000_000,
      maxSnippetBytes: 4_096,
      deadlineMs,
    })

    const boundedStart = performance.now()
    const bounded = await service.search(request(REALISTIC_DEADLINE_MS))
    const boundedMs = performance.now() - boundedStart

    const fullStart = performance.now()
    // 60 s is the contract ceiling on `deadlineMs`, so this is the most
    // exhaustive scan a caller can ever ask for — past the vault size where
    // it no longer fits, no deadline makes the search complete.
    const full = await service.search(request(MAX_DEADLINE_MS))
    const fullMs = performance.now() - fullStart

    const backlinksStart = performance.now()
    await service.backlinks({ locator: "note-1.md" as KnowledgeLocator })
    const backlinksMs = performance.now() - backlinksStart

    controlLog?.flush()

    console.log(
      [
        String(count).padStart(6),
        `${listMs.toFixed(0)}ms`.padStart(9),
        `${fullMs.toFixed(0)}ms`.padStart(10),
        `${(fullMs / count).toFixed(2)}ms`.padStart(10),
        `${boundedMs.toFixed(0)}ms`.padStart(10),
        String(bounded.pack.items.length).padStart(6),
        String(bounded.truncated).padStart(10),
        (bounded.pack.diagnostics.sourcesQueried.join(",") || "—").padStart(12),
        `${backlinksMs.toFixed(0)}ms`.padStart(11),
      ].join(""),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const sizes = process.argv.slice(2).map(Number).filter(Number.isFinite)
const targets = sizes.length > 0 ? sizes : DEFAULT_SIZES

console.log(`knowledge retrieval scale — deadline ${REALISTIC_DEADLINE_MS} ms\n`)
console.log(
  [
    "notes".padStart(6),
    "list()".padStart(9),
    "search".padStart(10),
    "per note".padStart(10),
    "@deadline".padStart(10),
    "items".padStart(6),
    "truncated".padStart(10),
    "queried".padStart(12),
    "backlinks".padStart(11),
  ].join(""),
)
for (const count of targets) await measure(count)
console.log(
  "\n`queried` is the spaces the search actually opened. When it is empty the\n" +
    "listing itself blew the deadline: nothing was read, and an empty result\n" +
    "there does not mean the vault holds no match.",
)
