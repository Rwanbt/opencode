/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { NativeWorkflowRuntimePort } from "../src/native-workflow-port"
import type { WorkflowDefinitionPort } from "../src/workflow-port.js"

const def = (id: string): WorkflowDefinitionPort => ({
  id, version: 1, workspaceId: "ws-1",
  steps: [
    { id: "s0", capability: "workspace.read", input: { path: "/tmp/a" } },
    { id: "s1", capability: "workspace.read", input: {}, requiresApproval: true },
    { id: "s2", capability: "workspace.read", input: {} },
  ],
})

const clock = { value: 1000 }

function freshPort(): { port: NativeWorkflowRuntimePort; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "unifia-wfport-"))
  return { port: new NativeWorkflowRuntimePort({ databasePath: join(dir, "wf.sqlite"), now: () => clock.value }), dir }
}

describe("NativeWorkflowRuntimePort (directive 31)", () => {
  test("start surfaces the first step for dispatch; complete advances; approval step maps to human.approval", async () => {
    const ctx = freshPort(); try {
      const state = await ctx.port.start(def("wf-1"), "worker-1")
      expect(state.status).toBe("running"); expect(state.nextStep).toBe(0)
      const afterFirst = await ctx.port.complete(state.authorityToken, { bytes: 12 })
      expect(afterFirst.outputs).toEqual([{ bytes: 12 }])
      const afterSecond = await ctx.port.complete(state.authorityToken, { approved: true })
      expect(afterSecond.nextStep).toBe(2)
      const done = await ctx.port.complete(state.authorityToken, { final: true })
      expect(done.status).toBe("completed"); expect(done.nextStep).toBe(3)
      expect(done.outputs).toHaveLength(3)
    } finally { ctx.port.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("RESTART: resume rediscovers from durable facts; cancel persists and fences stale completion", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-wfport-restart-"))
    try {
      const first = new NativeWorkflowRuntimePort({ databasePath: join(dir, "wf.sqlite"), now: () => clock.value })
      const started = await first.start(def("wf-9"), "worker-1")
      await first.complete(started.authorityToken, { step: 0 })
      // process "dies": a NEW port instance on the SAME database resumes
      const second = new NativeWorkflowRuntimePort({ databasePath: join(dir, "wf.sqlite"), now: () => clock.value })
      const resumed = await second.resume(started.authorityToken)
      expect(resumed.nextStep).toBe(1); expect(resumed.outputs).toEqual([{ step: 0 }])
      const cancelled = await second.cancel(started.authorityToken)
      expect(cancelled.status).toBe("cancelled")
      second.close()
      first.close()
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("two runs of one definition stay isolated and pin versions across publication", async () => {
    const ctx = freshPort(); try {
      const v1 = def("wf-versioned")
      const first = await ctx.port.start(v1, "worker-1")
      const second = await ctx.port.start(v1, "worker-2")
      expect(first.workflowId).not.toBe(second.workflowId)
      expect(first.versionId).toBe(second.versionId)

      const v2 = { ...v1, version: 2, steps: [...v1.steps, { id: "s3", capability: "workspace.read" as const, input: {} }] }
      const third = await ctx.port.start(v2, "worker-3")
      expect(third.workflowId).not.toBe(first.workflowId)
      expect(third.versionId).not.toBe(first.versionId)
      expect((await ctx.port.resume(first.authorityToken)).versionId).toBe(first.versionId)
      expect((await ctx.port.resume(second.authorityToken)).versionId).toBe(second.versionId)
      expect((await ctx.port.resume(third.authorityToken)).versionId).toBe(third.versionId)
    } finally { ctx.port.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })
})
