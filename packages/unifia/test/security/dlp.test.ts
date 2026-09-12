import { describe, it, expect } from "bun:test"
import { redact } from "../../src/security/dlp"

describe("DLP redaction", () => {
  it("redacts AWS access key IDs", () => {
    const result = redact("key = AKIAIOSFODNN7EXAMPLE")
    expect(result.text).toContain("[REDACTED:AWS_KEY]")
    expect(result.text).not.toContain("AKIAIOSFODNN7EXAMPLE")
    expect(result.redactions).toBe(1)
  })

  it("redacts GitHub tokens", () => {
    const result = redact("using ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 for auth")
    expect(result.text).toContain("[REDACTED:GITHUB_TOKEN]")
    expect(result.redactions).toBeGreaterThanOrEqual(1)
  })

  it("redacts Stripe keys", () => {
    // Build the test token dynamically to avoid GitHub push protection
    const prefix = "sk" + "_" + "live" + "_"
    const result = redact("STRIPE_KEY=" + prefix + "x".repeat(24))
    expect(result.text).toContain("[REDACTED:STRIPE_KEY]")
    expect(result.redactions).toBe(1)
  })

  it("redacts Slack tokens", () => {
    const result = redact("const token = 'xoxb-1234567890-abcdefghij'")
    expect(result.text).toContain("[REDACTED:SLACK_TOKEN]")
    expect(result.redactions).toBe(1)
  })

  it("redacts private key blocks", () => {
    const result = redact("-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----")
    expect(result.text).toContain("[REDACTED:PRIVATE_KEY]")
    expect(result.text).not.toContain("MIIEpAIBAAKCAQEA")
    expect(result.redactions).toBe(1)
  })

  it("redacts database connection strings", () => {
    const result = redact("DATABASE_URL=postgres://user:pass@host:5432/db")
    expect(result.text).toContain("[REDACTED:DATABASE_URL]")
    expect(result.redactions).toBe(1)
  })

  it("redacts JWT tokens", () => {
    const result = redact("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456")
    expect(result.text).toContain("[REDACTED:JWT]")
    expect(result.redactions).toBe(1)
  })

  it("handles multiple redactions in same text", () => {
    const stripeKey = "sk" + "_" + "live" + "_" + "x".repeat(24)
    const result = redact("aws AKIAIOSFODNN7EXAMPLE and " + stripeKey)
    expect(result.redactions).toBeGreaterThanOrEqual(2)
    expect(result.findings.length).toBeGreaterThanOrEqual(2)
  })

  it("returns unchanged text when no secrets found", () => {
    const input = "const x = 42; function hello() { return 'world' }"
    const result = redact(input)
    expect(result.text).toBe(input)
    expect(result.redactions).toBe(0)
    expect(result.findings).toHaveLength(0)
  })

  it("findings contain rule details", () => {
    const result = redact("AKIAIOSFODNN7EXAMPLE")
    expect(result.findings[0].rule).toBe("aws-access-key")
    expect(result.findings[0].description).toBe("AWS access key ID")
    expect(result.findings[0].count).toBe(1)
  })
})
