/* SPDX-License-Identifier: MIT */

// C2-5/D-2: ApprovalCapabilityGate.check() returns "allow" indefinitely once
// a request has been granted — ttlMs only bounds how long a request stays
// PENDING before it auto-expires (ApprovalBroker.resolve()'s own timeout
// check), never how long a granted decision remains honored. With C2-3's
// step-up mechanism now live (artifact.create/export), a decision that
// never expires defeats the point of step-up: one approval would grant the
// capability for the rest of the session.

import { describe, expect, it } from "vitest"
import { ApprovalBroker } from "@unifia/contracts"
import { ApprovalCapabilityGate } from "../src/index.js"

describe("C2-5: a granted approval expires independently of the pending-request TTL", () => {
  it("stops being honored once the grant window elapses, and a fresh request is created", async () => {
    let now = 1_000
    const broker = new ApprovalBroker(() => now)
    const gate = new ApprovalCapabilityGate(broker, new Set(), 30_000, 5_000, () => now)

    const first = await gate.check("artifact.create", "resource-1", "actor")
    expect(first).toMatchObject({ kind: "approval_required" })
    const approvalId = (first as { kind: "approval_required"; approvalId: string }).approvalId
    broker.resolve(approvalId, "allow", "reviewer")

    const grantedImmediately = await gate.check("artifact.create", "resource-1", "actor")
    expect(grantedImmediately).toBe("allow")

    now += 4_000 // still inside the 5s grant window
    expect(await gate.check("artifact.create", "resource-1", "actor")).toBe("allow")

    now += 1_001 // past the grant window
    const afterExpiry = await gate.check("artifact.create", "resource-1", "actor")
    expect(afterExpiry).toMatchObject({ kind: "approval_required" })
    expect((afterExpiry as { kind: "approval_required"; approvalId: string }).approvalId).not.toBe(approvalId)
  })

  it("does not affect the allowlisted fast path", async () => {
    let now = 1_000
    const broker = new ApprovalBroker(() => now)
    const gate = new ApprovalCapabilityGate(broker, new Set(["workspace.read"]), 30_000, 5_000, () => now)
    expect(await gate.check("workspace.read", "resource-1", "actor")).toBe("allow")
    now += 10_000
    expect(await gate.check("workspace.read", "resource-1", "actor")).toBe("allow")
  })
})
