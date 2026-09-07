/* SPDX-License-Identifier: MIT */
/**
 * P2 (audit) — the persisted trail verifies, including rows written before
 * DA-AUD-01 changed the hash preimage.
 *
 * `FileAuditSink` appended rows and nothing ever read them back, so the
 * effect of adding six attribution fields to the hash went unnoticed: every
 * row already on disk stops matching the current rule. An operator running
 * a verifier against a real log would have been told their audit trail had
 * been tampered with, when all that happened was an upgrade.
 *
 * The sink now verifies what is on disk, row by row, against the schema
 * version each row carries.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FileAuditSink } from "../src/bootstrap.js"

/** A row exactly as the pre-DA-AUD-01 writer produced it: no version field. */
function legacyLine(
  sequence: number,
  previousHash: string,
  actor: string,
  capability: string,
  decision: "allow" | "deny" | "approval_required",
): { line: string; hash: string } {
  const hash = `${sequence}:${previousHash}:${actor}:${capability}:${decision}`
  return {
    hash,
    line: `${JSON.stringify({
      sequence,
      timestamp: 1_700_000_000_000 + sequence,
      actor,
      capability,
      decision,
      previousHash,
      hash,
    })}\n`,
  }
}

describe("FileAuditSink.verifyPersistedChain", () => {
  let dir: string
  let logPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "unifia-auditcompat-"))
    logPath = join(dir, "audit.jsonl")
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test("an absent log is an intact log, not a failure", () => {
    expect(new FileAuditSink(logPath).verifyPersistedChain()).toMatchObject({ ok: true, rows: 0 })
  })

  test("a trail this process wrote verifies", () => {
    const sink = new FileAuditSink(logPath)
    sink.record(
      {
        actor: "principal-1",
        actorKind: "user",
        principalId: "principal-1",
        action: "workflow.start",
        capability: "workflow.run",
        authorizingCapability: "workflow.run",
        resource: "ws-1",
        reason: null,
      },
      "allow",
    )
    sink.record(
      {
        actor: "system:shutdown",
        actorKind: "system",
        principalId: null,
        action: "runtime.stop",
        capability: "runtime.stop",
        authorizingCapability: null,
        resource: null,
        reason: null,
      },
      "allow",
    )

    expect(sink.verifyPersistedChain()).toMatchObject({ ok: true, rows: 2, versions: [2, 2] })
  })

  test("a trail written entirely before the change still verifies", () => {
    const first = legacyLine(1, "GENESIS", "system:boot", "runtime.start", "allow")
    const second = legacyLine(2, first.hash, "principal-1", "workflow.run", "deny")
    writeFileSync(logPath, first.line + second.line, "utf8")

    // This is the case that would have read as tampering.
    expect(new FileAuditSink(logPath).verifyPersistedChain()).toMatchObject({
      ok: true,
      rows: 2,
      versions: [1, 1],
    })
  })

  test("a trail that spans the upgrade verifies across the boundary", () => {
    const first = legacyLine(1, "GENESIS", "system:boot", "runtime.start", "allow")
    writeFileSync(logPath, first.line, "utf8")

    // A new server opens the same file and appends. Its own chain starts at
    // GENESIS, so seed it to continue the file rather than restart it.
    const continued = `${JSON.stringify({
      schemaVersion: 2,
      sequence: 2,
      timestamp: 1_700_000_000_002,
      actor: "principal-1",
      actorKind: "user",
      principalId: "principal-1",
      action: "workflow.start",
      capability: "workflow.run",
      authorizingCapability: "workflow.run",
      resource: "ws-1",
      reason: null,
      decision: "allow",
      previousHash: first.hash,
      hash: `2:${first.hash}:user:principal-1:principal-1:workflow.start:workflow.run:workflow.run:ws-1::allow`,
    })}\n`
    appendFileSync(logPath, continued, "utf8")

    expect(new FileAuditSink(logPath).verifyPersistedChain()).toMatchObject({
      ok: true,
      rows: 2,
      versions: [1, 2],
    })
  })

  test("an edited row is still reported, with the row number", () => {
    const first = legacyLine(1, "GENESIS", "system:boot", "runtime.start", "allow")
    const second = legacyLine(2, first.hash, "principal-1", "workflow.run", "deny")
    // Flip the decision, leave the hash.
    const forged = second.line.replace('"decision":"deny"', '"decision":"allow"')
    writeFileSync(logPath, first.line + forged, "utf8")

    expect(new FileAuditSink(logPath).verifyPersistedChain()).toMatchObject({ ok: false, failedAt: 2 })
  })

  test("a torn final append is reported, not skipped", () => {
    const first = legacyLine(1, "GENESIS", "system:boot", "runtime.start", "allow")
    writeFileSync(logPath, `${first.line}{"sequence":2,"act`, "utf8")

    expect(new FileAuditSink(logPath).verifyPersistedChain()).toMatchObject({
      ok: false,
      failedAt: 2,
      reason: "row is not valid JSON",
    })
  })
})
