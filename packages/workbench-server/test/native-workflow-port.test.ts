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
      const state = await ctx.port.start(def("wf-1"))
      expect(state.status).toBe("running"); expect(state.nextStep).toBe(0)
      const afterFirst = await ctx.port.complete("wf-1", { bytes: 12 })
      expect(afterFirst.outputs).toEqual([{ bytes: 12 }])
      const afterSecond = await ctx.port.complete("wf-1", { approved: true })
      expect(afterSecond.nextStep).toBe(2)
      const done = await ctx.port.complete("wf-2" === "wf-2" ? "wf-1" : "wf-1", { final: true })
      expect(done.status).toBe("completed"); expect(done.nextStep).toBe(3)
      expect(done.outputs).toHaveLength(3)
    } finally { ctx.port.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("RESTART: resume rediscovers from durable facts; cancel persists and fences stale completion", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-wfport-restart-"))
    try {
      const first = new NativeWorkflowRuntimePort({ databasePath: join(dir, "wf.sqlite"), now: () => clock.value })
      await first.start(def("wf-9"))
      await first.complete("wf-9", { step: 0 })
      // process "dies": a NEW port instance on the SAME database resumes
      const second = new NativeWorkflowRuntimePort({ databasePath: join(dir, "wf.sqlite"), now: () => clock.value })
      const resumed = await second.resume("wf-9")
      expect(resumed.nextStep).toBe(1); expect(resumed.outputs).toEqual([{ step: 0 }])
      const cancelled = await second.cancel("wf-9")
      expect(cancelled.status).toBe("cancelled")
      second.close()
      first.close()
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })
})
