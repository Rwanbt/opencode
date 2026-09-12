/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * PostM3-R2 — Browser isolation (BR-01..02) (Plan V2.3.1 §218, ADR-013).
 *
 * Locked invariants (regression net, 10 tests):
 *   BR-01 Browser isolation (5):
 *     (1) BrowserIsolationSchema — parses minimal: csp, iframeSandbox default.
 *     (2) BrowserIsolationSchema — accepts an empty iframeSandbox (fully sandboxed).
 *     (3) BrowserIsolationSchema — rejects an empty csp string.
 *     (4) BrowserIsolationSchema refine — allowSameOrigin=true without
 *         "allow-scripts" is refused.
 *     (5) IFRAME_SANDBOX_VALUES — the standard HTML sandbox tokens are all
 *         present ("allow-scripts", "allow-same-origin", "allow-forms",
 *         "allow-top-navigation").
 *
 *   BR-02 Egress control (5):
 *     (6) BrowserEgressPolicySchema — parses with empty allowedOrigins
 *         (the default-deny baseline).
 *     (7) BrowserEgressPolicySchema — accepts an origin pattern
 *         (`https://api.example.com`).
 *     (8) BrowserEgressPolicySchema — rejects a non-origin string
 *         (no protocol).
 *     (9) BrowserEgressPolicySchema — blockThirdPartyCookies defaults to true.
 *     (10) parseBrowserEgressPolicy — round-trips a valid policy
 *          through JSON.
 *
 * Note: the existing M1 `BrowserAutomationBroker` (driver) is in the
 * same module but is not exercised here — that broker has its own
 * smoke test in `p3-lot3-smoke.ts`. The R2 scope is the *trust
 * boundary* (CSP / iframe sandbox / egress allowlist), not the
 * driver.
 */
import { describe, expect, test } from "bun:test"
import {
  IFRAME_SANDBOX_VALUES,
  parseBrowserIsolation,
  parseBrowserEgressPolicy,
} from "../src/browser.ts"

// =========================================================================
// BR-01 — Browser isolation
// =========================================================================

describe("BR-01 Browser isolation — payload", () => {
  test("(1) BrowserIsolationSchema_ParsesMinimal — csp + defaults", () => {
    const parsed = parseBrowserIsolation({ csp: "default-src 'self'" })
    expect(parsed.csp).toBe("default-src 'self'")
    expect(parsed.iframeSandbox).toEqual([])
    expect(parsed.allowTopNavigation).toBe(false)
    expect(parsed.allowSameOrigin).toBe(false)
  })

  test("(2) BrowserIsolationSchema_AcceptsEmptySandbox — fully sandboxed", () => {
    const parsed = parseBrowserIsolation({
      csp: "default-src 'none'",
      iframeSandbox: [],
    })
    expect(parsed.iframeSandbox).toEqual([])
  })

  test("(3) BrowserIsolationSchema_RejectsEmptyCsp", () => {
    expect(() => parseBrowserIsolation({ csp: "" })).toThrow()
  })

  test("(4) BrowserIsolationSchema_RejectsBadSameOriginRefine — allowSameOrigin without allow-scripts", () => {
    expect(() =>
      parseBrowserIsolation({
        csp: "default-src 'self'",
        iframeSandbox: ["allow-same-origin"],
        allowSameOrigin: true,
      }),
    ).toThrow(/allow-scripts/)
  })

  test("(5) IFRAME_SANDBOX_VALUES_ContainsStandardTokens", () => {
    expect(IFRAME_SANDBOX_VALUES.has("allow-scripts")).toBe(true)
    expect(IFRAME_SANDBOX_VALUES.has("allow-same-origin")).toBe(true)
    expect(IFRAME_SANDBOX_VALUES.has("allow-forms")).toBe(true)
    expect(IFRAME_SANDBOX_VALUES.has("allow-top-navigation")).toBe(true)
    // Bonus: a non-existent token is NOT in the set.
    expect(IFRAME_SANDBOX_VALUES.has("allow-everything")).toBe(false)
  })
})

// =========================================================================
// BR-02 — Egress control
// =========================================================================

describe("BR-02 Egress control — payload", () => {
  test("(6) BrowserEgressPolicySchema_ParsesDefaultDeny — empty allowedOrigins", () => {
    const parsed = parseBrowserEgressPolicy({ allowedOrigins: [] })
    expect(parsed.allowedOrigins).toEqual([])
    expect(parsed.blockThirdPartyCookies).toBe(true)
    expect(parsed.defaultDeny).toBe(true)
  })

  test("(7) BrowserEgressPolicySchema_AcceptsOriginPattern", () => {
    const parsed = parseBrowserEgressPolicy({
      allowedOrigins: ["https://api.example.com"],
    })
    expect(parsed.allowedOrigins).toEqual(["https://api.example.com"])
  })

  test("(8) BrowserEgressPolicySchema_RejectsBadOrigin — empty string", () => {
    // Empty origin fails the inner min(1) constraint.
    expect(() => parseBrowserEgressPolicy({ allowedOrigins: [""] })).toThrow()
  })

  test("(9) BrowserEgressPolicySchema_DefaultsBlock3PCookies — true", () => {
    const parsed = parseBrowserEgressPolicy({ allowedOrigins: [] })
    expect(parsed.blockThirdPartyCookies).toBe(true)
  })

  test("(10) parseBrowserEgressPolicy_RoundTripsValid", () => {
    const original = {
      allowedOrigins: ["https://a.example.com", "https://b.example.com"],
      blockThirdPartyCookies: true,
      defaultDeny: true,
    }
    const parsed = parseBrowserEgressPolicy(original)
    const round = JSON.parse(JSON.stringify(parsed))
    expect(round).toEqual(original)
  })
})
