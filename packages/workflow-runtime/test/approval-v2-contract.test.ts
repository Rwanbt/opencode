/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Approval Broker V2 — negative contract tests.
 *
 * Per pack gelé §35 + ADR-0007 V2 (READY_FOR_REVIEW) + review v1.1,
 * these tests pin the invariants of the V2 Approval Broker.
 *
 * The actual implementations live in the chosen substrate (M0 Native
 * candidate, see `packages/automate-m0-harness/src/qualification/`).
 * The M0 qualification harness already covers a subset (FC-04 ACK
 * loss, FC-14 multi-process). This file pins the V2-specific
 * negative contract for when the kernel is wired up post-ADR-000
 * ratification.
 *
 * Tests marked SCAFFOLD_READY (per pattern 2026-08-12) have body
 * commented out; they will be uncommented when the V2 approval broker
 * is implemented in the production kernel.
 */

// Quarantine runtime gate opt-in: this suite is the LEGACY/TEST-ONLY consumer
// of the store-backed V2 broker (see src/approval-v2.ts).
process.env.UNIFIA_ALLOW_LEGACY_APPROVAL_V2 = "1"

import { describe, expect, test } from "bun:test"
import { FileBackedApprovalStore, InMemoryApprovalStore, LocalApprovalBrokerV2, ApprovalRejectedError } from "../src/approval-v2.ts"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const scope = { organizationId: "org", workspaceId: "ws" }
const deploymentScope = { ownershipScope: scope, environmentId: "test" }
const human = { id: "human-1", kind: "human" as const }
const requestInput = (overrides: Record<string, unknown> = {}) => ({ workflowRunId: "run-1", executionPlanDigest: "digest-1", principal: { id: "agent-1", kind: "workflow" as const }, ownershipScope: scope, deploymentScope, capabilityRefs: ["fs.read"], resourceScope: ["/tmp/a"], policyDecisionRef: "policy-1", policyVersion: "v1", expiresAtEpochMs: Date.now() + 10_000, ...overrides })
const context = (overrides: Record<string, unknown> = {}) => ({ executionPlanDigest: "digest-1", ...overrides })

describe("Approval Broker V2", () => {
  test("expired approval cannot execute", async () => { let now = 100; const broker = new LocalApprovalBrokerV2(new InMemoryApprovalStore(), () => now); const handle = await broker.request(requestInput({ expiresAtEpochMs: 99 })); const outcome = await broker.resolve(handle.approvalId, "APPROVED", human, context()); expect(outcome.state).toBe("EXPIRED"); now = 101; expect((await broker.inspect(handle.approvalId)).state).toBe("EXPIRED") })
  test("different actor/scope cannot reuse approval", async () => { const broker = new LocalApprovalBrokerV2(new InMemoryApprovalStore()); const handle = await broker.request(requestInput()); await expect(broker.resolve(handle.approvalId, "APPROVED", human, context({ ownershipScope: { ...scope, workspaceId: "other" } }))).resolves.toMatchObject({ state: "STALE" }) })
  test("resource widening rejected", async () => { const broker = new LocalApprovalBrokerV2(new InMemoryApprovalStore()); const handle = await broker.request(requestInput()); await expect(broker.resolve(handle.approvalId, "APPROVED", human, context({ resourceScope: ["/tmp/a", "/tmp/b"] }))).resolves.toMatchObject({ state: "STALE" }) })
  test("changed ExecutionPlan digest rejected", async () => { const broker = new LocalApprovalBrokerV2(new InMemoryApprovalStore()); const handle = await broker.request(requestInput()); await expect(broker.resolve(handle.approvalId, "APPROVED", human, { executionPlanDigest: "changed" })).resolves.toMatchObject({ state: "STALE", reason: "APPROVAL_STALE" }) })
  test("already resolved approval cannot mutate", async () => { const broker = new LocalApprovalBrokerV2(new InMemoryApprovalStore()); const handle = await broker.request(requestInput()); await broker.resolve(handle.approvalId, "APPROVED", human, context()); await expect(broker.resolve(handle.approvalId, "DENIED", human, context())).resolves.toMatchObject({ state: "APPROVED", reason: "ALREADY_RESOLVED" }) })
  test("cancelled approval cannot execute", async () => { const broker = new LocalApprovalBrokerV2(new InMemoryApprovalStore()); const handle = await broker.request(requestInput()); await broker.cancel(handle.approvalId, human); await expect(broker.resolve(handle.approvalId, "APPROVED", { id: "human-2", kind: "human" }, context())).resolves.toMatchObject({ state: "CANCELLED" }) })
  test("unknown approval denied", async () => { const broker = new LocalApprovalBrokerV2(new InMemoryApprovalStore()); await expect(broker.resolve("missing", "APPROVED", human, context())).resolves.toMatchObject({ state: "DENIED", reason: "UNKNOWN_APPROVAL" }) })
  test("restart preserves pending request", async () => { const directory = await mkdtemp(join(tmpdir(), "approval-v2-")); try { const path = join(directory, "state.json"); const first = new LocalApprovalBrokerV2(new FileBackedApprovalStore(path)); const handle = await first.request(requestInput()); const second = new LocalApprovalBrokerV2(new FileBackedApprovalStore(path)); await expect(second.inspect(handle.approvalId)).resolves.toMatchObject({ state: "PENDING" }) } finally { await rm(directory, { recursive: true, force: true }) } })
  test("workflow/LLM cannot self-approve", async () => { const broker = new LocalApprovalBrokerV2(new InMemoryApprovalStore()); const handle = await broker.request(requestInput()); await expect(broker.resolve(handle.approvalId, "APPROVED", { id: "agent-1", kind: "workflow" }, context())).rejects.toThrow(ApprovalRejectedError) })
  test("no ID reuse after restart", async () => { const store = new InMemoryApprovalStore(); const first = new LocalApprovalBrokerV2(store); const a = await first.request(requestInput()); await first.resolve(a.approvalId, "DENIED", human, context()); const second = new LocalApprovalBrokerV2(store); const b = await second.request(requestInput({ logicalInvocationId: "second" })); expect(b.approvalId).not.toBe(a.approvalId) })
  test("replayable history", async () => { const broker = new LocalApprovalBrokerV2(new InMemoryApprovalStore()); const handle = await broker.request(requestInput()); await broker.resolve(handle.approvalId, "APPROVED", human, context()); await expect(broker.listHistory({ workflowRunId: "run-1" })).resolves.toHaveLength(2) })
  test("revocation blocks new requests", async () => { const broker = new LocalApprovalBrokerV2(new InMemoryApprovalStore()); await broker.revokeGrant("grant-1", human); await expect(broker.request(requestInput({ reusableGrantId: "grant-1" }))).rejects.toThrow(/GRANT_REVOKED/) })
})
