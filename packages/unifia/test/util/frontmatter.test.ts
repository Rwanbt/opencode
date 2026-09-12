/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import matter from "gray-matter"
import { parseFrontmatter, stringifyFrontmatter } from "../../src/util/frontmatter"

// gray-matter@4.0.3 declares js-yaml@^3 and builds its default engine at import
// time as `yaml.safeLoad.bind(yaml)`. This workspace pins js-yaml@4 and hoists
// it with no nested copy under gray-matter, so the default engine binds to v4
// stubs that throw "Function yaml.safeLoad is removed in js-yaml 4".
//
// Every frontmatter parse in the app therefore failed. Measured on one startup:
// 34 skills refused to load, each publishing a session.error. Agent and command
// markdown go through the same engine and were failing for the same reason.
//
// The first test below is the one that matters: it asserts the DEFAULT engine
// is broken, so that if a future dependency bump fixes gray-matter upstream,
// this file fails and tells us the wrapper is no longer needed — rather than
// leaving a workaround nobody dares remove.

const SAMPLE = `---
name: demo
description: a skill
---

body text
`

describe("gray-matter's default engine (the bug being worked around)", () => {
  test("still throws on js-yaml 4 — the wrapper is still required", () => {
    expect(() => matter(SAMPLE)).toThrow(/safeLoad/)
  })
})

describe("parseFrontmatter", () => {
  test("parses frontmatter that the default engine cannot", () => {
    const parsed = parseFrontmatter(SAMPLE)
    expect(parsed.data).toEqual({ name: "demo", description: "a skill" })
    expect(parsed.content.trim()).toBe("body text")
  })

  test("returns an empty object when there is no frontmatter", () => {
    const parsed = parseFrontmatter("just a body\n")
    expect(parsed.data).toEqual({})
    expect(parsed.content.trim()).toBe("just a body")
  })

  test("handles an empty frontmatter block without returning null data", () => {
    // js-yaml's load() returns undefined for an empty document; gray-matter
    // consumers index into `.data`, so it has to be an object.
    const parsed = parseFrontmatter("---\n---\nbody\n")
    expect(parsed.data).toEqual({})
  })

  test("parses nested and list values, not just flat strings", () => {
    const parsed = parseFrontmatter("---\nmeta:\n  tags: [a, b]\n---\nx\n")
    expect(parsed.data).toEqual({ meta: { tags: ["a", "b"] } })
  })

  test("still rejects malformed YAML rather than silently returning nothing", () => {
    expect(() => parseFrontmatter("---\n: : :\n---\nx\n")).toThrow()
  })
})

describe("stringifyFrontmatter", () => {
  test("round-trips through parseFrontmatter", () => {
    const out = stringifyFrontmatter("hello", { name: "demo", tags: ["a", "b"] })
    const parsed = parseFrontmatter(out)
    expect(parsed.data).toEqual({ name: "demo", tags: ["a", "b"] })
    expect(parsed.content.trim()).toBe("hello")
  })
})
