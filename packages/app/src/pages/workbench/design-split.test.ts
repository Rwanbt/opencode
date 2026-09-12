/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  clampChatWidth,
  DEFAULT_CHAT_WIDTH,
  MAX_CHAT_WIDTH,
  MIN_CHAT_WIDTH,
} from "@/pages/workbench/design-split-clamp"

describe("clampChatWidth", () => {
  test("returns the value when within the inclusive range", () => {
    expect(clampChatWidth(MIN_CHAT_WIDTH)).toBe(MIN_CHAT_WIDTH)
    expect(clampChatWidth(DEFAULT_CHAT_WIDTH)).toBe(DEFAULT_CHAT_WIDTH)
    expect(clampChatWidth(MAX_CHAT_WIDTH)).toBe(MAX_CHAT_WIDTH)
    expect(clampChatWidth(500)).toBe(500)
  })

  test("clamps below MIN_CHAT_WIDTH to MIN_CHAT_WIDTH", () => {
    expect(clampChatWidth(MIN_CHAT_WIDTH - 1)).toBe(MIN_CHAT_WIDTH)
    expect(clampChatWidth(0)).toBe(MIN_CHAT_WIDTH)
    expect(clampChatWidth(-100)).toBe(MIN_CHAT_WIDTH)
  })

  test("clamps above MAX_CHAT_WIDTH to MAX_CHAT_WIDTH", () => {
    expect(clampChatWidth(MAX_CHAT_WIDTH + 1)).toBe(MAX_CHAT_WIDTH)
    expect(clampChatWidth(1000)).toBe(MAX_CHAT_WIDTH)
    expect(clampChatWidth(Number.MAX_SAFE_INTEGER)).toBe(MAX_CHAT_WIDTH)
  })

  test("returns DEFAULT_CHAT_WIDTH when input is NaN", () => {
    expect(clampChatWidth(Number.NaN)).toBe(DEFAULT_CHAT_WIDTH)
  })
})
