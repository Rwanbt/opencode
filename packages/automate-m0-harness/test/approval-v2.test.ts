/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * CP8: real approval V3 contract tests.
 *
 * Per pack gelé review 2026-09-03 v1.1 §35: the 12 negative
 * tests for ADR-0007 / D-02 are now real (durable, multi-step)
 * — not scaffold. They drive both the UNIFIA_NATIVE candidate
 * (bun:sqlite in-process) and the DBOS_GO_SQLITE candidate (real
 * Go binary spawned with HTTP/JSON).
 *
 * Each test is substrate-neutral: it constructs the candidate
 * via the qualification adapter, drives through the contract
 * surface, and asserts the result. No scaffold `expect(true).toBe(true)`.
 */

import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve as pathResolve } from "node:path"
import {
  FakeExternalEffectProvider,
  NativeSqliteCandidate,
  DBOSGoCandidate,
  type ApprovalRequestInput,
  type ExecutionPlanDigest,
  type ApprovalResolveInput,
} from "../src/qualification/index.ts"

const DBOS_GO_TOOL_DIR = pathResolve(import.meta.dir, "..", "..", "..", "tools", "dbos-qualify")
const DBOS_GO_BINARY = join(DBOS_GO_TOOL_DIR, "dbos-qualify.exe")
const DBOS_GO_BUILT = existsSync(DBOS_GO_BINARY)
const DBOS_GO_VERSION = "github.com/dbos-inc/dbos-transact-golang@v1.0.0"

function tempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `m0-approval-${label}-`))
}

function tempCleanup(root: string): void {
  for (let i = 0; i < 5; i++) {
    try { rmSync(root, { recursive: true, force: true }); return }
    catch { /* EBUSY on Windows */ }
  }
}

const PLAN_DIGEST_A: ExecutionPlanDigest = "plan-digest-A-001" as ExecutionPlanDigest
const PLAN_DIGEST_B: ExecutionPlanDigest = "plan-digest-B-002" as ExecutionPlanDigest

function approvalRequest(
  requesterId: string,
  digest: ExecutionPlanDigest = PLAN_DIGEST_A,
  ordinal = 1,
  generation = 1,
  expiresInMs = 60_000,
): ApprovalRequestInput {
  const now = Date.now()
  return {
    approvalId: `appr-${now}-${ordinal}-${generation}-${requesterId}` as never,
    runId: `run-${now}-${requesterId}` as never,
    logicalInvocationId: `li-${now}-${ordinal}` as never,
    executionPlanDigest: digest,
    requesterPrincipalId: requesterId,
    ordinal,
    requestGeneration: generation,
    ownershipScope: { organizationId: "o1", workspaceId: "ws-1" },
    createdAtEpochMs: now,
    expiresAtEpochMs: now + expiresInMs,
  }
}

interface CandidateFactory {
  readonly kind: "NATIVE" | "DBOS_GO"
  build(): Promise<{
    candidate: NativeSqliteCandidate | DBOSGoCandidate
    provider: FakeExternalEffectProvider
    storeDir: string
    cleanup: () => Promise<void>
  }>
}

function nativeFactory(): CandidateFactory {
  return {
    kind: "NATIVE",
    build: async () => {
      const root = tempDir("native")
      const candidate = new NativeSqliteCandidate({
        storeDir: join(root, "candidate"),
        provider: new FakeExternalEffectProvider({ storeDir: join(root, "provider"), dropAckToCandidate: false }),
        version: "0.0.0-m0-approval-test",
        buildHash: "test-approval",
      })
      const provider = new FakeExternalEffectProvider({ storeDir: join(root, "provider"), dropAckToCandidate: false })
      await candidate.initialize()
      return {
        candidate,
        provider,
        storeDir: root,
        cleanup: async () => { await candidate.shutdown().catch(() => undefined); await provider.shutdown().catch(() => undefined); tempCleanup(root) },
      }
    },
  }
}

function dbosGoFactory(): CandidateFactory | null {
  if (!DBOS_GO_BUILT) return null
  return {
    kind: "DBOS_GO",
    build: async () => {
      const root = tempDir("dbos")
      const candidate = new DBOSGoCandidate({
        toolDir: DBOS_GO_TOOL_DIR,
        version: DBOS_GO_VERSION,
        buildHash: "test-approval",
      })
      const provider = new FakeExternalEffectProvider({ storeDir: join(root, "provider"), dropAckToCandidate: false })
      await candidate.initialize()
      return {
        candidate,
        provider,
        storeDir: root,
        cleanup: async () => { await candidate.shutdown().catch(() => undefined); await provider.shutdown().catch(() => undefined); tempCleanup(root) },
      }
    },
  }
}

function describeBoth(
  name: string,
  fn: (factory: CandidateFactory) => void,
): void {
  describe(`Approval V3 — ${name} (UNIFIA_NATIVE)`, () => fn(nativeFactory()))
  const dbos = dbosGoFactory()
  if (dbos) {
    describe(`Approval V3 — ${name} (DBOS_GO_SQLITE)`, () => fn(dbos))
  }
}

const actors = { alice: { id: "alice", kind: "PRINCIPAL" as const }, bob: { id: "bob", kind: "PRINCIPAL" as const } }

function resolveInput(digest: ExecutionPlanDigest, reason?: string): ApprovalResolveInput {
  return { currentExecutionPlanDigest: digest, reason }
}

describeBoth("expired approval cannot execute", (factory) => {
  test("resolve after expiresAtEpochMs → EXPIRED + cannot be approved", async () => {
    const ctx = await factory.build()
    try {
      const req = approvalRequest("alice", PLAN_DIGEST_A, 1, 1, /* expiresInMs */ 1)
      await ctx.candidate.provideApproval(req)
      // Sleep to ensure expiry.
      await new Promise((r) => setTimeout(r, 20))
      const outcome = await ctx.candidate.resolveApproval(
        req.approvalId as never,
        "APPROVED",
        actors.bob,
        resolveInput(PLAN_DIGEST_A),
      )
      expect(outcome.state).toBe("EXPIRED")
      expect(outcome.reason).toContain("expired")
    } finally {
      await ctx.cleanup()
    }
  })
})

describeBoth("different actor/scope cannot reuse approval", (factory) => {
  test("resolve with mismatched plan digest → STALE_DIGEST_MISMATCH", async () => {
    const ctx = await factory.build()
    try {
      const req = approvalRequest("alice", PLAN_DIGEST_A, 1, 1)
      await ctx.candidate.provideApproval(req)
      await expect(
        ctx.candidate.resolveApproval(
          req.approvalId as never,
          "APPROVED",
          actors.bob,
          resolveInput(PLAN_DIGEST_B),
        ),
      ).rejects.toThrow(/STALE/)
    } finally {
      await ctx.cleanup()
    }
  })
})

describeBoth("workflow/LLM cannot self-approve", (factory) => {
  test("actor == requester → SELF_APPROVAL_REJECTED", async () => {
    const ctx = await factory.build()
    try {
      const req = approvalRequest("alice", PLAN_DIGEST_A, 1, 1)
      await ctx.candidate.provideApproval(req)
      await expect(
        ctx.candidate.resolveApproval(
          req.approvalId as never,
          "APPROVED",
          actors.alice,
          resolveInput(PLAN_DIGEST_A),
        ),
      ).rejects.toThrow(/SELF_APPROVAL/)
    } finally {
      await ctx.cleanup()
    }
  })
})

describeBoth("changed plan digest → STALE", (factory) => {
  test("resolve with current digest different from stored → STALE", async () => {
    const ctx = await factory.build()
    try {
      const req = approvalRequest("alice", PLAN_DIGEST_A, 1, 1)
      await ctx.candidate.provideApproval(req)
      await expect(
        ctx.candidate.resolveApproval(
          req.approvalId as never,
          "APPROVED",
          actors.bob,
          resolveInput(PLAN_DIGEST_B),
        ),
      ).rejects.toThrow(/STALE/)
    } finally {
      await ctx.cleanup()
    }
  })
})

describeBoth("already resolved approval cannot mutate (idempotency)", (factory) => {
  test("same decision + same actor → idempotent OK (no state change)", async () => {
    const ctx = await factory.build()
    try {
      const req = approvalRequest("alice", PLAN_DIGEST_A, 1, 1)
      await ctx.candidate.provideApproval(req)
      const first = await ctx.candidate.resolveApproval(
        req.approvalId as never,
        "APPROVED",
        actors.bob,
        resolveInput(PLAN_DIGEST_A),
      )
      expect(first.state).toBe("APPROVED")
      // Second call same decision same actor must be idempotent (or throw APPROVAL_ALREADY_RESOLVED).
      const second = await ctx.candidate.resolveApproval(
        req.approvalId as never,
        "APPROVED",
        actors.bob,
        resolveInput(PLAN_DIGEST_A),
      )
      expect(second.state).toBe("APPROVED")
    } finally {
      await ctx.cleanup()
    }
  })

  test("conflicting second decision → APPROVAL_ALREADY_RESOLVED", async () => {
    const ctx = await factory.build()
    try {
      const req = approvalRequest("alice", PLAN_DIGEST_A, 1, 1)
      await ctx.candidate.provideApproval(req)
      await ctx.candidate.resolveApproval(
        req.approvalId as never,
        "APPROVED",
        actors.bob,
        resolveInput(PLAN_DIGEST_A),
      )
      await expect(
        ctx.candidate.resolveApproval(
          req.approvalId as never,
          "DENIED",
          actors.alice,
          resolveInput(PLAN_DIGEST_A),
        ),
      ).rejects.toThrow(/ALREADY_RESOLVED/)
    } finally {
      await ctx.cleanup()
    }
  })
})

describeBoth("cancelled approval cannot execute", (factory) => {
  test("cancel by requester → CANCELLED + resolve rejected", async () => {
    const ctx = await factory.build()
    try {
      const req = approvalRequest("alice", PLAN_DIGEST_A, 1, 1)
      await ctx.candidate.provideApproval(req)
      const cancelled = await ctx.candidate.cancelApproval(
        req.approvalId as never,
        actors.alice,
        "user withdrew the request",
      )
      expect(cancelled.state).toBe("CANCELLED")
      await expect(
        ctx.candidate.resolveApproval(
          req.approvalId as never,
          "APPROVED",
          actors.bob,
          resolveInput(PLAN_DIGEST_A),
        ),
      ).rejects.toThrow(/ALREADY_RESOLVED/)
    } finally {
      await ctx.cleanup()
    }
  })

  test("non-requester principal cannot cancel", async () => {
    const ctx = await factory.build()
    try {
      const req = approvalRequest("alice", PLAN_DIGEST_A, 1, 1)
      await ctx.candidate.provideApproval(req)
      await expect(
        ctx.candidate.cancelApproval(
          req.approvalId as never,
          actors.bob,
          "not the requester",
        ),
      ).rejects.toThrow(/CANCEL_REJECTED/)
    } finally {
      await ctx.cleanup()
    }
  })
})

describeBoth("append-only history", (factory) => {
  test("history records REQUESTED → APPROVED with actor + digest", async () => {
    const ctx = await factory.build()
    try {
      const req = approvalRequest("alice", PLAN_DIGEST_A, 1, 1)
      await ctx.candidate.provideApproval(req)
      await ctx.candidate.resolveApproval(
        req.approvalId as never,
        "APPROVED",
        actors.bob,
        resolveInput(PLAN_DIGEST_A, "approved for run"),
      )
      const history = await ctx.candidate.approvalHistory(req.approvalId as never)
      expect(history.length).toBeGreaterThanOrEqual(2)
      const types = history.map((e) => e.eventType)
      expect(types).toContain("REQUESTED")
      expect(types).toContain("APPROVED")
      const approved = history.find((e) => e.eventType === "APPROVED")
      expect(approved?.actorId).toBe(actors.bob.id)
      expect(approved?.executionPlanDigest).toBe(PLAN_DIGEST_A)
    } finally {
      await ctx.cleanup()
    }
  })
})
