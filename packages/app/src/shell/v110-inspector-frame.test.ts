/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { TABS, normalizeTab } from "@/shell/v110-inspector-frame"

describe("a2 inspector frame", () => {
  test("tabs stay Explorer, Inspector, Execution (INTERACTIONS.md)", () => {
    expect([...TABS]).toEqual(["explorer", "inspector", "execution"])
  })
  test("unknown tabs fall back to explorer", () => {
    expect(normalizeTab(undefined)).toBe("explorer")
    expect(normalizeTab("graph")).toBe("explorer")
    expect(normalizeTab("inspector")).toBe("inspector")
    expect(normalizeTab("execution")).toBe("execution")
  })
  test("frame owns structure only: no app runtime import (P1-2, P1-3)", async () => {
    const src = await readFile(new URL("./v110-inspector-frame.tsx", import.meta.url), "utf8")
    expect(src.includes("@/")).toBe(false)
    expect(src.includes("@unifia/workbench-shell")).toBe(false)
  })
})
