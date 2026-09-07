/* SPDX-License-Identifier: MIT */
/**
 * policy.json reaches the egress decision (card C4).
 *
 * Before this card readPolicy had exactly two consumers — the `policy` CLI
 * subcommand and a read-only report — so editing policy.json changed nothing
 * about what the router would emit.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  composeKnowledgeService,
  planFromPolicy,
} from "../../../src/knowledge/facade/compose.js"
import { writePolicy, DEFAULT_POLICY } from "../../../src/knowledge/policy/store.js"

const NOTE = [
  "---",
  "unifia_schema: 1",
  'unifia_id: "0190d2c0-7b00-7000-8000-000000000001"',
  'unifia_type: "decision"',
  'unifia_lifecycle: "active"',
  'unifia_created_at: "2026-08-01T00:00:00Z"',
  'unifia_updated_at: "2026-08-29T00:00:00Z"',
  'unifia_project_ref: "unifia"',
  "unifia_supersedes: []",
  'unifia_tags: ["alpha"]',
  "unifia_restrictions:",
  "  remote_model: allow",
  "  local_model: allow",
  "---",
  "alpha content in the vault",
].join("\n")

const SEARCH = {
  query: "alpha",
  spaces: [],
  types: [],
  tags: [],
  maxCandidates: 50,
  maxPayloadBytes: 1024 * 1024,
  maxSnippetBytes: 64 * 1024,
  deadlineMs: 2_000,
}

describe("C4 — planFromPolicy", () => {
  it("denies by default when the policy denies", () => {
    const plan = planFromPolicy({ ...DEFAULT_POLICY, egress: "deny" }, "cloud", "remote")
    expect(plan.defaultRestriction).toBe("deny")
  })

  it("allows when the policy allows globally", () => {
    const plan = planFromPolicy({ ...DEFAULT_POLICY, egress: "allow" }, "cloud", "remote")
    expect(plan.defaultRestriction).toBe("allow")
  })

  it("honours a per-destination override over the global default", () => {
    const plan = planFromPolicy(
      {
        ...DEFAULT_POLICY,
        egress: "deny",
        egressByDestination: { "provider:local-llm": "allow" },
      },
      "local-llm",
      "local",
    )
    expect(plan.defaultRestriction).toBe("allow")
  })

  it("carries the destination kind through to the plan", () => {
    expect(planFromPolicy(DEFAULT_POLICY, "p", "local").destinationKind).toBe("local")
    expect(planFromPolicy(DEFAULT_POLICY, "p", "remote").destinationKind).toBe("remote")
  })

  it("consults the operator's own setting where the vault policy is silent", () => {
    // The application's config and the vault's policy answer different
    // questions, and the vault has said nothing about this destination.
    const plan = planFromPolicy({ ...DEFAULT_POLICY, egress: "deny" }, "cloud", "remote", {
      "provider:cloud:remote": "allow",
    })
    expect(plan.defaultRestriction).toBe("allow")
  })

  it("lets the vault's own policy overrule the operator's setting", () => {
    // A vault that has stated its posture keeps it: a shared vault must not
    // be reopened by whoever happens to point an application at it.
    const plan = planFromPolicy(
      {
        ...DEFAULT_POLICY,
        egress: "allow",
        egressByDestination: { "provider:cloud:remote": "deny" },
      },
      "cloud",
      "remote",
      { "provider:cloud:remote": "allow" },
    )
    expect(plan.defaultRestriction).toBe("deny")
  })

  it("is unchanged when no operator setting is supplied", () => {
    // The parameter is additive: every existing caller keeps its behaviour.
    expect(planFromPolicy({ ...DEFAULT_POLICY, egress: "deny" }, "cloud", "remote", {})
      .defaultRestriction).toBe("deny")
    expect(planFromPolicy({ ...DEFAULT_POLICY, egress: "deny" }, "cloud", "remote")
      .defaultRestriction).toBe("deny")
  })
})

describe("C4 — policy.json reaches the ContextPack", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-compose-"))
    mkdirSync(join(root, "memory"))
    writeFileSync(join(root, "memory", "note.md"), NOTE)
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it("returns nothing when the workspace policy denies egress", async () => {
    writePolicy(root, { ...DEFAULT_POLICY, egress: "deny", version: 1 })
    const { service } = composeKnowledgeService({
      workspaceRoot: root,
      providerId: "cloud",
      destinationKind: "remote",
    })
    const { pack } = await service.search(SEARCH)
    expect(pack.items).toHaveLength(0)
  })

  it("returns the note once the same policy allows that destination", async () => {
    writePolicy(root, {
      ...DEFAULT_POLICY,
      version: 1,
      egress: "deny",
      egressByDestination: { "provider:cloud:remote": "allow" },
    })
    const { service } = composeKnowledgeService({
      workspaceRoot: root,
      providerId: "cloud",
      destinationKind: "remote",
    })
    const { pack } = await service.search(SEARCH)
    expect(pack.items.length).toBeGreaterThan(0)
  })

  it("fails closed when no policy file exists at all", async () => {
    const { policy, plan } = composeKnowledgeService({
      workspaceRoot: root,
      providerId: "cloud",
      destinationKind: "remote",
    })
    expect(policy.egress).toBe("deny")
    expect(plan.defaultRestriction).toBe("deny")
  })

  it("mounts only the spaces that exist on disk", () => {
    const bare = mkdtempSync(join(tmpdir(), "unifia-bare-"))
    try {
      const { mounted } = composeKnowledgeService({ workspaceRoot: bare, providerId: "p" })
      expect(mounted).toEqual(["project"])
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  })

  it("refuses a relative or missing workspace", () => {
    expect(() => composeKnowledgeService({ workspaceRoot: "rel", providerId: "p" })).toThrow(
      /absolute/,
    )
    expect(() =>
      composeKnowledgeService({ workspaceRoot: join(root, "nope"), providerId: "p" }),
    ).toThrow(/does not exist/)
  })

  it("reports status from the real mount, and fts disabled", async () => {
    writePolicy(root, { ...DEFAULT_POLICY, version: 1, egress: "allow" })
    const { service } = composeKnowledgeService({
      workspaceRoot: root,
      providerId: "local-llm",
      destinationKind: "local",
    })
    const status = await service.status()
    expect(status.enabled.fts).toBe(false)
    expect(status.enabled.vector).toBe(false)
    expect(status.candidatesCount).toBeGreaterThan(0)
    expect(status.spaces).toContain("personal")
  })
})

describe("C4 — facade refuses instead of returning an empty success", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-facade-"))
    mkdirSync(join(root, "memory"))
    writeFileSync(join(root, "memory", "note.md"), NOTE)
    writePolicy(root, { ...DEFAULT_POLICY, version: 1, egress: "allow" })
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it("get returns the real note rather than null", async () => {
    const { service } = composeKnowledgeService({
      workspaceRoot: root,
      providerId: "local-llm",
      destinationKind: "local",
    })
    const res = await service.get(undefined, "note.md")
    expect(res).not.toBeNull()
    expect(res?.candidates[0]?.snippet).toContain("alpha content")
    expect(res?.candidates[0]?.snippetHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("get returns null for a note that genuinely does not exist", async () => {
    const { service } = composeKnowledgeService({
      workspaceRoot: root,
      providerId: "local-llm",
      destinationKind: "local",
    })
    expect(await service.get(undefined, "absent.md")).toBeNull()
  })

  it("propose refuses loudly when no writer is configured", async () => {
    const { service } = composeKnowledgeService({
      workspaceRoot: root,
      providerId: "local-llm",
      destinationKind: "local",
    })
    await expect(
      service.propose({ intent: {}, reason: "r", source: "test" }),
    ).rejects.toThrow(/no Class A writer/)
  })

  it("backlinks resolves real wikilinks", async () => {
    writeFileSync(
      join(root, "memory", "linker.md"),
      NOTE.replace('"0190d2c0-7b00-7000-8000-000000000001"', '"0190d2c0-7b00-7000-8000-000000000002"').replace(
        "alpha content in the vault",
        "alpha points at [[note]] here",
      ),
    )
    const { service } = composeKnowledgeService({
      workspaceRoot: root,
      providerId: "local-llm",
      destinationKind: "local",
    })
    const links = await service.backlinks({ locator: "note.md" })
    expect(links).toContain("0190d2c0-7b00-7000-8000-000000000002")
  })
})
