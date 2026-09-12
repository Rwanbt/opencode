/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { applyCatchUp, applyOverlap, nextFireAt, SchedulerError } from "../src/index.ts"

const binding = (cron: string, timezone?: string) => ({ bindingId: "b1", workflowVersionId: "v1", trigger: { kind: "schedule" as const, cron, overlapPolicy: "forbid" as const, catchUpPolicy: "fire-once" as const, ...(timezone ? { timezone } : {}) }, createdAt: 0 })

describe("substrate-agnostic scheduler decisions", () => {
  test("forbid rejects an in-flight run", () => expect(applyOverlap("forbid", { inFlightRunId: "r1" }, "r2")).toEqual({ accept: false, reason: "RUN_IN_FLIGHT" }))
  test("queue and replace preserve their explicit semantics", () => { expect(applyOverlap("queue", { inFlightRunId: "r1" }, "r2")).toEqual({ accept: true, queued: true }); expect(applyOverlap("replace", { inFlightRunId: "r1" }, "r2")).toEqual({ accept: true, cancel: "r1" }) })
  test("catch-up coalesces or replays within the window", () => { const now = 10_000; expect(applyCatchUp("fire-once", [7_000, 8_000, 9_000], 2_500, now)).toEqual([{ scheduledAt: 9_000 }]); expect(applyCatchUp("fire-each-missed", [7_000, 8_000, 9_000], 2_500, now)).toHaveLength(2) })
  test("nextFireAt computes a UTC five-field cron slot", () => expect(nextFireAt(binding("*/15 * * * *", "UTC"), Date.UTC(2026, 0, 1, 12, 1))).toBe(Date.UTC(2026, 0, 1, 12, 15)))
  test("non-UTC timezone is explicit until IANA/DST support exists", () => expect(() => nextFireAt(binding("30 2 * * *", "Europe/Paris"), Date.now())).toThrow(SchedulerError))
})
