/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { base64Encode } from "@unifia/util/encode"
import { SHELL_MODES } from "@unifia/workbench-shell/modes"
import { type ModeLocation, modeHref, modeNavigationPath, parseModeLocation, sessionAdoptionPath } from "./mode-directory"

const DIRECTORY = "D:/App/unifia"
const ENCODED = base64Encode(DIRECTORY)
const SESSION = "ses_abc123"

type ValidLocation = Exclude<ModeLocation, { kind: "invalid" }>

/**
 * Narrowing that doubles as an assertion: a location the parser rejects must
 * fail loudly here, not read back as merely sessionless — which would let a
 * broken href satisfy every `sessionId` expectation below.
 */
function valid(location: ModeLocation, label: string): ValidLocation {
  if (location.kind === "invalid") throw new Error(`${label} is not a valid location (${location.reason})`)
  return location
}

/** `parseModeLocation` takes pathname and search apart, the way a router hands them over. */
function readBack(href: string): ValidLocation {
  const index = href.indexOf("?")
  const pathname = index === -1 ? href : href.slice(0, index)
  const search = index === -1 ? "" : href.slice(index)
  return valid(parseModeLocation(pathname, search, true), href)
}

function locate(pathname: string, search = ""): ValidLocation {
  return valid(parseModeLocation(pathname, search, true), pathname + search)
}

/**
 * Changing mode must never change conversation: same project, same session,
 * only the mode changes. The route is the sole carrier of that identity across
 * a mode switch, so these tests make the promise falsifiable.
 */
describe("session survives a mode change", () => {
  test.each([...SHELL_MODES])("modeHref keeps the session when leaving code for %s", (target) => {
    const current = locate(`/${ENCODED}/session/${SESSION}`)
    expect(current.sessionId).toBe(SESSION)

    const href = modeHref(current, target)
    expect(href).toBeDefined()
    expect(readBack(href!).sessionId).toBe(SESSION)
  })

  test.each(SHELL_MODES.filter((mode) => mode !== "code"))(
    "modeHref keeps the session when leaving %s for code",
    (origin) => {
      const current = locate(`/${ENCODED}/${origin}`, `?session=${SESSION}`)
      expect(current.sessionId).toBe(SESSION)

      const href = modeHref(current, "code")
      expect(href).toBeDefined()
      expect(readBack(href!).sessionId).toBe(SESSION)
    },
  )

  test("a round trip through every mode returns the same session", () => {
    let location = locate(`/${ENCODED}/session/${SESSION}`)
    for (const mode of [...SHELL_MODES, "code" as const]) {
      const href = modeHref(location, mode)
      expect(href).toBeDefined()
      location = readBack(href!)
      expect(location.sessionId).toBe(SESSION)
    }
  })

  test("a workspace with no session stays without one", () => {
    const current = locate(`/${ENCODED}`)
    expect(current.sessionId).toBeUndefined()
    expect(modeHref(current, "design")).toBe(`/${ENCODED}/design`)
  })
})

/**
 * The adoption rule itself — when a freshly created session must be written
 * into the location, and when moving would be wrong. `adoptSession` in
 * context/mode.tsx is a three-line wrapper around this, so covering it here
 * covers the fix without standing up a router.
 */
describe("sessionAdoptionPath", () => {
  test.each([...SHELL_MODES])("names a new session while in %s", (mode) => {
    const current = locate(mode === "code" ? `/${ENCODED}` : `/${ENCODED}/${mode}`)
    const path = sessionAdoptionPath(current, mode, SESSION)
    expect(path).toBeDefined()
    expect(readBack(path!).sessionId).toBe(SESSION)
    expect(readBack(path!).directory).toBe(DIRECTORY)
  })

  test("stays put when the location already names that session", () => {
    const current = locate(`/${ENCODED}/design`, `?session=${SESSION}`)
    expect(sessionAdoptionPath(current, "design", SESSION)).toBeUndefined()
  })

  test("moves when the location names a different session", () => {
    const current = locate(`/${ENCODED}/design`, "?session=ses_other")
    const path = sessionAdoptionPath(current, "design", SESSION)
    expect(path).toBeDefined()
    expect(readBack(path!).sessionId).toBe(SESSION)
  })

  test("refuses locations that cannot carry a session", () => {
    expect(sessionAdoptionPath(parseModeLocation("/"), "design", SESSION)).toBeUndefined()
    expect(sessionAdoptionPath(parseModeLocation(`/${ENCODED}/nope`, "", true), "design", SESSION)).toBeUndefined()
  })

  test("refuses an empty session id rather than navigating to a sessionless route", () => {
    expect(sessionAdoptionPath(locate(`/${ENCODED}/design`), "design", "")).toBeUndefined()
  })
})

describe("modeNavigationPath is round-trippable", () => {
  test.each([...SHELL_MODES])("a session adopted in %s is readable back", (mode) => {
    const path = modeNavigationPath(DIRECTORY, mode, `?session=${encodeURIComponent(SESSION)}`)
    expect(path).toBeDefined()
    const parsed = readBack(path!)
    expect(parsed.sessionId).toBe(SESSION)
    expect(parsed.directory).toBe(DIRECTORY)
  })

  test("an empty directory yields no path rather than a broken one", () => {
    expect(modeNavigationPath("", "design", "")).toBeUndefined()
  })
})
