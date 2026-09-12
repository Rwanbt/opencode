/* SPDX-License-Identifier: MIT */

import { expect, test } from "bun:test"
import { WorkbenchHttpError } from "@unifia/workbench-shell"
import { decideEventRetry } from "./event-retry"

test("a non-retryable WorkbenchHttpError stops immediately, well under 5 attempts", () => {
  const reason = new WorkbenchHttpError(400, false)
  expect(decideEventRetry(1, reason)).toEqual({ action: "stop" })
})

test("a retryable WorkbenchHttpError backs off exponentially", () => {
  const reason = new WorkbenchHttpError(503, true)
  expect(decideEventRetry(1, reason)).toEqual({ action: "wait", delayMs: 1_000 })
  expect(decideEventRetry(2, reason)).toEqual({ action: "wait", delayMs: 2_000 })
  expect(decideEventRetry(3, reason)).toEqual({ action: "wait", delayMs: 4_000 })
})

test("backoff is capped and does not grow without bound", () => {
  const reason = new WorkbenchHttpError(503, true)
  // Uncapped this would be 1_000 * 2^5 = 32_000.
  expect(decideEventRetry(6, reason)).toEqual({ action: "wait", delayMs: 30_000 })
})

test("a non-HTTP error (e.g. a network failure) is treated as retryable", () => {
  expect(decideEventRetry(1, new Error("network down"))).toEqual({ action: "wait", delayMs: 1_000 })
})

test("retries stop once the attempt cap is exceeded, even for a retryable error", () => {
  const reason = new WorkbenchHttpError(503, true)
  expect(decideEventRetry(9, reason)).toEqual({ action: "stop" })
})
