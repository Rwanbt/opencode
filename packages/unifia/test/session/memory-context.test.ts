/* SPDX-License-Identifier: MIT */
/**
 * Automatic recall — the block injected into the system prompt.
 *
 * This is the piece that makes the vault a memory rather than a lookup
 * facility: the user should not have to know the feature exists for a
 * decision they made last week to be honoured today. The tests pin the two
 * properties that decide whether it can live on the turn's critical path —
 * it stays inside its budget, and it never fails the turn.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { recallMemoryContext, resetRecallCache } from "../../src/session/memory-context"
import {
  DEFAULT_MEMORY_DIRECTORY,
  resetMemoryCache,
} from "../../src/knowledge/app/memory"

let worktree: string
let vault: string

beforeEach(() => {
  worktree = mkdtempSync(join(tmpdir(), "unifia-recall-"))
  vault = join(worktree, DEFAULT_MEMORY_DIRECTORY)
})

afterEach(() => {
  resetMemoryCache()
  resetRecallCache()
  rmSync(worktree, { recursive: true, force: true })
})

function writeNote(
  name: string,
  body: string,
  restrictions: readonly string[] = ["  remote_model: allow", "  local_model: allow"],
): void {
  mkdirSync(vault, { recursive: true })
  writeFileSync(
    join(vault, name),
    [
      "---",
      "unifia_schema: 1",
      `unifia_id: "0190d2c0-7b00-7000-8000-${name.replace(/\D/g, "").padStart(12, "0").slice(-12)}"`,
      'unifia_type: "decision"',
      'unifia_lifecycle: "active"',
      'unifia_created_at: "2026-01-01T00:00:00Z"',
      'unifia_updated_at: "2026-08-01T00:00:00Z"',
      'unifia_project_ref: "unifia"',
      "unifia_supersedes: []",
      "unifia_tags: []",
      "unifia_restrictions:",
      ...restrictions,
      "---",
      body,
    ].join("\n"),
  )
}

const LOCAL = "local-llm"
const REMOTE = "anthropic"

describe("recallMemoryContext", () => {
  it("returns a block naming the notes it recalled", async () => {
    writeNote("n1.md", "We rejected Postgres because the workbench must run with no daemon.")
    const block = await recallMemoryContext({
      turnId: "turn-1",
      worktree,
      providerId: LOCAL,
      query: "Postgres daemon",
      budgetTokens: 800,
    })
    expect(block).toBeDefined()
    expect(block).toContain("<memory>")
    expect(block).toContain('locator="n1.md"')
    expect(block).toContain("no daemon")
    // It must tell the model what to do with them, or it is decoration.
    expect(block).toContain("memory_write")
  })

  it("stays silent when there is no vault", async () => {
    // Silent, not explanatory: a block saying "no memory" would spend the
    // budget on nothing, on every single turn.
    const block = await recallMemoryContext({
      turnId: "turn-2",
      worktree,
      providerId: LOCAL,
      query: "anything",
      budgetTokens: 800,
    })
    expect(block).toBeUndefined()
  })

  it("stays silent when nothing matches", async () => {
    writeNote("n1.md", "Something about caching layers.")
    const block = await recallMemoryContext({
      turnId: "turn-3",
      worktree,
      providerId: LOCAL,
      query: "zzzzz nonexistent term",
      budgetTokens: 800,
    })
    expect(block).toBeUndefined()
  })

  it("stays silent when memory is disabled", async () => {
    writeNote("n1.md", "Postgres was rejected.")
    const block = await recallMemoryContext({
      turnId: "turn-4",
      worktree,
      settings: { enabled: false },
      providerId: LOCAL,
      query: "Postgres",
      budgetTokens: 800,
    })
    expect(block).toBeUndefined()
  })

  it("stays silent on a zero budget rather than injecting anyway", async () => {
    writeNote("n1.md", "Postgres was rejected.")
    const block = await recallMemoryContext({
      turnId: "turn-5",
      worktree,
      providerId: LOCAL,
      query: "Postgres",
      budgetTokens: 0,
    })
    expect(block).toBeUndefined()
  })

  it("withholds from a remote model by default", async () => {
    writeNote("n1.md", "Postgres was rejected for a private reason.")
    const block = await recallMemoryContext({
      turnId: "turn-6",
      worktree,
      providerId: REMOTE,
      query: "Postgres",
      budgetTokens: 800,
    })
    // The whole vault is fail-closed toward a destination that leaves the
    // machine until the user says otherwise.
    expect(block).toBeUndefined()
  })

  it("recalls for a remote model once the user opened it", async () => {
    writeNote("n1.md", "Postgres was rejected because of the daemon.")
    const block = await recallMemoryContext({
      turnId: "turn-7",
      worktree,
      settings: { remote_recall: true },
      providerId: REMOTE,
      query: "Postgres daemon",
      budgetTokens: 800,
    })
    expect(block).toContain("daemon")
  })

  it("honours the token budget rather than the note count", async () => {
    for (let i = 1; i <= 5; i++) {
      writeNote(`n${i}.md`, `Postgres decision number ${i}. ${"padding ".repeat(200)}`)
    }
    const generous = await recallMemoryContext({
      turnId: "turn-8",
      worktree,
      providerId: LOCAL,
      query: "Postgres decision",
      budgetTokens: 2_000,
    })
    resetMemoryCache()
    const tight = await recallMemoryContext({
      turnId: "turn-9",
      worktree,
      providerId: LOCAL,
      query: "Postgres decision",
      budgetTokens: 200,
    })
    expect(generous).toBeDefined()
    expect(tight).toBeDefined()
    expect(tight!.length).toBeLessThan(generous!.length)
    // The budget is a ceiling, not a target: 200 tokens is ~800 chars plus
    // the framing, and the block must not blow past it wholesale.
    expect(tight!.length).toBeLessThan(2_000)
    // A budget too small for a whole note yields the top note cut, not
    // silence — a small local model is the case this vault serves best.
    expect(tight).toContain("cut to fit")
  })

  it("caps the number of notes at the configured maximum", async () => {
    for (let i = 1; i <= 8; i++) writeNote(`n${i}.md`, `Postgres decision number ${i}.`)
    const block = await recallMemoryContext({
      turnId: "turn-10",
      worktree,
      settings: { max_notes: 2 },
      providerId: LOCAL,
      query: "Postgres decision",
      budgetTokens: 4_000,
    })
    expect((block?.match(/<note /g) ?? []).length).toBe(2)
  })

  it("degrades the turn instead of failing it when the vault is corrupt", async () => {
    writeNote("n1.md", "Postgres was rejected.")
    // A policy file that cannot be parsed makes `readPolicy` throw, which is
    // the correct fail-closed behaviour for the core. On the prompt path it
    // must not take the user's turn down with it.
    mkdirSync(join(vault, ".unifia"), { recursive: true })
    writeFileSync(join(vault, ".unifia", "policy.json"), "{ this is not json")
    const block = await recallMemoryContext({
      turnId: "turn-11",
      worktree,
      providerId: LOCAL,
      query: "Postgres",
      budgetTokens: 800,
    })
    expect(block).toBeUndefined()
  })

  it("scans the vault once per turn, not once per step", async () => {
    // The agent loop rebuilds the system prompt on every step; a twenty-step
    // tool loop would otherwise be twenty vault scans for one question, and
    // a note written mid-turn would move the prompt under a conversation
    // already in flight.
    writeNote("n1.md", "Postgres was rejected because of the daemon.")
    const first = await recallMemoryContext({
      turnId: "same-turn",
      worktree,
      providerId: LOCAL,
      query: "Postgres daemon",
      budgetTokens: 800,
    })
    expect(first).toContain("daemon")

    // A second note appearing mid-turn must not change what this turn sees.
    writeNote("n2.md", "Postgres daemon second note entirely different.")
    const second = await recallMemoryContext({
      turnId: "same-turn",
      worktree,
      providerId: LOCAL,
      query: "Postgres daemon",
      budgetTokens: 800,
    })
    expect(second).toBe(first!)
  })

  it("asks again on the next turn, so recall follows the conversation", async () => {
    // The opposite failure to the one above, and the more damaging one: a
    // block loaded once for the whole discussion goes stale the moment the
    // subject changes.
    writeNote("n1.md", "Postgres was rejected because of the daemon.")
    const first = await recallMemoryContext({
      turnId: "turn-a",
      worktree,
      providerId: LOCAL,
      query: "Postgres daemon",
      budgetTokens: 800,
    })
    writeNote("n2.md", "Caching layers were chosen for the editor.")
    const second = await recallMemoryContext({
      turnId: "turn-b",
      worktree,
      providerId: LOCAL,
      query: "caching layers editor",
      budgetTokens: 800,
    })
    expect(first).toContain("daemon")
    expect(second).toContain("Caching layers")
  })

  it("remembers a miss, so an empty vault is not rescanned every step", async () => {
    const miss = await recallMemoryContext({
      turnId: "empty-turn",
      worktree,
      providerId: LOCAL,
      query: "nothing here",
      budgetTokens: 800,
    })
    expect(miss).toBeUndefined()
    // A miss costs the same scan as a hit, so it is cached too.
    writeNote("n1.md", "nothing here is now something.")
    const again = await recallMemoryContext({
      turnId: "empty-turn",
      worktree,
      providerId: LOCAL,
      query: "nothing here",
      budgetTokens: 800,
    })
    expect(again).toBeUndefined()
  })

  it("does not fabricate a query out of an empty message", async () => {
    writeNote("n1.md", "Postgres was rejected.")
    const block = await recallMemoryContext({
      turnId: "turn-12",
      worktree,
      providerId: LOCAL,
      query: "   ",
      budgetTokens: 800,
    })
    expect(block).toBeUndefined()
  })
})
