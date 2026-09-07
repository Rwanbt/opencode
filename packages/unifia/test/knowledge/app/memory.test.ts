/* SPDX-License-Identifier: MIT */
/**
 * The vault the application opens.
 *
 * These tests pin the decisions that make memory a feature rather than a
 * library: where the vault lives, who may create it, and — the one that
 * carries real consequence — that opening it for a remote model does not
 * quietly widen what may leave the machine.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import {
  DEFAULT_MEMORY_DIRECTORY,
  memoryEnabled,
  openMemory,
  resetMemoryCache,
  resolveMemoryRoot,
} from "../../../src/knowledge/app/memory.js"
import { POLICY_FILE, readPolicy } from "../../../src/knowledge/policy/store.js"

let worktree: string

beforeEach(() => {
  worktree = mkdtempSync(join(tmpdir(), "unifia-memapp-"))
})

afterEach(() => {
  resetMemoryCache()
  rmSync(worktree, { recursive: true, force: true })
})

function note(body: string, restrictions: readonly string[]): string {
  return [
    "---",
    "unifia_schema: 1",
    'unifia_id: "0190d2c0-7b00-7000-8000-000000000001"',
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
  ].join("\n")
}

describe("resolveMemoryRoot", () => {
  it("defaults inside .unifia rather than at the worktree root", () => {
    // Mounting the repository itself would make every source file a note.
    expect(resolveMemoryRoot(worktree)).toBe(join(worktree, DEFAULT_MEMORY_DIRECTORY))
  })

  it("resolves a relative directory against the project", () => {
    expect(resolveMemoryRoot(worktree, { directory: "notes" })).toBe(join(worktree, "notes"))
  })

  it("accepts an absolute directory, so an existing vault can be used as is", () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "unifia-obsidian-"))
    try {
      expect(resolveMemoryRoot(worktree, { directory: elsewhere })).toBe(elsewhere)
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  it("treats an empty directory setting as unset", () => {
    expect(resolveMemoryRoot(worktree, { directory: "   " })).toBe(
      join(worktree, DEFAULT_MEMORY_DIRECTORY),
    )
  })
})

describe("memoryEnabled", () => {
  it("is on unless explicitly turned off", () => {
    // Opt-out: a memory the user must discover and enable stays empty.
    expect(memoryEnabled(undefined)).toBe(true)
    expect(memoryEnabled({})).toBe(true)
    expect(memoryEnabled({ enabled: false })).toBe(false)
  })
})

describe("openMemory", () => {
  it("returns undefined when no vault exists and creation was not asked for", () => {
    // A recall must never bring a directory into being.
    const composed = openMemory({
      worktree,
      providerId: "anthropic",
      destinationKind: "remote",
    })
    expect(composed).toBeUndefined()
    expect(existsSync(join(worktree, DEFAULT_MEMORY_DIRECTORY))).toBe(false)
  })

  it("creates the vault only for the write path", () => {
    const composed = openMemory({
      worktree,
      providerId: "anthropic",
      destinationKind: "remote",
      writable: true,
      create: true,
    })
    expect(composed).toBeDefined()
    expect(existsSync(join(worktree, DEFAULT_MEMORY_DIRECTORY))).toBe(true)
  })

  it("returns undefined when memory is disabled, even with create", () => {
    const composed = openMemory({
      worktree,
      settings: { enabled: false },
      providerId: "anthropic",
      destinationKind: "remote",
      create: true,
    })
    expect(composed).toBeUndefined()
    expect(existsSync(join(worktree, DEFAULT_MEMORY_DIRECTORY))).toBe(false)
  })

  it("seeds a fail-closed policy when it creates the vault", () => {
    openMemory({
      worktree,
      providerId: "anthropic",
      destinationKind: "remote",
      writable: true,
      create: true,
    })
    const policy = readPolicy(join(worktree, DEFAULT_MEMORY_DIRECTORY))
    expect(policy.egress).toBe("deny")
    expect(policy.egressByDestination).toEqual({})
  })

  it("opens the remote destination only when the user asked for it", () => {
    const denied = openMemory({
      worktree,
      providerId: "anthropic",
      destinationKind: "remote",
      writable: true,
      create: true,
    })
    expect(denied?.plan.defaultRestriction).toBe("deny")

    resetMemoryCache()
    const allowed = openMemory({
      worktree,
      settings: { remote_recall: true },
      providerId: "anthropic",
      destinationKind: "remote",
    })
    expect(allowed?.plan.defaultRestriction).toBe("allow")

    // And the setting stays a setting: it is never folded into the vault's
    // policy file, where flipping it back would have no effect.
    expect(readPolicy(join(worktree, DEFAULT_MEMORY_DIRECTORY)).egressByDestination).toEqual({})
  })

  it("lets the user turn recall back off after it was on", () => {
    // The regression this design had once: the decision was written into the
    // vault at creation, so it could be made exactly once.
    const base = { worktree, providerId: "anthropic", destinationKind: "remote" as const }
    openMemory({ ...base, settings: { remote_recall: true }, writable: true, create: true })
    const off = openMemory({ ...base, settings: { remote_recall: false } })
    expect(off?.plan.defaultRestriction).toBe("deny")
  })

  it("lets the vault's own policy overrule the application setting", () => {
    // Two files, two authorities, and the vault's is the stronger one: a
    // shared vault that has said no keeps saying no.
    const root = join(worktree, DEFAULT_MEMORY_DIRECTORY)
    mkdirSync(join(root, ".unifia"), { recursive: true })
    writeFileSync(
      join(root, POLICY_FILE),
      JSON.stringify({
        version: 1,
        egress: "deny",
        egressByDestination: { "provider:anthropic:remote": "deny" },
        features: { embedding: false, mcpServer: false, gitAutoPush: false },
        defaultTokenTtlMs: 3_600_000,
        trustedDevices: [],
        updatedAt: "2026-08-31T00:00:00.000Z",
      }),
    )
    const composed = openMemory({
      worktree,
      settings: { remote_recall: true },
      providerId: "anthropic",
      destinationKind: "remote",
    })
    expect(composed?.plan.defaultRestriction).toBe("deny")
  })

  it("never writes a policy into a vault it did not create", () => {
    // The user's own Obsidian vault is not ours to widen.
    const vault = join(worktree, "existing-vault")
    mkdirSync(vault, { recursive: true })
    openMemory({
      worktree,
      settings: { directory: vault, remote_recall: true },
      providerId: "anthropic",
      destinationKind: "remote",
      writable: true,
      create: true,
    })
    expect(existsSync(join(vault, POLICY_FILE))).toBe(false)
  })

  it("reuses one composition per vault, destination and writability", () => {
    const input = {
      worktree,
      providerId: "anthropic",
      destinationKind: "remote" as const,
      writable: true,
      create: true,
    }
    const first = openMemory(input)
    const second = openMemory(input)
    // Not merely equal: the same object, or a long-lived process accumulates
    // one control-log registration per call.
    expect(second).toBe(first!)
  })

  it("gives a different composition to a different destination", () => {
    const base = { worktree, writable: true, create: true }
    const remote = openMemory({ ...base, providerId: "anthropic", destinationKind: "remote" })
    const local = openMemory({ ...base, providerId: "local-llm", destinationKind: "local" })
    expect(local).not.toBe(remote!)
  })

  it("recomposes when the policy file changes on disk", async () => {
    const input = {
      worktree,
      providerId: "anthropic",
      destinationKind: "remote" as const,
      create: true,
      writable: true,
    }
    const first = openMemory(input)
    const root = join(worktree, DEFAULT_MEMORY_DIRECTORY)
    // An operator editing the policy must not have to restart the process.
    await Bun.sleep(10)
    const policy = JSON.parse(readFileSync(join(root, POLICY_FILE), "utf8")) as Record<string, unknown>
    policy.egress = "allow"
    writeFileSync(join(root, POLICY_FILE), JSON.stringify(policy, null, 2))
    const second = openMemory(input)
    expect(second).not.toBe(first!)
    expect(second?.policy.egress).toBe("allow")
  })
})

describe("openMemory — the egress policy still governs what it serves", () => {
  function seedVault(restrictions: readonly string[]): string {
    const root = join(worktree, DEFAULT_MEMORY_DIRECTORY)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, "d.md"), note("alpha the decisive fact", restrictions))
    return root
  }

  const bounds = {
    spaces: [],
    types: [],
    tags: [],
    maxCandidates: 10,
    maxPayloadBytes: 64 * 1024,
    maxSnippetBytes: 2_000,
    deadlineMs: 5_000,
  }

  it("serves a note to a local model without any configuration at all", async () => {
    // The sovereign default has to be usable: on-device reading of one's own
    // vault is not egress, so an unconfigured workspace is not mute.
    seedVault(["  remote_model: allow", "  local_model: allow"])
    const composed = openMemory({
      worktree,
      providerId: "local-llm",
      destinationKind: "local",
    })
    const result = await composed!.service.search({ query: "alpha", ...bounds })
    expect(result.pack.items.length).toBe(1)
  })

  it("withholds it from a remote model until the user opens that destination", async () => {
    seedVault(["  remote_model: allow", "  local_model: allow"])
    const composed = openMemory({
      worktree,
      providerId: "anthropic",
      destinationKind: "remote",
    })
    const result = await composed!.service.search({ query: "alpha", ...bounds })
    // The vault's own policy denies the destination; the note saying it would
    // tolerate a remote model cannot widen that.
    expect(result.pack.items.length).toBe(0)
    expect(result.pack.diagnostics.candidatesDroppedByRestriction).toBeGreaterThan(0)
  })

  it("still withholds a `remote_model: deny` note once the destination is open", async () => {
    // Two independent gates. Opening the vault must not open every note in it.
    seedVault(["  remote_model: deny", "  local_model: allow"])
    const composed = openMemory({
      worktree,
      settings: { remote_recall: true },
      providerId: "anthropic",
      destinationKind: "remote",
    })
    expect(composed?.plan.defaultRestriction).toBe("allow")
    const result = await composed!.service.search({ query: "alpha", ...bounds })
    expect(result.pack.items.length).toBe(0)
  })

  it("serves the note when both gates are open", async () => {
    seedVault(["  remote_model: allow", "  local_model: allow"])
    const composed = openMemory({
      worktree,
      settings: { remote_recall: true },
      providerId: "anthropic",
      destinationKind: "remote",
    })
    const result = await composed!.service.search({ query: "alpha", ...bounds })
    expect(result.pack.items.length).toBe(1)
    expect(result.pack.items[0]?.snippet).toContain("decisive")
  })

  it("writes the egress trail into the vault, not the project", async () => {
    const root = seedVault(["  remote_model: allow", "  local_model: allow"])
    const composed = openMemory({
      worktree,
      providerId: "local-llm",
      destinationKind: "local",
    })
    await composed!.service.search({ query: "alpha", ...bounds })
    composed!.controlLog?.flush()
    const log = join(root, ".unifia", "control-log.jsonl")
    expect(existsSync(log)).toBe(true)
    expect(existsSync(join(worktree, ".unifia", "control-log.jsonl"))).toBe(false)
  })

  it("does not mount the project tree as a second copy of the vault", async () => {
    // The vault root is the project space; a `memory/` inside it would be the
    // personal space. Both must not return the same note twice.
    const root = seedVault(["  remote_model: allow", "  local_model: allow"])
    expect(root.split(sep).slice(-2).join("/")).toBe(".unifia/memory")
    const composed = openMemory({
      worktree,
      providerId: "local-llm",
      destinationKind: "local",
    })
    const result = await composed!.service.search({ query: "alpha", ...bounds })
    expect(result.pack.items.length).toBe(1)
  })
})
