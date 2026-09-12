/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { OperationRegistry } from "../src/operations.js"

describe("operation registry", () => {
  test("deduplicates idempotent starts and cancels active work", () => {
    let sequence = 0
    const registry = new OperationRegistry(() => `op-${++sequence}`, () => 100)
    const first = registry.start("workspace", "session", "request-1")
    const duplicate = registry.start("workspace", "session", "request-1")
    expect(duplicate.id).toBe(first.id)
    expect(registry.cancel(first.id)?.state).toBe("cancelled")
    expect(registry.complete(first.id)?.state).toBe("cancelled")
  })

  test("does not cancel completed work", () => {
    const registry = new OperationRegistry(() => "op-1")
    const operation = registry.start("workspace", "session")
    registry.complete(operation.id)
    expect(registry.cancel(operation.id)).toBeUndefined()
  })

  test("expires terminal operations and their idempotency keys", () => {
    let now = 0
    let sequence = 0
    const registry = new OperationRegistry(() => `op-${++sequence}`, () => now, { retentionMs: 100, maxEntries: 10 })
    const operation = registry.start("workspace", "session", "request-1")
    registry.complete(operation.id)
    now = 101
    registry.start("workspace", "session", "request-2")
    expect(registry.get(operation.id)).toBeUndefined()
    expect(registry.start("workspace", "session", "request-1").id).not.toBe(operation.id)
  })

  test("bounds terminal history when the retention window is still open", () => {
    let sequence = 0
    const registry = new OperationRegistry(() => `op-${++sequence}`, () => 100, { maxEntries: 2 })
    const first = registry.start("workspace", "session")
    registry.complete(first.id)
    const second = registry.start("workspace", "session")
    registry.complete(second.id)
    const third = registry.start("workspace", "session")
    expect(registry.get(first.id)).toBeUndefined()
    expect(registry.get(third.id)?.state).toBe("running")
  })
})
