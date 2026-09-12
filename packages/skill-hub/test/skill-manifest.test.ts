/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  SKILL_MODES,
  SKILL_SCENARIOS,
  buildDesignSkillContext,
  canSkillRun,
  parseDesignSkillManifest,
} from "../src/skill-manifest"

const FULL_SKILL = `---
name: web-prototype
description: Build a clickable web prototype for a product idea.
mode: prototype
scenario: design
requiresDesignSystem: true
---

## What to do

Produce a single-file HTML prototype with at least one interactive control.

## Constraints

- Inline CSS, no external assets
- No third-party fonts
`

const MINIMAL_SKILL = `---
name: deck-basic
description: Slide deck for a kickoff meeting.
---`

describe("parseDesignSkillManifest", () => {
  test("frontmatter minimal is accepted with defaults", () => {
    const parsed = parseDesignSkillManifest(MINIMAL_SKILL)
    expect(parsed.name).toBe("deck-basic")
    expect(parsed.description).toBe("Slide deck for a kickoff meeting.")
    expect(parsed.mode).toBe("prototype")
    expect(parsed.scenario).toBe("design")
    expect(parsed.requiresDesignSystem).toBe(false)
  })

  test("missing `name` is refused", () => {
    const source = `---
description: x
---`
    expect(() => parseDesignSkillManifest(source)).toThrow(/missing `name`/)
  })

  test("missing `description` is refused", () => {
    const source = `---
name: web-prototype
---`
    expect(() => parseDesignSkillManifest(source)).toThrow(/missing `description`/)
  })

  test("`mode` outside the closed union is refused", () => {
    const source = `---
name: web-prototype
description: x
mode: hologram
---`
    expect(() => parseDesignSkillManifest(source)).toThrow(/`mode` is not in the closed union/)
  })

  test("`scenario` outside the closed union is refused", () => {
    const source = `---
name: web-prototype
description: x
scenario: legal
---`
    expect(() => parseDesignSkillManifest(source)).toThrow(/`scenario` is not in the closed union/)
  })

  test("`requiresDesignSystem` not a boolean is refused", () => {
    const source = `---
name: web-prototype
description: x
requiresDesignSystem: yes
---`
    expect(() => parseDesignSkillManifest(source)).toThrow(/not a boolean/)
  })

  test("frontmatter missing opening fence is refused", () => {
    const source = `name: web-prototype\ndescription: x\n---\nbody`
    expect(() => parseDesignSkillManifest(source)).toThrow(/missing the opening/)
  })

  test("frontmatter missing closing fence is refused", () => {
    const source = `---\nname: web-prototype\ndescription: x\nbody without closing`
    expect(() => parseDesignSkillManifest(source)).toThrow(/missing the closing/)
  })

  test("unknown frontmatter key is refused", () => {
    const source = `---
name: web-prototype
description: x
author: me
---`
    expect(() => parseDesignSkillManifest(source)).toThrow(/unknown key/)
  })

  test("frontmatter `name` not matching the id regex is refused", () => {
    const source = `---
name: WebPrototype
description: x
---`
    expect(() => parseDesignSkillManifest(source)).toThrow(/id regex/)
  })

  test("body is preserved verbatim, with leading whitespace normalised", () => {
    const parsed = parseDesignSkillManifest(FULL_SKILL)
    // The body follows the closing `---` fence. A blank line is
    // typical; the parser trims the leading blank so the body starts
    // at the first heading.
    expect(parsed.body.startsWith("## What to do")).toBe(true)
    expect(parsed.body).toContain("No third-party fonts")
  })

  test("quoted strings are unquoted", () => {
    const source = `---
name: web-prototype
description: "A long description with: a colon."
mode: 'deck'
---`
    const parsed = parseDesignSkillManifest(source)
    expect(parsed.description).toBe("A long description with: a colon.")
    expect(parsed.mode).toBe("deck")
  })

  test("every mode in SKILL_MODES is accepted", () => {
    for (const mode of SKILL_MODES) {
      const source = `---\nname: web-prototype\ndescription: x\nmode: ${mode}\n---`
      expect(parseDesignSkillManifest(source).mode).toBe(mode)
    }
  })

  test("every scenario in SKILL_SCENARIOS is accepted", () => {
    for (const scenario of SKILL_SCENARIOS) {
      const source = `---\nname: web-prototype\ndescription: x\nscenario: ${scenario}\n---`
      expect(parseDesignSkillManifest(source).scenario).toBe(scenario)
    }
  })
})

describe("buildDesignSkillContext", () => {
  test("deterministic for the same input", () => {
    const skill = parseDesignSkillManifest(FULL_SKILL)
    const a = buildDesignSkillContext(skill)
    const b = buildDesignSkillContext(skill)
    expect(a).toBe(b)
  })

  test("preserves the body verbatim", () => {
    const skill = parseDesignSkillManifest(FULL_SKILL)
    const context = buildDesignSkillContext(skill)
    expect(context).toContain("## What to do")
    expect(context).toContain("No third-party fonts")
  })

  test("names the skill and the mode/scenario in the preamble", () => {
    const skill = parseDesignSkillManifest(FULL_SKILL)
    const context = buildDesignSkillContext(skill)
    expect(context).toContain("Active skill: web-prototype.")
    expect(context).toContain("Mode: prototype.")
    expect(context).toContain("Scenario: design.")
  })

  test("two skills produce two different contexts", () => {
    const a = buildDesignSkillContext(parseDesignSkillManifest(FULL_SKILL))
    const b = buildDesignSkillContext(parseDesignSkillManifest(MINIMAL_SKILL))
    expect(a).not.toBe(b)
  })

  test("requiresDesignSystem is surfaced when true", () => {
    const skill = parseDesignSkillManifest(FULL_SKILL)
    const context = buildDesignSkillContext(skill)
    expect(context).toContain("A design system is required")
  })

  test("requiresDesignSystem is NOT surfaced when false", () => {
    const skill = parseDesignSkillManifest(MINIMAL_SKILL)
    const context = buildDesignSkillContext(skill)
    expect(context).not.toContain("A design system is required")
  })
})

describe("canSkillRun", () => {
  test("skill without requiresDesignSystem always runs", () => {
    const skill = parseDesignSkillManifest(MINIMAL_SKILL)
    expect(canSkillRun(skill, false)).toBe(true)
    expect(canSkillRun(skill, true)).toBe(true)
  })

  test("skill with requiresDesignSystem only runs when a design system is active", () => {
    const skill = parseDesignSkillManifest(FULL_SKILL)
    expect(canSkillRun(skill, true)).toBe(true)
    expect(canSkillRun(skill, false)).toBe(false)
  })
})
