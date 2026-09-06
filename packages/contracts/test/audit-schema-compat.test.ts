/* SPDX-License-Identifier: MIT */
/**
 * P2 (audit) — a log written before DA-AUD-01 must still verify.
 *
 * DA-AUD-01 gave every audit row the attribution it was missing, which
 * meant putting six more fields into the hash. That changes the *preimage*,
 * so a verifier holding only the new rule rejects every row written before
 * the change — and reports it as a broken chain, which is the one thing an
 * audit trail must never say when nothing was tampered with. The rows
 * carried no version, so a reader had no way to tell a schema change from
 * an edit.
 *
 * Rows are now stamped, `auditHashPreimage` knows both rules, and
 * `verifyAuditChain` checks each row against its own version. A file that
 * crosses the boundary verifies straight through it, because the chain
 * links by `previousHash`, which never changed.
 */

import { describe, expect, test } from "bun:test"
import {
  AUDIT_SCHEMA_VERSION,
  AuditRuntimeDouble,
  auditHashPreimage,
  verifyAuditChain,
  type PersistedAuditRow,
  type RuntimeDecision,
} from "../src/p3-runtime.js"

/** A row exactly as the pre-DA-AUD-01 writer produced it: no version field. */
function legacyRow(
  sequence: number,
  previousHash: string,
  actor: string,
  capability: string,
  decision: RuntimeDecision,
): PersistedAuditRow {
  return {
    sequence,
    timestamp: 1_700_000_000_000 + sequence,
    actor,
    capability,
    decision,
    previousHash,
    hash: `${sequence}:${previousHash}:${actor}:${capability}:${decision}`,
  }
}

describe("historical logs", () => {
  test("a trail written entirely before the change still verifies", () => {
    const first = legacyRow(1, "GENESIS", "user-a", "workspace.read", "allow")
    const second = legacyRow(2, String(first.hash), "user-b", "workflow.run", "deny")
    const third = legacyRow(3, String(second.hash), "user-a", "artifact.create", "approval_required")

    const result = verifyAuditChain([first, second, third])

    expect(result.ok).toBe(true)
    expect(result).toMatchObject({ rows: 3, versions: [1, 1, 1] })
  })

  test("an edited legacy row is still caught", () => {
    const first = legacyRow(1, "GENESIS", "user-a", "workspace.read", "allow")
    // Someone flips a deny into an allow but leaves the hash alone.
    const tampered = { ...legacyRow(2, String(first.hash), "user-b", "workflow.run", "deny"), decision: "allow" }

    const result = verifyAuditChain([first, tampered])

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ failedAt: 2 })
  })

  test("a deleted row is caught by the sequence and the chain", () => {
    const first = legacyRow(1, "GENESIS", "user-a", "workspace.read", "allow")
    const second = legacyRow(2, String(first.hash), "user-b", "workflow.run", "deny")
    const third = legacyRow(3, String(second.hash), "user-a", "artifact.create", "allow")

    const result = verifyAuditChain([first, third])

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ failedAt: 2 })
  })
})

describe("current logs", () => {
  test("rows the runtime writes today carry the version and verify", () => {
    const audit = new AuditRuntimeDouble(() => 1_700_000_000_000)
    audit.record(
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
    audit.record("system:shutdown", "runtime.stop", "allow")

    const rows = audit.events().map((event) => ({ ...event }) as PersistedAuditRow)

    expect(rows[0]?.schemaVersion).toBe(AUDIT_SCHEMA_VERSION)
    const result = verifyAuditChain(rows)
    expect(result.ok).toBe(true)
    expect(result).toMatchObject({ versions: [2, 2] })
  })

  test("attribution is inside the hash: changing the principal breaks it", () => {
    const audit = new AuditRuntimeDouble(() => 1_700_000_000_000)
    audit.record(
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
    const rows = audit.events().map((event) => ({ ...event }) as PersistedAuditRow)
    const forged = [{ ...rows[0], principalId: "principal-2" }]

    expect(verifyAuditChain(forged).ok).toBe(false)
  })
})

describe("a log that spans the change", () => {
  test("verifies across the version boundary", () => {
    // The realistic case: a server that ran before the upgrade and after it,
    // appending to the same file. The chain links by `previousHash`, which
    // the schema change did not touch.
    const legacy = legacyRow(1, "GENESIS", "system:boot", "runtime.start", "allow")

    const previousHash = String(legacy.hash)
    const modern: PersistedAuditRow = {
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
      previousHash,
      hash: auditHashPreimage({
        schemaVersion: 2,
        sequence: 2,
        previousHash,
        actor: "principal-1",
        actorKind: "user",
        principalId: "principal-1",
        action: "workflow.start",
        capability: "workflow.run",
        authorizingCapability: "workflow.run",
        resource: "ws-1",
        reason: "",
        decision: "allow",
      }),
    }

    const result = verifyAuditChain([legacy, modern])

    expect(result.ok).toBe(true)
    expect(result).toMatchObject({ versions: [1, 2] })
  })

  test("a legacy row checked under the new rule would have failed — that was the bug", () => {
    const legacy = legacyRow(1, "GENESIS", "system:boot", "runtime.start", "allow")

    // What a verifier that only knew version 2 would have computed.
    const underV2 = auditHashPreimage({
      schemaVersion: 2,
      sequence: 1,
      previousHash: "GENESIS",
      actor: "system:boot",
      capability: "runtime.start",
      decision: "allow",
    })

    expect(underV2).not.toBe(legacy.hash)
    // And with the version respected, it verifies.
    expect(verifyAuditChain([legacy]).ok).toBe(true)
  })

  test("an unknown future version is refused rather than guessed at", () => {
    const row: PersistedAuditRow = { ...legacyRow(1, "GENESIS", "a", "b", "allow"), schemaVersion: 99 }

    const result = verifyAuditChain([row])

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ reason: "unknown schemaVersion 99" })
  })
})
