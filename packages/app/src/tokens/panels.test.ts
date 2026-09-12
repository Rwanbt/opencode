/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { CHAT, CHAT_NARROW, clamp, CONTEXT, CONTEXT_NARROW, INSPECTOR, INSPECTOR_NARROW, NARROW, narrow, RAIL, RAIL_COMPACT, TOPBAR, visible, width } from "@/tokens/panels"

describe("v110 panel contract", () => {
  test("widths match the maquette geometry", () => {
    expect(TOPBAR).toBe(48)
    expect(RAIL).toBe(78)
    expect(RAIL_COMPACT).toBe(62)
    expect(CONTEXT).toBe(248)
    expect(INSPECTOR).toBe(300)
    expect(CHAT).toBe(348)
  })

  test("narrow-desktop overrides match the 1360px media rule", () => {
    expect(NARROW).toBe(1360)
    expect(narrow(1360)).toBe(true)
    expect(narrow(1361)).toBe(false)
    expect(width("context", 1440)).toBe(CONTEXT)
    expect(width("context", 1280)).toBe(CONTEXT_NARROW)
    expect(width("inspector", 1440)).toBe(INSPECTOR)
    expect(width("inspector", 1280)).toBe(INSPECTOR_NARROW)
    expect(width("chat", 1440)).toBe(CHAT)
    expect(width("chat", 1280)).toBe(CHAT_NARROW)
  })

  test("clamp keeps sizes inside bounds and maps NaN to min", () => {
    expect(clamp(100, 10, 50)).toBe(50)
    expect(clamp(5, 10, 50)).toBe(10)
    expect(clamp(30, 10, 50)).toBe(30)
    expect(clamp(Number.NaN, 10, 50)).toBe(10)
  })

  test("visibility applies the side-state invariants", () => {
    expect(visible(["context", "inspector"], "desktop-wide")).toEqual(["context", "inspector"])
    expect(visible(["context", "inspector", "context"], "desktop-wide")).toEqual(["context", "inspector"])
    expect(visible(["context", "inspector"], "desktop-compact")).toEqual(["inspector"])
    expect(visible(["inspector", "context"], "desktop-compact")).toEqual(["context"])
    expect(visible([], "desktop-compact")).toEqual([])
    expect(visible(["context", "inspector"], "tablet-portrait")).toEqual(["context", "inspector"])
    expect(visible(["context"], "phone-portrait")).toEqual(["context"])
  })
})
