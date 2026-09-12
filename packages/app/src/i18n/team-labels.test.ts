import { describe, expect, test } from "bun:test"
import { dict as en } from "./en"
import { teamLabels, TEAM_LABEL_KEYS, type Translate } from "./team-labels"

// Coverage for the TEAM-M05 label bundle.
//
// The point of these is that the bundle and the dictionary cannot drift apart:
// a key renamed in one and not the other produces a screen showing a raw key
// name, which no type check catches because both sides are strings.

const echo: Translate = (key, params) =>
  params ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(",")})` : key

describe("teamLabels — every label is wired to a key", () => {
  test("no label falls through to an empty string", () => {
    const labels = teamLabels(echo)
    const flat = [
      ...Object.values(labels.runs),
      ...Object.values(labels.models),
      labels.selector.title,
      labels.selector.sessionOnly,
      labels.selector.saveDefault,
      labels.selector.clearOverride,
      labels.graph,
      labels.lifecycle,
      ...Object.values(labels.controls),
      labels.retrying,
      labels.exhausted,
    ]

    expect(flat.every((value) => typeof value === "string" && value.length > 0)).toBe(true)
  })

  test("the missing-model label interpolates the model it is about", () => {
    // A message that says "a model is no longer available" without naming it
    // leaves the user to guess which of their models went away.
    const labels = teamLabels(echo)

    expect(labels.selector.missing("openai/gpt-5.2")).toBe("team.selector.missing(model=openai/gpt-5.2)")
  })

  test("every key the bundle reads exists in the English dictionary", () => {
    // The drift guard: a rename on one side and not the other renders the raw
    // key name on screen, and no type check sees it.
    const missing = TEAM_LABEL_KEYS.filter((key) => !(key in en))

    expect(missing).toEqual([])
  })

  test("the declared key list matches the keys the bundle actually reads", () => {
    // Construction reads every static key eagerly; the four accessor
    // functions (selector.missing, runStatus, gateVerdict) only read their
    // key when actually called, so each must be exercised for every value
    // TEAM_LABEL_KEYS declares — otherwise this check would pass while
    // silently never verifying most of the runStatus/gateVerdict entries.
    const read: string[] = []
    const labels = teamLabels((key) => {
      read.push(key)
      return key
    })
    labels.selector.missing("x")
    for (const status of ["pending", "running", "completed", "failed", "aborted"]) labels.runStatus(status)
    for (const verdict of ["APPROVED", "APPROVED_WITH_FOLLOWUP", "CHANGES_REQUESTED"]) labels.gateVerdict(verdict)

    expect(read.toSorted()).toEqual([...TEAM_LABEL_KEYS].toSorted())
  })

  test("the English source interpolates a model placeholder", () => {
    // If the placeholder were dropped from en.ts, the label would silently
    // stop naming the model in every locale that copies its shape.
    expect(en["team.selector.missing"]).toContain("{{model}}")
  })
})
