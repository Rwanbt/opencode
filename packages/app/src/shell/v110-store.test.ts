// SPDX-License-Identifier: MIT
import { describe, expect, test } from "bun:test"
import { shown } from "@/shell/v110-store"
import { SHELL_MODES } from "@unifia/workbench-shell/modes"
import { AUTOMATE_CAPABILITY, isAutomateAccessible } from "@/context/automate-flag"
describe("a2 shell store", () => {
  test("registry stays 4 modes (GAP-02)", () => {
    expect([...SHELL_MODES]).toEqual(["code", "work", "design", "automate"])
  })
  test("automate gate stays workflow.run (GAP-03)", () => {
    expect(AUTOMATE_CAPABILITY).toBe("workflow.run")
    expect(isAutomateAccessible(new Set(["workflow.run"]))).toBe(true)
    expect(isAutomateAccessible(new Set([]))).toBe(false)
  })
  test("panel visibility follows the A1 invariant", () => {
    expect(shown(["context", "inspector"], "desktop-wide")).toEqual(["context", "inspector"])
    expect(shown(["context", "inspector"], "desktop-compact")).toEqual(["inspector"])
    expect(shown(["inspector", "context"], "desktop-compact")).toEqual(["context"])
    expect(shown(["context"], "phone-portrait")).toEqual(["context"])
  })
})
