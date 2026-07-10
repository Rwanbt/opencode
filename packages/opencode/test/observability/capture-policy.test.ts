import { describe, expect, test } from "bun:test"
import { resolveCapturePolicy } from "../../src/observability/capture-policy"

describe("observability capture policy", () => {
  test("is disabled and metadata-only by default", () => {
    expect(resolveCapturePolicy({})).toEqual({ enabled: false, level: "local_metadata", policyVersion: 3 })
  })

  test("rejects content capture modes in phase 1", () => {
    expect(() => resolveCapturePolicy({ enabled: true, captureMode: "local_full" })).toThrow()
  })
})
