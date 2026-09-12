/* SPDX-License-Identifier: MIT */

import { WorkbenchHttpError } from "@unifia/workbench-shell"

// C2-2/FUNC-001: exponential backoff, capped delay and capped attempt count.
// A non-retryable WorkbenchHttpError (client.ts:266, computed but never
// consulted before this fix) stops the loop immediately — retrying a 4xx
// that will never succeed just spins forever and hides the real error.
const EVENT_RETRY_BASE_DELAY_MS = 1_000
const EVENT_RETRY_MAX_DELAY_MS = 30_000
const EVENT_RETRY_MAX_ATTEMPTS = 8

export type EventRetryDecision = { action: "stop" } | { action: "wait"; delayMs: number }

export function decideEventRetry(attempt: number, reason: unknown): EventRetryDecision {
  const retryable = !(reason instanceof WorkbenchHttpError) || reason.retryable
  if (!retryable || attempt > EVENT_RETRY_MAX_ATTEMPTS) return { action: "stop" }
  return { action: "wait", delayMs: Math.min(EVENT_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), EVENT_RETRY_MAX_DELAY_MS) }
}
