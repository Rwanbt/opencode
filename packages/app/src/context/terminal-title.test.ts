import { describe, expect, test } from "bun:test"
import { defaultTitle, isDefaultTitle, titleNumber } from "./terminal-title"

// D-08: pure i18n helpers for terminal tab titles — no reactivity, no I/O.

describe("defaultTitle", () => {
  test("renders the English template with the number", () => {
    expect(defaultTitle(3)).toBe("Terminal 3")
  })
})

describe("isDefaultTitle", () => {
  test("matches the English default for the same number", () => {
    expect(isDefaultTitle("Terminal 3", 3)).toBe(true)
  })

  test("matches a localized default (zh-Hans)", () => {
    expect(isDefaultTitle("终端 5", 5)).toBe(true)
  })

  test("matches a localized default (ja)", () => {
    expect(isDefaultTitle("ターミナル 2", 2)).toBe(true)
  })

  test("rejects a default whose number does not line up", () => {
    expect(isDefaultTitle("Terminal 3", 4)).toBe(false)
  })

  test("rejects a user-chosen title", () => {
    expect(isDefaultTitle("deploy logs", 3)).toBe(false)
  })
})

describe("titleNumber", () => {
  test("recovers the number from an English default within range", () => {
    expect(titleNumber("Terminal 7", 10)).toBe(7)
  })

  test("recovers the number from a localized default", () => {
    expect(titleNumber("터미널 4", 10)).toBe(4)
  })

  test("returns undefined for a non-default title", () => {
    expect(titleNumber("scratch", 10)).toBeUndefined()
  })

  test("returns undefined when the number is beyond max", () => {
    expect(titleNumber("Terminal 15", 10)).toBeUndefined()
  })
})
