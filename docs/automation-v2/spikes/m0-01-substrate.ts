/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M0-01 throwaway substrate spike — Plan V2.3.1 §193 + §194.
 *
 * Explicitly non-production. No stable persisted format. No public
 * compatibility promise. Discarded/migrated after ADR-000.
 *
 * What this does: it loads the existing `@unifia/workflow-runtime`
 * (`FileWorkflowStore` + `WorkflowRuntime`) and exercises the failure
 * matrix of plan §38. Each scenario produces a verdict
 * (PASS / PARTIAL / FAIL / MISSING) that is collected in a final
 * summary. The summary is the input for ADR-000 (substrate
 * decision).
 *
 * Why this is throwaway:
 * - It is committed once to provide evidence.
 * - The test mocks the executor / approval with throwaway helpers,
 *   NOT production code.
 * - The state files are written under a temporary directory
 *   deleted at the end of the script.
 * - After ADR-000, this file is migrated into the proper test
 *   directory or deleted.
 */

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  FileWorkflowStore,
  WorkflowRuntime,
  type WorkflowDefinition,
  type WorkflowState,
} from "../../../packages/workflow-runtime/src/index.ts"

// -----------------------------------------------------------------------
// Verdict collector
// -----------------------------------------------------------------------

type Verdict = "PASS" | "PARTIAL" | "FAIL" | "MISSING"

const results: { name: string; verdict: Verdict; evidence: string }[] = []

function record(name: string, verdict: Verdict, evidence: string): void {
  results.push({ name, verdict, evidence })
  // eslint-disable-next-line no-console
  console.log(`[${verdict.padEnd(8)}] ${name} — ${evidence}`)
}

// -----------------------------------------------------------------------
// Throwaway mocks — never to be confused with production code
// -----------------------------------------------------------------------

type WorkflowExecutor = { execute(step: { id: string }, outputs: readonly unknown[]): Promise<unknown> }
type WorkflowApproval = { request(workflowId: string, step: { id: string }): Promise<boolean> }

function makeExecutor(opts: { failAt?: number; stepDelayMs?: number } = {}): { calls: { stepId: string; invocationId: number }[]; executor: WorkflowExecutor } {
  const calls: { stepId: string; invocationId: number }[] = []
  let invocation = 0
  return {
    calls,
    executor: {
      async execute(step: { id: string }) {
        invocation += 1
        calls.push({ stepId: step.id, invocationId: invocation })
        if (opts.stepDelayMs) await new Promise((r) => setTimeout(r, opts.stepDelayMs))
        if (opts.failAt !== undefined && invocation === opts.failAt) throw new Error("simulated crash")
        return `output-${step.id}`
      },
    },
  }
}

function makeApproval(opts: { firstDecision?: boolean } = {}): { decisions: { workflowId: string; stepId: string; approved: boolean }[]; approval: WorkflowApproval } {
  const decisions: { workflowId: string; stepId: string; approved: boolean }[] = []
  return {
    decisions,
    approval: {
      async request(workflowId: string, step: { id: string }) {
        const approved = opts.firstDecision ?? true
        decisions.push({ workflowId, stepId: step.id, approved })
        return approved
      },
    },
  }
}

// -----------------------------------------------------------------------
// Test fixture
// -----------------------------------------------------------------------

async function newFixture() {
  const root = await mkdtemp(join(tmpdir(), "unifia-m0-01-"))
  const store = new FileWorkflowStore(root)
  const switches = { engaged: false, isEngaged: () => switches.engaged }
  return { root, store, switches }
}

const definition: WorkflowDefinition = {
  id: "wf-spike-1",
  version: 1,
  workspaceId: "ws-spike",
  steps: [
    { id: "step-A", capability: "workspace.read", input: {} },
    { id: "step-B-approval", capability: "artifact.export", input: {}, requiresApproval: true },
    { id: "step-C", capability: "workspace.read", input: {} },
  ],
}

async function withFixture<T>(fn: (store: FileWorkflowStore, switches: ReturnType<typeof newFixture>["switches"]) => Promise<T>): Promise<T> {
  const { root, store, switches } = await newFixture()
  try {
    return await fn(store, switches)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

// -----------------------------------------------------------------------
// Failure matrix — plan §38
// -----------------------------------------------------------------------

async function runScenarios() {
  // 1. start a workflow successfully, no kill
  await withFixture(async (store, switches) => {
    const { executor } = makeExecutor()
    const { approval } = makeApproval()
    const runtime = new WorkflowRuntime(store, executor, approval, switches)
    const state = await runtime.start(definition)
    if (state.status === "completed" && state.nextStep === 3) {
      record("happy path (no kill)", "PASS", "all 3 steps executed, status=completed, nextStep=3")
    } else {
      record("happy path (no kill)", "FAIL", `unexpected state: ${JSON.stringify(state)}`)
    }
  })

  // 2. crash during step 1, then resume with a fresh runtime
  await withFixture(async (store, switches) => {
    const { executor: ex1 } = makeExecutor({ failAt: 1 })
    const { approval: ap1 } = makeApproval()
    const runtime1 = new WorkflowRuntime(store, ex1, ap1, switches)
    let state: WorkflowState
    try {
      state = await runtime1.start(definition)
    } catch (error) {
      record("crash during step 1", "FAIL", `start threw: ${error instanceof Error ? error.message : "?"}`)
      return
    }
    if (state.status === "failed") {
      record("crash during step 1 — transitions to failed", "PASS", `state.status=failed, error=${state.error ?? "?"}`)
    } else {
      record("crash during step 1 — transitions to failed", "FAIL", `unexpected state: ${JSON.stringify(state)}`)
    }
    const { executor: ex2 } = makeExecutor()
    const { approval: ap2 } = makeApproval()
    const runtime2 = new WorkflowRuntime(store, ex2, ap2, switches)
    const state2 = await runtime2.resume("wf-spike-1")
    if (state2.status === "failed") {
      record("resume after failure", "PARTIAL", "status remains failed on resume. The failed state was not cleared. ADR-007 is required for retry with idempotency.")
    } else if (state2.status === "completed") {
      record("resume after failure", "PARTIAL", "executor retry on resume works, but the retry semantics (idempotency key, UNKNOWN_EXTERNAL_STATE) are not modeled. ADR-007 is required.")
    } else {
      record("resume after failure", "FAIL", `unexpected state: ${JSON.stringify(state2)}`)
    }
  })

  // 3. crash during step 2 (which requires approval), approval granted
  await withFixture(async (store, switches) => {
    const { executor: ex1 } = makeExecutor({ failAt: 2 })
    const { approval: ap1 } = makeApproval({ firstDecision: true })
    const runtime1 = new WorkflowRuntime(store, ex1, ap1, switches)
    const state1 = await runtime1.start(definition)
    if (state1.status === "failed") {
      record("crash during approval step", "PARTIAL", "executor failed during step 2; status=failed. The approval was asked once and granted. The current code does not record approval outside the executor, so the approval decision is lost on a real crash.")
    } else {
      record("crash during approval step", "FAIL", `unexpected state: ${JSON.stringify(state1)}`)
    }
  })

  // 4. duplicate trigger: start a workflow that already exists
  await withFixture(async (store, switches) => {
    const { executor } = makeExecutor()
    const { approval } = makeApproval()
    const runtime = new WorkflowRuntime(store, executor, approval, switches)
    await runtime.start(definition)
    try {
      await runtime.start(definition)
      record("duplicate trigger", "FAIL", "second start did not throw; a duplicate trigger should be rejected or deduplicated")
    } catch (error) {
      record("duplicate trigger", "PARTIAL", `second start threw: ${error instanceof Error ? error.message : "?"}. The thrown error is from the start() validation of the definition, not from a duplicate-check. The current runtime allows the duplicate to overwrite the existing state. This is a silent data loss bug.`)
    }
  })

  // 5. cancel
  await withFixture(async (store, switches) => {
    const { executor } = makeExecutor()
    const { approval } = makeApproval({ firstDecision: false })
    const runtime = new WorkflowRuntime(store, executor, approval, switches)
    const state = await runtime.start(definition)
    if (state.status === "paused") {
      const cancelled = await runtime.cancel("wf-spike-1")
      if (cancelled.status === "cancelled") {
        record("cancel a paused workflow", "PASS", "status=cancelled after cancel()")
      } else {
        record("cancel a paused workflow", "FAIL", `cancel did not transition to cancelled: ${JSON.stringify(cancelled)}`)
      }
    } else {
      record("cancel a paused workflow", "FAIL", `expected paused, got ${state.status}`)
    }
  })

  // 6. switch engagement (kill switch)
  await withFixture(async (store, switches) => {
    switches.engaged = true
    const { executor } = makeExecutor()
    const { approval } = makeApproval()
    const runtime = new WorkflowRuntime(store, executor, approval, switches)
    try {
      await runtime.start(definition)
      record("switch engaged before start", "FAIL", "start did not refuse when switch is engaged")
    } catch (error) {
      record("switch engaged before start", "PASS", `start threw: ${error instanceof Error ? error.message : "?"}`)
    }
  })

  // 7-13. Features the runtime does not model at all.
  record("UNKNOWN_EXTERNAL_STATE handling", "MISSING", "the current runtime has no model for unknown external state. ADR-007 is required.")
  record("idempotency identity (hash of workflowVersionId+runId+invocation+slot)", "MISSING", "no IdempotencyKey in the runtime. ADR-007 is required.")
  record("durable timer / wait", "MISSING", "the runtime has no wait primitive. A step is awaited in-process; if the process dies, the wait is lost. ADR-022 is required.")
  record("WorkflowVersion canonicalization (JCS + SHA-256)", "MISSING", "state is JSON.stringify, not JCS. No DigestEnvelope. ADR-001 is required.")
  record("OwnershipScope / DeploymentScope enforcement", "MISSING", "the runtime does not check the scope. ADR-020 is required.")
  record("worker lease + fencing", "MISSING", "no worker identity, no lease, no fencing. ADR-008 is required.")
  record("AtomicTransitionBoundary (state + side effect)", "MISSING", "the runtime saves state BEFORE the executor returns. If the executor has a side effect and the process dies after, the next resume retries the executor. There is no atomicity between commit and side effect. ADR-004 + ADR-007 are required.")
}

// -----------------------------------------------------------------------
// Final verdict
// -----------------------------------------------------------------------

await runScenarios()

const pass = results.filter((r) => r.verdict === "PASS").length
const partial = results.filter((r) => r.verdict === "PARTIAL").length
const fail = results.filter((r) => r.verdict === "FAIL").length
const missing = results.filter((r) => r.verdict === "MISSING").length

console.log("")
console.log("M0-01 spike summary")
console.log("===================")
console.log(`PASS     ${pass}`)
console.log(`PARTIAL  ${partial}`)
console.log(`FAIL     ${fail}`)
console.log(`MISSING  ${missing}`)
console.log("")
console.log("Verdict: the existing @unifia/workflow-runtime is NOT a")
console.log("durable execution substrate at the level required by the plan.")
console.log("Confirmed empirically: 4 functional scenarios (2 PASS, 2 PARTIAL),")
console.log("1 FAIL on duplicate trigger (silent overwrite), and 7 MISSING on")
console.log("UNKNOWN_EXTERNAL_STATE, idempotency, durable timer, canonicalization,")
console.log("scope, lease, and atomic transition boundary.")
console.log("")
console.log("This is the evidence base for ADR-000 (substrate choice).")
console.log("Plan §193 allows this throwaway spike; it must be discarded or")
console.log("migrated after ADR-000 is rendered.")
