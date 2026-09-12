/* SPDX-License-Identifier: MIT */
/**
 * The rest of the user's rights over their own data (cards C34, C35, R-0017).
 *
 * The product promised the right to see, edit, delete and export. Delete
 * landed with C33; this covers emptying the trash — the only operation that
 * actually erases — plus export and retention.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { VaultMutationWriter, TRASH_DIR } from "../../../src/knowledge/mutation/writer.js"
import { exportVault, verifyExport } from "../../../src/knowledge/admin/export.js"
import {
  retentionReport,
  formatRetention,
  DEFAULT_CANDIDATE_TTL_DAYS,
} from "../../../src/knowledge/admin/retention.js"
import { parseFrontmatter } from "../../../src/knowledge/parser/frontmatter.js"

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")

const OPEN = {
  remoteModel: "deny",
  localModel: "allow",
  embeddable: "allow",
  exportable: "deny",
} as const

function note(id: string, body: string, opts: { lifecycle?: string; updated?: string; exportable?: string } = {}) {
  return [
    "---",
    "unifia_schema: 1",
    `unifia_id: "0190d2c0-7b00-7000-8000-${id.padStart(12, "0")}"`,
    'unifia_type: "decision"',
    `unifia_lifecycle: "${opts.lifecycle ?? "active"}"`,
    'unifia_created_at: "2026-01-01T00:00:00Z"',
    `unifia_updated_at: "${opts.updated ?? "2026-08-29T00:00:00Z"}"`,
    'unifia_project_ref: "unifia"',
    "unifia_supersedes: []",
    "unifia_tags: []",
    ...(opts.exportable ? ["unifia_restrictions:", `  exportable: ${opts.exportable}`] : []),
    "---",
    body,
  ].join("\n")
}

// ---------------------------------------------------------------------------
// C33b — emptying the trash is the only operation that truly erases.
// ---------------------------------------------------------------------------

describe("C33b — emptying the trash", () => {
  let root: string
  let writer: VaultMutationWriter
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-purge-"))
    writer = new VaultMutationWriter({ root })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  async function seedAndDelete(locator: string, body = "body") {
    await writer.apply({
      intent: {
        kind: "create",
        targetLocator: locator,
        newContent: { type: "decision", restrictions: OPEN, body },
        reason: "seed",
        source: "test",
      },
      reason: "r",
      source: "s",
    })
    const raw = readFileSync(join(root, locator), "utf8")
    const id = parseFrontmatter(raw).frontmatter.unifia_id
    return writer.apply({
      intent: {
        kind: "delete",
        targetId: id,
        expectedVersionHash: sha256(raw),
        reason: "delete",
        source: "op",
      },
      reason: "r",
      source: "s",
    })
  }

  it("refuses to run without an explicit confirmation", async () => {
    await seedAndDelete("n.md")
    await expect(
      // @ts-expect-error confirm is required precisely so it cannot be omitted
      writer.emptyTrash({}),
    ).rejects.toThrow(/requires confirm: true/)
    expect(writer.trash()).toHaveLength(1)
  })

  it("destroys the trashed note when confirmed", async () => {
    const d = await seedAndDelete("n.md")
    const { destroyed } = await writer.emptyTrash({ confirm: true })
    expect(destroyed.map((t) => t.locator)).toEqual(["n.md"])
    expect(existsSync(join(root, TRASH_DIR, `${d.auditId}.md`))).toBe(false)
    expect(writer.trash()).toHaveLength(0)
  })

  it("records the erasure, because a trace must outlive the content", async () => {
    await seedAndDelete("n.md")
    await writer.emptyTrash({ confirm: true, source: "operator" })
    const purge = writer.readWal().find((e) => e.auditId.startsWith("purge-"))
    expect(purge).toBeDefined()
    expect(purge?.locator).toBe("n.md")
    expect(purge?.reason).toContain("permanent erasure")
    expect(purge?.newHash).toBeNull()
  })

  it("purges only what is older than the given age", async () => {
    await seedAndDelete("fresh.md")
    // Everything was just deleted, so a one-day floor keeps all of it.
    const { destroyed, kept } = await writer.emptyTrash({ confirm: true, olderThanDays: 1 })
    expect(destroyed).toHaveLength(0)
    expect(kept).toHaveLength(1)
    expect(writer.trash()).toHaveLength(1)
  })

  it("purges a single entry by audit id", async () => {
    const a = await seedAndDelete("a.md")
    await seedAndDelete("b.md")
    const { destroyed } = await writer.emptyTrash({ confirm: true, auditId: a.auditId })
    expect(destroyed.map((t) => t.locator)).toEqual(["a.md"])
    expect(writer.trash().map((t) => t.locator)).toEqual(["b.md"])
  })

  it("makes a purged note unrestorable", async () => {
    const d = await seedAndDelete("n.md")
    await writer.emptyTrash({ confirm: true })
    await expect(writer.restoreDeleted(d.auditId)).rejects.toThrow(/nothing in the trash/)
  })
})

// ---------------------------------------------------------------------------
// C34 — export.
// ---------------------------------------------------------------------------

describe("C34 — exporting the vault", () => {
  let root: string
  let out: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-export-src-"))
    out = mkdtempSync(join(tmpdir(), "unifia-export-out-"))
    mkdirSync(join(root, "sub"), { recursive: true })
    require("node:fs").writeFileSync(join(root, "open.md"), note("1", "open body", { exportable: "allow" }))
    require("node:fs").writeFileSync(join(root, "sub", "shut.md"), note("2", "shut body", { exportable: "deny" }))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(out, { recursive: true, force: true })
  })

  it("gives the owner everything, including notes marked not exportable", async () => {
    // `exportable` governs a third party receiving the content, not the owner
    // taking a copy of their own vault.
    const m = await exportVault({ vaultRoot: root, destination: out, audience: "owner" })
    expect(m.notes.map((n) => n.locator).sort()).toEqual(["open.md", "sub/shut.md"])
    expect(m.withheld).toEqual([])
    expect(existsSync(join(out, "sub/shut.md"))).toBe(true)
  })

  it("withholds non-exportable notes from a third party, and says so", async () => {
    const m = await exportVault({ vaultRoot: root, destination: out, audience: "third-party" })
    expect(m.notes.map((n) => n.locator)).toEqual(["open.md"])
    expect(m.withheld.map((w) => w.locator)).toEqual(["sub/shut.md"])
    expect(existsSync(join(out, "sub/shut.md"))).toBe(false)
  })

  it("writes a manifest that verifies the copy", async () => {
    await exportVault({ vaultRoot: root, destination: out, audience: "owner" })
    expect(verifyExport(out).ok).toBe(true)
  })

  it("detects an altered or missing note on verification", async () => {
    await exportVault({ vaultRoot: root, destination: out, audience: "owner" })
    require("node:fs").writeFileSync(join(out, "open.md"), "tampered")
    rmSync(join(out, "sub/shut.md"))
    const v = verifyExport(out)
    expect(v.ok).toBe(false)
    expect(v.altered).toEqual(["open.md"])
    expect(v.missing).toEqual(["sub/shut.md"])
  })

  it("refuses to export into the vault it is copying", async () => {
    await expect(
      exportVault({ vaultRoot: root, destination: join(root, "backup"), audience: "owner" }),
    ).rejects.toThrow(/outside the vault/)
  })

  it("reports an unreadable note rather than dropping it silently", async () => {
    require("node:fs").writeFileSync(join(root, "broken.md"), "---\nnot: valid\n---\nbody")
    const m = await exportVault({ vaultRoot: root, destination: out, audience: "owner" })
    expect(m.unreadable).toContain("broken.md")
  })
})

// ---------------------------------------------------------------------------
// C35 — retention.
// ---------------------------------------------------------------------------

describe("C35 — retention reports, it does not act", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-retention-"))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const now = new Date("2026-08-30T00:00:00Z")

  it("flags a candidate past the 30-day TTL the ADR announces", async () => {
    require("node:fs").writeFileSync(
      join(root, "old.md"),
      note("1", "b", { lifecycle: "candidate", updated: "2026-06-01T00:00:00Z" }),
    )
    const r = await retentionReport({ vaultRoot: root, now })
    expect(r.candidateTtlDays).toBe(DEFAULT_CANDIDATE_TTL_DAYS)
    expect(r.staleCandidates.map((c) => c.locator)).toEqual(["old.md"])
    expect(r.staleCandidates[0]?.ageDays).toBeGreaterThan(30)
  })

  it("leaves a fresh candidate alone", async () => {
    require("node:fs").writeFileSync(
      join(root, "fresh.md"),
      note("2", "b", { lifecycle: "candidate", updated: "2026-08-29T00:00:00Z" }),
    )
    expect((await retentionReport({ vaultRoot: root, now })).staleCandidates).toEqual([])
  })

  it("ignores notes that are not candidates", async () => {
    require("node:fs").writeFileSync(
      join(root, "active.md"),
      note("3", "b", { lifecycle: "active", updated: "2020-01-01T00:00:00Z" }),
    )
    expect((await retentionReport({ vaultRoot: root, now })).staleCandidates).toEqual([])
  })

  it("flags trash entries old enough to purge", async () => {
    const r = await retentionReport({
      vaultRoot: root,
      now,
      trash: [
        { locator: "gone.md", auditId: "a1", deletedAt: "2026-01-01T00:00:00Z" },
        { locator: "recent.md", auditId: "a2", deletedAt: "2026-08-29T00:00:00Z" },
      ],
    })
    expect(r.purgeableTrash.map((t) => t.locator)).toEqual(["gone.md"])
  })

  it("never mutates: the report is the whole surface", async () => {
    const raw = note("4", "b", { lifecycle: "candidate", updated: "2020-01-01T00:00:00Z" })
    require("node:fs").writeFileSync(join(root, "old.md"), raw)
    await retentionReport({ vaultRoot: root, now })
    // ADR-KNOW-0009 rejects an implicit timestamp-driven lifecycle: the system
    // notices, the operator decides.
    expect(readFileSync(join(root, "old.md"), "utf8")).toBe(raw)
  })

  it("renders a report an operator can act on", async () => {
    require("node:fs").writeFileSync(
      join(root, "old.md"),
      note("5", "b", { lifecycle: "candidate", updated: "2026-01-01T00:00:00Z" }),
    )
    const text = formatRetention(
      await retentionReport({
        vaultRoot: root,
        now,
        trash: [{ locator: "gone.md", auditId: "a1", deletedAt: "2026-01-01T00:00:00Z" }],
      }),
    )
    expect(text).toContain("old.md")
    expect(text).toContain("promote or archive")
    expect(text).toContain("confirm: true")
  })
})
