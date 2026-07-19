import { describe, expect, test } from "bun:test"
import { requireFileContent, sameFileMetadata } from "./load-response"

describe("requireFileContent (F7)", () => {
  test("routes a missing SDK payload to the error path", () => {
    expect(() => requireFileContent(undefined)).toThrow("File read returned no data")
  })

  test("preserves a legitimate empty file payload", () => {
    const emptyFile = { type: "text" as const, content: "" }
    expect(requireFileContent(emptyFile)).toBe(emptyFile)
  })

  test("preserves the SDK error when the payload is missing", () => {
    const error = new Error("SDK failure")
    expect(() => requireFileContent(undefined, error)).toThrow(error)
  })
})

describe("sameFileMetadata", () => {
  test("treats equivalent VCS metadata as unchanged even when patch objects differ", () => {
    const patch = { oldFileName: "a", newFileName: "a", hunks: [] }
    const current = { type: "text" as const, content: "seed", diff: "same", patch }
    const incoming = { ...current, content: "stale backend bytes", patch: { ...patch } }
    expect(sameFileMetadata(current, incoming)).toBe(true)
  })

  test("detects a targeted metadata change without comparing source content", () => {
    const current = { type: "text" as const, content: "seed", diff: "before" }
    const incoming = { type: "text" as const, content: "stale backend bytes", diff: "after" }
    expect(sameFileMetadata(current, incoming)).toBe(false)
  })
})