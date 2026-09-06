import { describe, expect, test } from "bun:test"
import { SHELL_MODES } from "@unifia/workbench-shell/modes"
import { base64Encode } from "@unifia/util/encode"
import { modeHref, modeNavigationPath, parseModeLocation, resolveModeDirectory, routeDirectoryFromPathname, sessionSearchFromLocation } from "./mode-directory"
import { AUTOMATE_CAPABILITY, isAutomateAccessible } from "./automate-flag"

test("mode registry exposes the four navigation destinations", () => {
  expect(SHELL_MODES).toEqual(["code", "work", "design", "automate"])
})

test("mode directory decodes the route slug before native Workbench calls", () => {
  const directory = "D:/App/OpenCode/opencode-work-design"
  expect(resolveModeDirectory(base64Encode(directory))).toBe(directory)
  expect(resolveModeDirectory(undefined)).toBe("")
})

test("mode provider resolves the workspace slug without route params", () => {
  const encodedDirectory = base64Encode("D:/App/OpenCode/opencode-work-design")
  expect(routeDirectoryFromPathname(`/${encodedDirectory}/work`)).toBe(encodedDirectory)
  expect(routeDirectoryFromPathname(`/${encodedDirectory}/session`)).toBe(encodedDirectory)
  expect(routeDirectoryFromPathname("/")).toBe("")
})

test("mode navigation preserves only the validated session override", () => {
  expect(sessionSearchFromLocation("?session=session-1&tab=work")).toBe("?session=session-1")
  expect(sessionSearchFromLocation("?tab=work")).toBe("")
})

test("mode navigation refuses to build a route without a workspace", () => {
  expect(modeNavigationPath("", "work", "")).toBeUndefined()
  const directory = "D:/App/OpenCode/opencode-work-design"
  expect(modeNavigationPath(directory, "design", "?session=abc")).toBe(`/${base64Encode(directory)}/design?session=abc`)
})

test("mode location maps Code path sessions through query modes and back", () => {
  const directory = "D:/App/OpenCode/opencode-work-design"
  const code = parseModeLocation(`/${base64Encode(directory)}/session/abc`)
  expect(code).toMatchObject({ kind: "workspace-root", mode: "code", sessionId: "abc" })
  const designHref = new URL(modeHref(code, "design")!, "http://localhost")
  const design = parseModeLocation(designHref.pathname, designHref.search)
  expect(design).toMatchObject({ kind: "mode", mode: "design", sessionId: "abc" })
  expect(modeHref(design, "code")).toBe(`/${base64Encode(directory)}/session/abc`)
})

test("mode location rejects unknown routes and contradictory sessions", () => {
  const directory = base64Encode("D:/App/OpenCode/opencode-work-design")
  expect(parseModeLocation(`/${directory}/unknown`)).toMatchObject({ kind: "invalid", reason: "mode" })
  expect(parseModeLocation(`/${directory}/session/path-id`, "?session=query-id")).toMatchObject({ kind: "invalid", reason: "session" })
})

describe("DA-UI-01 — Automate rail visibility tracks the workflow.run grant", () => {
  test("an empty grant set hides the Automate surface (default posture)", () => {
    // The connection's `grants` is the single source of truth (ADR-1041);
    // a brand-new connection carries the surface lease, which is
    // `workspace.read/write/watch/artifact.preview` — none of those is
    // `workflow.run`, so Automate is hidden until the broker explicitly
    // grants it.
    expect(isAutomateAccessible(new Set())).toBe(false)
  })

  test("a base surface lease (no `workflow.run`) keeps Automate hidden", () => {
    const baseLease = new Set(["workspace.read", "workspace.write", "workspace.watch", "artifact.preview"])
    expect(isAutomateAccessible(baseLease)).toBe(false)
  })

  test("a grant set that includes `workflow.run` exposes the Automate surface", () => {
    const extended = new Set([...SURFACE_LEASE_DERIVED, AUTOMATE_CAPABILITY])
    expect(isAutomateAccessible(extended)).toBe(true)
  })

  test("a grant set with the right token but a typo still hides Automate", () => {
    // The predicate is a strict `Set.has` lookup, not a fuzzy match —
    // a misspelled capability must not silently re-enable the surface.
    const typo = new Set(["workflow.run_typo"])
    expect(isAutomateAccessible(typo)).toBe(false)
  })

  test("the capability constant matches the broker's gate string", () => {
    // ADR-1034 + workbench-server/src/index.ts:#checkCapability pin
    // the capability name. If this drifts, the rail would light up
    // while the broker still refuses, which is the exact bug the
    // B06 audit caught (the no-op stub at mode.tsx:13-14). Keeping
    // the constant exported and asserted here makes the drift
    // loud-fail at test time, not at production time.
    expect(AUTOMATE_CAPABILITY).toBe("workflow.run")
  })
})

test("automate route resolves as unknown when the production build reaches it", () => {
  const directory = base64Encode("D:/App/OpenCode/opencode-work-design")
  expect(parseModeLocation(`/${directory}/automate`)).toMatchObject({ kind: "invalid", reason: "mode" })
  expect(parseModeLocation(`/${directory}/automate`, "", false)).toMatchObject({ kind: "invalid", reason: "mode" })
})

test("automate route resolves normally when explicitly unlocked", () => {
  const directory = base64Encode("D:/App/OpenCode/opencode-work-design")
  expect(parseModeLocation(`/${directory}/automate`, "", true)).toMatchObject({ kind: "mode", mode: "automate" })
})

test("automate route remains requested while its grant is unresolved", () => {
  const directory = base64Encode("D:/App/OpenCode/opencode-work-design")
  expect(parseModeLocation(`/${directory}/automate`, "", "unknown")).toMatchObject({ kind: "mode", mode: "automate" })
})

// Mirrors the surface lease pinned at workbench-shell/src/routes.ts:185
// (kept inline here to avoid pulling the workbench-shell dep into a
// pure-config test; the broker-side set is asserted at
// `capability-scope.test.ts` and `surface-capability.test.ts`).
const SURFACE_LEASE_DERIVED = ["workspace.read", "workspace.write", "workspace.watch", "artifact.preview"] as const
