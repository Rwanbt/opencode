/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import type { DesignSkillManifest } from "@unifia/skill-hub"
import { countBlockedSkills, createSkillPickerRows } from "../src/skill-picker"

const SKILLS: readonly DesignSkillManifest[] = [
  {
    name: "web-prototype",
    description: "A web prototype.",
    mode: "prototype",
    scenario: "design",
    requiresDesignSystem: true,
    body: "",
  },
  {
    name: "deck-basic",
    description: "A slide deck.",
    mode: "deck",
    scenario: "design",
    requiresDesignSystem: false,
    body: "",
  },
  {
    name: "ad-copy",
    description: "Ad copy generator.",
    mode: "utility",
    scenario: "marketing",
    requiresDesignSystem: false,
    body: "",
  },
]

describe("createSkillPickerRows", () => {
  test("returns one row per skill", () => {
    const rows = createSkillPickerRows({ skills: SKILLS })
    expect(rows.map((r) => r.id).sort()).toEqual(["ad-copy", "deck-basic", "web-prototype"])
  })

  test("selected skill comes first", () => {
    const rows = createSkillPickerRows({ skills: SKILLS, selectedId: "ad-copy" })
    expect(rows[0]?.id).toBe("ad-copy")
    expect(rows[0]?.selected).toBe(true)
    // The remaining rows are sorted by name.
    const rest = rows.slice(1).map((r) => r.id)
    expect(rest).toEqual(["deck-basic", "web-prototype"])
  })

  test("canRun is false when requiresDesignSystem and no design system is active", () => {
    const rows = createSkillPickerRows({ skills: SKILLS, hasDesignSystem: false })
    const prototype = rows.find((r) => r.id === "web-prototype")
    const deck = rows.find((r) => r.id === "deck-basic")
    expect(prototype?.canRun).toBe(false)
    expect(deck?.canRun).toBe(true)
  })

  test("canRun is true when a design system is active", () => {
    const rows = createSkillPickerRows({ skills: SKILLS, hasDesignSystem: true })
    for (const row of rows) expect(row.canRun).toBe(true)
  })

  test("deterministic for the same input", () => {
    const a = createSkillPickerRows({ skills: SKILLS })
    const b = createSkillPickerRows({ skills: SKILLS })
    expect(a).toEqual(b)
  })

  test("empty input returns an empty list", () => {
    expect(createSkillPickerRows({ skills: [] })).toEqual([])
  })
})

describe("countBlockedSkills", () => {
  test("counts the skills that cannot run because of a missing design system", () => {
    expect(countBlockedSkills(SKILLS, false)).toBe(1)
    expect(countBlockedSkills(SKILLS, true)).toBe(0)
  })

  test("empty input returns zero", () => {
    expect(countBlockedSkills([], false)).toBe(0)
    expect(countBlockedSkills([], true)).toBe(0)
  })
})
