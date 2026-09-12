import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { teamCapabilities } from "@/context/team"

// Mobile and desktop may control lifecycle, but neither surface may approve a
// semantic review gate. Review verdicts are produced by an independent model
// and rendered as evidence; they are never turned into an approval button.

const DIRECTORY = import.meta.dir
const ALLOWED_PROP_HANDLERS = new Set(["onMore", "onPick", "onSaveDefault", "onClearOverride", "onSelect"])
const FORBIDDEN_REVIEW_ACTIONS = ["approve", "reject", "overrideGate", "forceIntegrate"]

function componentSources(): { name: string; content: string }[] {
  return readdirSync(DIRECTORY, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => ({ name: entry.name, content: readFileSync(join(DIRECTORY, entry.name), "utf8") }))
}

describe("the Team surface keeps semantic review non-interactive", () => {
  test("there are components to check", () => {
    expect(componentSources().length).toBeGreaterThan(0)
  })

  test("every callback supplied by a parent is on the known-safe list", () => {
    const unexpected: string[] = []
    for (const source of componentSources()) {
      for (const match of source.content.matchAll(/onClick=\{[^}]*?props\.(\w+)/g)) {
        if (!ALLOWED_PROP_HANDLERS.has(match[1])) unexpected.push(`${source.name}: ${match[1]}`)
      }
    }
    expect(unexpected).toEqual([])
  })

  test("no prop can approve, reject or bypass a review gate", () => {
    const found: string[] = []
    for (const source of componentSources()) {
      for (const word of FORBIDDEN_REVIEW_ACTIONS) {
        const pattern = new RegExp(`\\bon${word[0].toUpperCase()}${word.slice(1)}\\b`)
        if (pattern.test(source.content)) found.push(`${source.name}: on${word}`)
      }
    }
    expect(found).toEqual([])
  })

  test("lifecycle controls require a reachable shared server", () => {
    expect(teamCapabilities("ok")).toMatchObject({ canStart: true, canPause: true, canCancel: true })
    for (const reachability of ["offline", "unavailable", "error"] as const) {
      expect(teamCapabilities(reachability)).toMatchObject({ canStart: false, canPause: false, canCancel: false })
    }
  })
})
