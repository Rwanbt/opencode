/* SPDX-License-Identifier: MIT */

import { createDesignSpecPanelState } from "../src/design-spec.js"
import { describe, expect, test } from "bun:test"

test('design-spec.test', async () => {

let checks = 0
const check = (condition: boolean, message: string): void => { checks += 1; if (!condition) throw new Error(message) }

const valid = JSON.stringify({ id: "landing-page", version: "1.0.0", target: "design", title: "Landing", capabilities: ["workspace.read", "secret.read"], rules: [], tokens: { colors: { primary: "#ffffff" } } })
const inline = createDesignSpecPanelState({ kind: "inline", value: valid })
check(inline.empty === false, "valid spec is not empty")
check(inline.spec?.id === "landing-page", "valid inline spec was not parsed")
check(inline.capabilities.granted.length === 0 && inline.capabilities.denied.length === 2, "spec capabilities were elevated")

const invalid = createDesignSpecPanelState({ kind: "file", path: "design/spec.json", value: '{\n  "id": "broken"\n}' })
check(invalid.empty === false, "invalid spec is not empty")
check(invalid.source.kind === "file" && invalid.source.path === "design/spec.json", "file provenance was not preserved")
check(invalid.diagnostics.length === 1 && invalid.diagnostics[0]?.line === 1, "semantic diagnostics did not point to the source")

const malformed = createDesignSpecPanelState({ kind: "inline", value: '{\n  "id": ' })
check(malformed.empty === false, "malformed spec is not empty")
check(malformed.diagnostics[0]?.line === 2 && malformed.diagnostics[0]?.column > 1, "JSON syntax diagnostic lost line/column")

console.log(`DesignSpecPanel: ${checks}/${checks} passed`)
})

// V04 â€” explicit terminal "empty" state. Before this card, the panel
// called `parseSpec("")` and rendered the JSON parser's "expected
// property name or '}'" message as a red banner. The user saw a
// hostile first contact before typing. Now the empty state is
// neutral: no parse, no diagnostic, no spec.
describe("V04 â€” createDesignSpecPanelState distinguishes empty from invalid", () => {
  test("an empty string returns the empty state with no diagnostic and no spec", () => {
    const state = createDesignSpecPanelState({ kind: "inline", value: "" })
    expect(state.empty).toBe(true)
    expect(state.diagnostics).toEqual([])
    expect(state.spec).toBeUndefined()
    expect(state.capabilities.granted).toEqual([])
    expect(state.capabilities.denied).toEqual([])
  })

  test("a whitespace-only string is also empty (V04's contract is .trim() === \"\")", () => {
    const state = createDesignSpecPanelState({ kind: "inline", value: "   \n  \t  \n" })
    expect(state.empty).toBe(true)
    expect(state.diagnostics).toEqual([])
    expect(state.spec).toBeUndefined()
  })

  test("an empty file source keeps its path and returns the empty state", () => {
    // File provenance must survive the empty state â€” the editor renders
    // the path even when the value is blank.
    const state = createDesignSpecPanelState({ kind: "file", path: "design/spec.json", value: "" })
    expect(state.empty).toBe(true)
    expect(state.source.kind).toBe("file")
    expect(state.source.path).toBe("design/spec.json")
  })

  test("a valid spec is not empty (empty is *terminal*, not *clean*)", () => {
    // The contract distinguishes `empty` from `valid`: both have no
    // diagnostics, but only `valid` produces a `spec`. The editor uses
    // this to render the preview grid for valid and the placeholder
    // for empty.
    const valid = JSON.stringify({ id: "landing-page", version: "1.0.0", target: "design", title: "Landing", capabilities: [], rules: [], tokens: { colors: {} } })
    const state = createDesignSpecPanelState({ kind: "inline", value: valid })
    expect(state.empty).toBe(false)
    expect(state.spec).toBeDefined()
    expect(state.diagnostics).toEqual([])
  })

  test("a JSON syntax error returns empty=false with a single line/column diagnostic", () => {
    // V04 dedup: the local diagnostic is the only one the user sees
    // for a malformed spec. The remote validation query is already
    // disabled when `spec.diagnostics.length > 0` in the editor; this
    // test pins the local side.
    const state = createDesignSpecPanelState({ kind: "inline", value: "{" })
    expect(state.empty).toBe(false)
    expect(state.diagnostics).toHaveLength(1)
    const diag = state.diagnostics[0]
    expect(diag?.severity).toBe("error")
    expect(diag?.line).toBe(1)
    expect(diag?.column).toBeGreaterThan(0)
  })

  test("a semantic error (parsed JSON, wrong shape) returns empty=false with one diagnostic", () => {
    const state = createDesignSpecPanelState({ kind: "inline", value: '{ "id": "broken" }' })
    expect(state.empty).toBe(false)
    expect(state.diagnostics).toHaveLength(1)
  })

  test("capability denied does NOT show up as a local diagnostic", () => {
    // Capabilities are resolved against the workspace grant (empty in
    // these tests). A denied capability is *not* a parse failure â€” it
    // is a runtime decision surfaced by the remote `/v1/specs/validate`
    // route. Keeping it out of the local diagnostics means the editor
    // does not double up: local shows the spec is well-formed, the
    // banner shows the server's denial.
    const valid = JSON.stringify({ id: "landing-page", version: "1.0.0", target: "design", title: "Landing", capabilities: ["workspace.read"], rules: [], tokens: { colors: {} } })
    const state = createDesignSpecPanelState({ kind: "inline", value: valid })
    expect(state.empty).toBe(false)
    expect(state.diagnostics).toEqual([])
    expect(state.capabilities.denied).toContain("workspace.read")
  })
})
