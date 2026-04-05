import { describe, it, expect } from "bun:test"
import { scan, formatFindings } from "../../src/security/scanner"

describe("security scanner", () => {
  it("detects hardcoded API keys", () => {
    const content = `const apiKey = "sk-abc123456789012345678901234567890"`
    const findings = scan(content, "config.ts")
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings[0].rule).toBe("hardcoded-api-key")
    expect(findings[0].severity).toBe("critical")
    expect(findings[0].line).toBe(1)
  })

  it("detects hardcoded passwords", () => {
    const content = `const password = "supersecretpassword123"`
    const findings = scan(content, "auth.ts")
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings.some((f) => f.rule === "hardcoded-secret")).toBe(true)
  })

  it("detects AWS access keys", () => {
    const content = `const key = "AKIAIOSFODNN7EXAMPLE"`
    const findings = scan(content, "deploy.ts")
    expect(findings.some((f) => f.rule === "aws-access-key")).toBe(true)
  })

  it("detects private key blocks", () => {
    const content = `-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...`
    const findings = scan(content, "cert.pem")
    expect(findings.some((f) => f.rule === "private-key-block")).toBe(true)
  })

  it("detects SQL injection patterns", () => {
    const content = `const query = "SELECT * FROM users WHERE id = " + req.params.id`
    const findings = scan(content, "db.ts")
    expect(findings.some((f) => f.rule === "sql-injection")).toBe(true)
  })

  it("detects eval usage", () => {
    const content = `const result = eval(userInput)`
    const findings = scan(content, "handler.js")
    expect(findings.some((f) => f.rule === "eval-usage")).toBe(true)
  })

  it("detects command injection", () => {
    const content = "const out = execSync(`ls ${userInput}`)"
    const findings = scan(content, "cli.ts")
    expect(findings.some((f) => f.rule === "command-injection")).toBe(true)
  })

  it("detects CORS wildcard", () => {
    const content = `app.use(cors({ origin: "*" }))`
    const findings = scan(content, "server.ts")
    expect(findings.some((f) => f.rule === "cors-wildcard")).toBe(true)
  })

  it("detects disabled TLS verification", () => {
    const content = `rejectUnauthorized: false`
    const findings = scan(content, "http.ts")
    expect(findings.some((f) => f.rule === "disabled-security")).toBe(true)
  })

  it("returns empty for clean code", () => {
    const content = `function add(a: number, b: number) {\n  return a + b\n}`
    const findings = scan(content, "math.ts")
    expect(findings).toHaveLength(0)
  })

  it("skips rules for non-matching extensions", () => {
    // SQL injection rule only applies to code files, not .md
    const content = `SELECT * FROM users WHERE id = " + req.params.id`
    const findings = scan(content, "docs.md")
    expect(findings.filter((f) => f.rule === "sql-injection")).toHaveLength(0)
  })

  it("masks sensitive values in match output", () => {
    const content = `const apiKey = "sk-verylongsecretapikeythatneedsmasking"`
    const findings = scan(content, "config.ts")
    expect(findings.length).toBeGreaterThanOrEqual(1)
    // The match should contain masked value
    expect(findings[0].match).toContain("********")
    expect(findings[0].match).not.toContain("verylongsecretapikeythatneedsmasking")
  })

  it("formatFindings returns empty string for no findings", () => {
    expect(formatFindings([], "test.ts")).toBe("")
  })

  it("formatFindings produces structured output", () => {
    const findings = scan(`const secret = "mysupersecretpassword123"`, "config.ts")
    const output = formatFindings(findings, "config.ts")
    expect(output).toContain("Security scan")
    expect(output).toContain("security-critical")
  })
})
