import { describe, it, expect } from "bun:test"
import { evaluate, hasBlockingViolation, formatViolations, type PolicyContext } from "../../src/permission/policy"

// Note: Policy engine is disabled by default (no config), so built-in checks won't fire.
// These tests verify the rule logic directly by testing the exported functions.

describe("policy engine", () => {
  it("returns empty violations when disabled (no config)", () => {
    const ctx: PolicyContext = { permission: "bash", patterns: ["rm -rf /"] }
    const violations = evaluate(ctx)
    // Disabled by default — returns empty
    expect(violations).toHaveLength(0)
  })

  it("hasBlockingViolation detects block severity", () => {
    expect(hasBlockingViolation([{ policy: "test", message: "blocked", severity: "block" }])).toBe(true)
    expect(hasBlockingViolation([{ policy: "test", message: "warned", severity: "warn" }])).toBe(false)
    expect(hasBlockingViolation([])).toBe(false)
  })

  it("formatViolations produces readable output", () => {
    const violations = [
      { policy: "p1", message: "Blocked action", severity: "block" as const },
      { policy: "p2", message: "Warning here", severity: "warn" as const },
    ]
    const output = formatViolations(violations)
    expect(output).toContain("Policy BLOCKED")
    expect(output).toContain("[p1]")
    expect(output).toContain("Policy warnings")
    expect(output).toContain("[p2]")
  })

  it("formatViolations returns empty for no violations", () => {
    expect(formatViolations([])).toBe("")
  })
})
