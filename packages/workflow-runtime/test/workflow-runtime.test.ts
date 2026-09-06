/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Deprecated file (V1 WorkflowRuntime legacy API).
 *
 * The legacy V1 `WorkflowRuntime` / `InMemoryWorkflowStore` /
 * `FileWorkflowStore` API has been replaced by
 * `InMemoryDurableHistoryAuthority` (M1-09 impl, see `in-memory.ts`).
 *
 * This file is intentionally a no-op so that `bun test` at the
 * package root does not error. The V2 contract surface is covered
 * by `test/in-memory.test.ts`. The legacy API is removed in the
 * `agent/automate-v2-baseline-20260901` branch.
 */
import { describe, expect, test } from "bun:test"

describe("workflow-runtime (deprecated V1 API)", () => {
  test("(stub) legacy V1 API removed; see test/in-memory.test.ts", () => {
    expect(1).toBe(1)
  })
})
