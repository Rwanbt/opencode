/* SPDX-License-Identifier: MIT */
/**
 * What retrieval does when it cannot finish (R-0018).
 *
 * Every version of the report carried the same caveat — "bounded lexical scan
 * validated on 11 notes, no claim beyond". Measuring it produced a number and
 * a defect. The number: on this machine, `search` costs about 3 ms per note,
 * so a 2 s deadline stops being enough somewhere past a thousand notes, and
 * past roughly two thousand the *listing alone* exceeds the budget and the
 * whole space is dropped before a single note is read.
 *
 * The defect is what the answer looked like then. `sourcesQueried` reported
 * the spaces the caller *asked for*, so a search that read nothing came back
 * as `candidates: []` from a space it never opened — indistinguishable from
 * "this space holds no match". That is the same shape of defect as a status
 * flag reporting a config intention instead of a fact.
 *
 * These tests force the deadline instead of building a huge vault: the
 * behaviour is what must hold, and pinning it to a machine's speed would make
 * the suite a benchmark. The measured figures live in
 * `scripts/knowledge-scale-bench.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { composeKnowledgeService } from "../../../src/knowledge/facade/compose.js"
import { writePolicy, DEFAULT_POLICY } from "../../../src/knowledge/policy/store.js"

function note(i: number, body: string): string {
  return [
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
    "  remote_model: allow",
    "---",
    body,
  ].join("\n")
}

describe("R-0018 — a search that could not finish says so", () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-scale-"))
    mkdirSync(join(root, "memory"), { recursive: true })
    for (let i = 0; i < 30; i++) {
      writeFileSync(join(root, "memory", `note-${i}.md`), note(i, `alpha beta note ${i}`))
    }
    writePolicy(root, {
      ...DEFAULT_POLICY,
      version: 1,
      egress: "allow",
      egressByDestination: {},
    })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const search = (deadlineMs: number) => {
    const { service } = composeKnowledgeService({
      workspaceRoot: root,
      providerId: "bench",
      destinationKind: "remote",
      // The trail is not what this test is about, and writing one per case
      // would put a control log in every temporary vault.
      ephemeralAudit: true,
    })
    return service.search({
      query: "alpha",
      spaces: [],
      types: [],
      tags: [],
      maxCandidates: 50,
      maxPayloadBytes: 1_000_000,
      maxSnippetBytes: 4096,
      deadlineMs,
    })
  }

  it("reports the spaces it actually opened, not the ones requested", async () => {
    const out = await search(30_000)
    expect(out.pack.items.length).toBeGreaterThan(0)
    expect(out.pack.diagnostics.sourcesQueried).toContain("personal")
    expect(out.truncated).toBe(false)
  })

  it("does not claim to have queried a space whose listing timed out", async () => {
    // A deadline nothing can meet: the listing is abandoned before any note
    // is read. The answer must not read as "searched, found nothing".
    const out = await search(1)
    expect(out.pack.items).toEqual([])
    expect(out.truncated).toBe(true)
    expect(out.pack.diagnostics.sourcesQueried).toEqual([])
    expect(out.pack.diagnostics.candidatesScanned).toBe(0)
  })

  it("names the space it gave up on, so the caller can tell why", async () => {
    const out = await search(1)
    // `excluded` is what the Context Inspector shows: an empty result with no
    // stated reason is the thing that cannot be debugged from the outside.
    expect(out.excluded.length).toBeGreaterThan(0)
    expect(out.excluded.some((e) => e.locator.startsWith("space:"))).toBe(true)
  })
})
