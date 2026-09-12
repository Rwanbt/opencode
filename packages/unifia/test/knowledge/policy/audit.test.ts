/* SPDX-License-Identifier: MIT */
/**
 * Every egress decision is traced (ADR-KNOW-0006 §6, R-0012).
 *
 * The `egress.decision` event kind was declared on the domain bus and nothing
 * ever emitted it, so the invariant "every egress is traced" was documented
 * and not held. `decideEgress` stays pure — a decision function that logs
 * cannot be tested without a sink — so emission is the caller's job, and the
 * composition root wires the sink rather than leaving it optional.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { composeKnowledgeService } from "../../../src/knowledge/facade/compose.js"
import {
  InMemoryEgressAudit,
  egressAuditEntry,
  EGRESS_GUARD_VERSION,
} from "../../../src/knowledge/policy/audit.js"
import { DomainBus, type DomainEvent } from "../../../src/knowledge/events/bus.js"
import { writePolicy, DEFAULT_POLICY } from "../../../src/knowledge/policy/store.js"

function note(id: string, body: string, restrictions?: string[]) {
  return [
    "---",
    "unifia_schema: 1",
    `unifia_id: "0190d2c0-7b00-7000-8000-${id.padStart(12, "0")}"`,
    'unifia_type: "decision"',
    'unifia_lifecycle: "active"',
    'unifia_created_at: "2026-08-01T00:00:00Z"',
    'unifia_updated_at: "2026-08-29T00:00:00Z"',
    'unifia_project_ref: "unifia"',
    "unifia_supersedes: []",
    "unifia_tags: []",
    ...(restrictions ? ["unifia_restrictions:", ...restrictions] : []),
    "---",
    body,
  ].join("\n")
}

const SEARCH = {
  spaces: [],
  types: [],
  tags: [],
  maxCandidates: 50,
  maxPayloadBytes: 1_000_000,
  maxSnippetBytes: 65_536,
  deadlineMs: 2_000,
}

describe("egressAuditEntry", () => {
  const item = {
    ref: { id: "0190d2c0-7b00-7000-8000-000000000001", locator: "n.md" },
    source: "personal",
    type: "decision",
    trust: "verified",
    authority: "user",
    restriction: "deny",
    relevance: 1,
    tokenCost: 0,
    contentHash: "a".repeat(64),
    snippet: "",
    reason: "test",
  } as never

  it("records the hash, decision, reason and guard version", () => {
    const e = egressAuditEntry(
      item,
      { providerId: "cloud", destinationKind: "remote", defaultRestriction: "allow" },
      { decision: "deny", reason: "item portable restriction is deny" },
    )
    expect(e.hash).toBe("a".repeat(64))
    expect(e.decision).toBe("deny")
    expect(e.reason).toContain("portable restriction")
    expect(e.guardVersion).toBe(EGRESS_GUARD_VERSION)
    expect(Number.isFinite(Date.parse(e.timestamp))).toBe(true)
  })

  it("qualifies the destination by local or remote", () => {
    const local = egressAuditEntry(
      item,
      { providerId: "cli", destinationKind: "local", defaultRestriction: "allow" },
      { decision: "allow", reason: "no restriction" },
    )
    const remote = egressAuditEntry(
      item,
      { providerId: "cli", destinationKind: "remote", defaultRestriction: "allow" },
      { decision: "allow", reason: "no restriction" },
    )
    expect(local.destination).toBe("provider:cli")
    expect(remote.destination).toBe("provider:cli:remote")
  })
})

describe("InMemoryEgressAudit", () => {
  it("emits egress.decision on the bus", () => {
    const bus = new DomainBus()
    const seen: DomainEvent[] = []
    bus.on("egress.decision", (e) => seen.push(e))
    new InMemoryEgressAudit(bus).record({
      hash: "b".repeat(64),
      destination: "provider:cloud:remote",
      decision: "deny",
      reason: "r",
      guardVersion: EGRESS_GUARD_VERSION,
      timestamp: new Date().toISOString(),
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.payload.decision).toBe("deny")
    expect(seen[0]?.payload.hash).toBe("b".repeat(64))
  })

  it("tallies allows and denies separately", () => {
    const a = new InMemoryEgressAudit()
    const base = {
      hash: "c".repeat(64),
      destination: "d",
      reason: "r",
      guardVersion: EGRESS_GUARD_VERSION,
      timestamp: new Date().toISOString(),
    }
    a.record({ ...base, decision: "allow" })
    a.record({ ...base, decision: "deny" })
    a.record({ ...base, decision: "deny" })
    expect(a.tally()).toEqual({ allow: 1, deny: 2 })
  })
})

describe("R-0012 §6 — the composition traces every decision", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-audit-"))
    mkdirSync(join(root, "memory"))
    writeFileSync(join(root, "memory", "open.md"), note("1", "alpha public", ["  remote_model: allow"]))
    writeFileSync(join(root, "memory", "shut.md"), note("2", "alpha secret", ["  remote_model: deny"]))
    writePolicy(root, {
      ...DEFAULT_POLICY,
      version: 1,
      egress: "deny",
      egressByDestination: { "provider:cloud:remote": "allow" },
    })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const remote = () =>
    composeKnowledgeService({ workspaceRoot: root, providerId: "cloud", destinationKind: "remote" })

  it("records a search decision for every candidate, allow and deny alike", async () => {
    const { service, audit } = remote()
    await service.search({ ...SEARCH, query: "alpha" })
    const tally = audit.tally()
    expect(tally.allow).toBeGreaterThan(0)
    expect(tally.deny).toBeGreaterThan(0)
    expect(audit.entries().every((e) => e.guardVersion === EGRESS_GUARD_VERSION)).toBe(true)
  })

  it("records the refusal that withheld a note, with its reason", async () => {
    const { service, audit } = remote()
    await service.search({ ...SEARCH, query: "alpha" })
    const denied = audit.entries().filter((e) => e.decision === "deny")
    expect(denied.length).toBeGreaterThan(0)
    expect(denied[0]?.reason).toMatch(/restriction|provenance|default/)
  })

  it("records a decision for get, not only for search", async () => {
    const { service, audit } = remote()
    await service.get(undefined, "shut.md")
    expect(audit.entries()).toHaveLength(1)
    expect(audit.entries()[0]?.decision).toBe("deny")
  })

  it("records a decision for backlinks", async () => {
    const { service, audit } = remote()
    await service.backlinks({ locator: "open.md" })
    expect(audit.entries().length).toBeGreaterThan(0)
  })

  it("emits on the bus the composition exposes", async () => {
    const { service, bus } = remote()
    const seen: DomainEvent[] = []
    bus.on("egress.decision", (e) => seen.push(e))
    await service.search({ ...SEARCH, query: "alpha" })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((e) => e.kind === "egress.decision")).toBe(true)
  })

  it("names the destination the decision was made against", async () => {
    const { service, audit } = remote()
    await service.search({ ...SEARCH, query: "alpha" })
    expect(audit.entries().every((e) => e.destination === "provider:cloud:remote")).toBe(true)
  })
})
