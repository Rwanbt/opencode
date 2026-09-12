/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { CatchUpPolicySchema, OverlapPolicySchema } from "../src/timer.ts"

describe("timer policies", () => {
  test("accept every documented overlap policy", () => {
    expect(OverlapPolicySchema.options).toEqual(["allow", "forbid", "queue", "replace"])
  })

  test("accept every documented catch-up policy", () => {
    expect(CatchUpPolicySchema.options).toEqual(["skip", "fire-once", "fire-each-missed"])
  })

  test("reject unknown policies", () => {
    expect(() => OverlapPolicySchema.parse("drop")).toThrow()
    expect(() => CatchUpPolicySchema.parse("replay")).toThrow()
  })
})
