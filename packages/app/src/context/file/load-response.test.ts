import { describe, expect, test } from "bun:test"
import { requireFileContent } from "./load-response"

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
