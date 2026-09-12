/* SPDX-License-Identifier: MIT */
/**
 * The Class C control log and declassification grants (R-0015).
 *
 * Two halves of the same gap. ADR-KNOW-0006 §6 asks that every egress
 * decision be *auditable*, which the in-memory sink could not deliver past a
 * restart; §3 describes a `DeclassificationGrant` that nothing implemented,
 * so the only way to share a restricted note was to edit the note.
 *
 * What these tests are really guarding is a property that no unit test of the
 * guard can express on its own: after the process is gone, the answer to
 * *did this note ever leave?* is still on disk, and the one mechanism that
 * can widen a refusal leaves a mark when it does.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import type { ContextItem, ProviderDestinationPlan } from "@unifia/contracts/knowledge"
import {
  PersistentEgressAudit,
  CONTROL_LOG_FILE,
  FLUSH_AT_ENTRIES,
} from "../../../src/knowledge/policy/control-log.js"
import { egressAuditEntry, EGRESS_GUARD_VERSION } from "../../../src/knowledge/policy/audit.js"
import { clearForEgress, destinationOf } from "../../../src/knowledge/policy/egress.js"
import {
  GrantRegistry,
  DEFAULT_GRANT_TTL_MS,
  MAX_GRANT_TTL_MS,
} from "../../../src/knowledge/policy/grant.js"
import { DomainBus } from "../../../src/knowledge/events/bus.js"

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")

const SECRET = "the body nobody may read"
const HASH = sha256(SECRET)

const REMOTE: ProviderDestinationPlan = {
  providerId: "anthropic",
  destinationKind: "remote",
  defaultRestriction: "allow",
}
const LOCAL: ProviderDestinationPlan = {
  providerId: "llama",
  destinationKind: "local",
  defaultRestriction: "allow",
}

function item(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    ref: { id: "0190d2c0-7b00-7000-8000-000000000001", locator: "secret.md" },
    source: "personal",
    type: "decision",
    trust: "verified",
    authority: "user",
    restriction: "deny",
    relevance: 1,
    tokenCost: 0,
    contentHash: HASH,
    snippet: SECRET,
    reason: "test",
    ...overrides,
  } as ContextItem
}

// ---------------------------------------------------------------------------
// The trail outlives the process.
// ---------------------------------------------------------------------------

describe("R-0015 — the egress trail is persisted", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-ctl-"))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("answers 'did this content ever leave' after the sink is gone", () => {
    const first = new PersistentEgressAudit(root)
    first.record(egressAuditEntry(item({ restriction: "allow" }), REMOTE, {
      decision: "allow",
      reason: "no restriction",
    }))
    first.flush()

    // A different instance: nothing carried over in memory.
    const later = new PersistentEgressAudit(root)
    expect(later.destinationsFor(HASH)).toEqual([
      {
        destination: "provider:anthropic:remote",
        decision: "allow",
        timestamp: expect.any(String),
      },
    ])
  })

  it("records refusals too, so the trail shows what did not leave", () => {
    const audit = new PersistentEgressAudit(root)
    audit.record(egressAuditEntry(item(), REMOTE, { decision: "deny", reason: "item denies" }))
    audit.flush()
    expect(new PersistentEgressAudit(root).tally()).toEqual({ allow: 0, deny: 1 })
  })

  it("never writes the note body, a snippet or a locator", () => {
    const audit = new PersistentEgressAudit(root)
    audit.record(egressAuditEntry(item(), REMOTE, { decision: "deny", reason: "item denies" }))
    audit.flush()
    const raw = readFileSync(join(root, CONTROL_LOG_FILE), "utf8")
    // The whole point of a guard is undone by a log that quotes what it
    // withheld.
    expect(raw).not.toContain(SECRET)
    expect(raw).not.toContain("secret.md")
    expect(raw).toContain(HASH)
    expect(Object.keys(JSON.parse(raw.trim()) as object).sort()).toEqual([
      "decision",
      "destination",
      "guardVersion",
      "hash",
      "reason",
      "timestamp",
    ])
  })

  it("states which rules were in force when it decided", () => {
    const audit = new PersistentEgressAudit(root)
    audit.record(egressAuditEntry(item(), REMOTE, { decision: "deny", reason: "r" }))
    audit.flush()
    expect(audit.entries()[0]?.guardVersion).toBe(EGRESS_GUARD_VERSION)
  })

  it("distinguishes a local destination from a remote one", () => {
    const audit = new PersistentEgressAudit(root)
    audit.record(egressAuditEntry(item(), LOCAL, { decision: "allow", reason: "r" }))
    audit.record(egressAuditEntry(item(), REMOTE, { decision: "deny", reason: "r" }))
    audit.flush()
    expect(audit.entries().map((e) => e.destination)).toEqual([
      "provider:llama",
      "provider:anthropic:remote",
    ])
  })
})

// ---------------------------------------------------------------------------
// Batching: the bounded window, stated and tested.
// ---------------------------------------------------------------------------

describe("R-0015 — batching keeps the audit affordable", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-ctl-b-"))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const entry = () => egressAuditEntry(item(), REMOTE, { decision: "deny", reason: "r" })

  it("does not touch the disk on every decision", () => {
    const audit = new PersistentEgressAudit(root)
    audit.record(entry())
    expect(existsSync(join(root, CONTROL_LOG_FILE))).toBe(false)
    expect(audit.pendingCount).toBe(1)
  })

  it("still reports buffered decisions to a reader", () => {
    // Otherwise `status` would under-report the current session, which is the
    // session an operator is most likely asking about.
    const audit = new PersistentEgressAudit(root)
    audit.record(entry())
    expect(audit.tally()).toEqual({ allow: 0, deny: 1 })
  })

  it("flushes on its own before the buffer can grow unbounded", () => {
    const audit = new PersistentEgressAudit(root)
    for (let i = 0; i < FLUSH_AT_ENTRIES; i++) audit.record(entry())
    expect(audit.pendingCount).toBe(0)
    expect(new PersistentEgressAudit(root).entries()).toHaveLength(FLUSH_AT_ENTRIES)
  })

  it("writes one line per decision, not one blob per batch", () => {
    const audit = new PersistentEgressAudit(root)
    audit.record(entry())
    audit.record(entry())
    audit.flush()
    const lines = readFileSync(join(root, CONTROL_LOG_FILE), "utf8").trim().split("\n")
    expect(lines).toHaveLength(2)
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow()
  })

  it("does not concatenate onto a line a crash left torn", () => {
    // Same failure the WAL had: without a separator the torn tail and the new
    // batch merge into one unparseable line, so one interrupted write would
    // also destroy the next.
    const file = join(root, CONTROL_LOG_FILE)
    require("node:fs").mkdirSync(join(root, ".unifia"), { recursive: true })
    writeFileSync(file, '{"hash":"aaa","decision":"al')
    const audit = new PersistentEgressAudit(root)
    audit.record(entry())
    audit.flush()
    expect(audit.entries()).toHaveLength(1)
  })

  it("flush is safe to call when nothing is pending", () => {
    const audit = new PersistentEgressAudit(root)
    expect(() => {
      audit.flush()
      audit.flush()
    }).not.toThrow()
    expect(existsSync(join(root, CONTROL_LOG_FILE))).toBe(false)
  })

  it("keeps the entries when the write fails, and refuses to record after", () => {
    const audit = new PersistentEgressAudit(root)
    audit.record(entry())
    // A directory where the log file belongs: the append cannot succeed.
    require("node:fs").mkdirSync(join(root, CONTROL_LOG_FILE), { recursive: true })
    expect(() => audit.flush()).toThrow()
    expect(audit.pendingCount).toBe(1)
    expect(audit.broken).not.toBeNull()
    // Serving content while unable to say where it went is the failure this
    // module exists to prevent, so it stops rather than degrading quietly.
    expect(() => audit.record(entry())).toThrow(/unwritable/)
  })
})

// ---------------------------------------------------------------------------
// The bus still sees decisions immediately.
// ---------------------------------------------------------------------------

describe("R-0015 — live subscribers do not wait for a flush", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-ctl-bus-"))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("emits egress.decision as it happens", () => {
    const bus = new DomainBus()
    const seen: unknown[] = []
    bus.on("egress.decision", (e) => seen.push(e.payload))
    new PersistentEgressAudit(root, bus).record(
      egressAuditEntry(item(), REMOTE, { decision: "deny", reason: "item denies" }),
    )
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ hash: HASH, destination: "provider:anthropic:remote" })
  })

  it("does not put the body on the bus either", () => {
    const bus = new DomainBus()
    const seen: string[] = []
    bus.onAny((e) => seen.push(JSON.stringify(e)))
    new PersistentEgressAudit(root, bus).record(
      egressAuditEntry(item(), REMOTE, { decision: "deny", reason: "r" }),
    )
    expect(seen.join("")).not.toContain(SECRET)
  })
})

// ---------------------------------------------------------------------------
// Declassification grants — ADR-KNOW-0006 §3.
// ---------------------------------------------------------------------------

describe("ADR-KNOW-0006 §3 — a grant is the only thing that widens a deny", () => {
  const grantFor = (registry: GrantRegistry, plan = REMOTE, hash = HASH) =>
    registry.issue({
      contentHash: hash,
      destination: destinationOf(plan),
      grantedBy: "owner",
      reason: "sharing this one decision with the vendor",
    })

  it("still denies when no registry is supplied — V1 behaviour is unchanged", () => {
    expect(clearForEgress({ item: item(), plan: REMOTE }).cleared).toBe(false)
  })

  it("clears a denied item once, for that content and that destination", () => {
    const grants = new GrantRegistry()
    const g = grantFor(grants)
    const verdict = clearForEgress({ item: item(), plan: REMOTE, grants })
    expect(verdict.cleared).toBe(true)
    expect(verdict.result.reason).toContain(g.id)
  })

  it("is spent by the first egress it authorises", () => {
    const grants = new GrantRegistry()
    grantFor(grants)
    expect(clearForEgress({ item: item(), plan: REMOTE, grants }).cleared).toBe(true)
    // A single act of consent must not become a standing permission.
    expect(clearForEgress({ item: item(), plan: REMOTE, grants }).cleared).toBe(false)
  })

  it("does not cover a different destination", () => {
    const grants = new GrantRegistry()
    grantFor(grants, LOCAL)
    // Consent to send something to a local model is not consent to send it
    // to a cloud provider.
    expect(clearForEgress({ item: item(), plan: REMOTE, grants }).cleared).toBe(false)
  })

  it("does not cover content the granter never saw", () => {
    const grants = new GrantRegistry()
    grantFor(grants, REMOTE, sha256("a different body"))
    expect(clearForEgress({ item: item(), plan: REMOTE, grants }).cleared).toBe(false)
  })

  it("expires", () => {
    const grants = new GrantRegistry()
    grantFor(grants)
    expect(grants.consume(HASH, destinationOf(REMOTE), Date.now() + DEFAULT_GRANT_TTL_MS)).toBeNull()
  })

  it("can be revoked before it is spent", () => {
    const grants = new GrantRegistry()
    const g = grantFor(grants)
    grants.revoke(g.id)
    expect(clearForEgress({ item: item(), plan: REMOTE, grants }).cleared).toBe(false)
    expect(grants.active()).toEqual([])
  })

  it("refuses to exist without a reason, a destination or an exact hash", () => {
    const grants = new GrantRegistry()
    const base = { contentHash: HASH, destination: "provider:x:remote", grantedBy: "o" }
    expect(() => grants.issue({ ...base, reason: "  " })).toThrow(/reason/)
    expect(() => grants.issue({ ...base, destination: "", reason: "r" })).toThrow(/destination/)
    expect(() => grants.issue({ ...base, contentHash: "not-a-hash", reason: "r" })).toThrow(
      /content hash/,
    )
  })

  it("cannot be issued for longer than the ceiling", () => {
    const grants = new GrantRegistry()
    expect(() =>
      grants.issue({
        contentHash: HASH,
        destination: "provider:x:remote",
        grantedBy: "o",
        reason: "r",
        ttlMs: MAX_GRANT_TTL_MS + 1,
      }),
    ).toThrow(/maximum/)
  })

  it("leaves a trail naming the grant that overturned the refusal", () => {
    const root = mkdtempSync(join(tmpdir(), "unifia-grant-"))
    try {
      const grants = new GrantRegistry()
      const g = grantFor(grants)
      const audit = new PersistentEgressAudit(root)
      const it0 = item()
      const verdict = clearForEgress({ item: it0, plan: REMOTE, grants })
      audit.record(egressAuditEntry(it0, REMOTE, verdict.result))
      audit.flush()
      // The one path that widens is the one that most needs a record.
      const line = readFileSync(join(root, CONTROL_LOG_FILE), "utf8")
      expect(line).toContain(g.id)
      expect(line).toContain('"decision":"allow"')
      expect(line).not.toContain(SECRET)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("cannot rescue an item the guard would have denied for another reason", () => {
    // The grant is bound to content and destination, not to a rule. An
    // unverified-provenance refusal toward a remote destination is a
    // different question from "may this note be shared", but a grant issued
    // for that content does overturn it — so the test pins what actually
    // happens rather than what sounds reassuring.
    const grants = new GrantRegistry()
    const unverified = item({ restriction: "allow", trust: "unverified" })
    expect(clearForEgress({ item: unverified, plan: REMOTE }).cleared).toBe(false)
    grants.issue({
      contentHash: HASH,
      destination: destinationOf(REMOTE),
      grantedBy: "owner",
      reason: "reviewed by hand",
    })
    const v = clearForEgress({ item: unverified, plan: REMOTE, grants })
    expect(v.cleared).toBe(true)
    expect(v.result.reason).toContain("provenance is unverified")
  })
})
