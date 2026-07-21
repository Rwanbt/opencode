/**
 * Tests for src/github/diagnostics.ts.
 *
 * `categorize()` is unit-tested directly with synthetic stderr/code/signal
 * combinations — the exact Android SIGSYS / "Permission denied" strings this
 * module exists to distinguish (see the mission's diagnostic in
 * packages/mobile/src-tauri/src/runtime/toolchain.rs). `diagnose()` is
 * exercised against this machine's real git installation — a genuine
 * VERIFIED check that the happy path works, not just a mock.
 */
import { expect, test } from "bun:test"
import { categorize, diagnose } from "../../src/github/diagnostics"

test("categorize: SIGSYS signal maps to https_helper_blocked (Android seccomp)", () => {
  expect(categorize("", null, "SIGSYS")).toBe("https_helper_blocked")
})

test("categorize: exit code 159 (128+SIGSYS) maps to https_helper_blocked", () => {
  expect(categorize("Bad system call", 159, null)).toBe("https_helper_blocked")
})

test("categorize: 'Permission denied' maps to https_helper_permission_denied", () => {
  expect(categorize("fatal: cannot exec 'remote-https': Permission denied", 1, null)).toBe(
    "https_helper_permission_denied",
  )
})

test("categorize: DNS failure text maps to dns_failure", () => {
  expect(categorize("fatal: unable to access: Could not resolve host: github.com", 128, null)).toBe("dns_failure")
})

test("categorize: TLS/certificate text maps to tls_failure", () => {
  expect(categorize("SSL certificate problem: unable to get local issuer certificate", 1, null)).toBe("tls_failure")
})

test("categorize: 401/auth failure text maps to authentication_failure", () => {
  expect(categorize("remote: Invalid credentials. fatal: Authentication failed", 128, null)).toBe(
    "authentication_failure",
  )
})

test("categorize: repository not found maps to repository_not_found", () => {
  expect(categorize("remote: Repository not found. fatal: repository 'https://...' not found", 128, null)).toBe(
    "repository_not_found",
  )
})

test("categorize: unrecognized text falls back to unknown", () => {
  expect(categorize("some completely novel error text", 1, null)).toBe("unknown")
})

test("diagnose(): real git on this machine reports available with a version string (network probe stubbed)", async () => {
  // git --version / --exec-path run for real (no network); only the final
  // ls-remote probe is stubbed, per AGENTS.md's "no network in unit tests".
  const report = await diagnose(async () => ({ stdout: "", stderr: "", code: 0, signal: null }))
  expect(report.gitAvailable).toBe(true)
  expect(report.gitVersion).toMatch(/^git version /)
  expect(report.platform).toBe(process.platform)
  expect(report.architecture).toBe(process.arch)
  expect(report.httpsProbeSucceeded).toBe(true)
  expect(report.failure).toBeUndefined()
})

test("diagnose(): a failing stubbed probe populates failure with the right category", async () => {
  const report = await diagnose(async () => ({
    stdout: "",
    stderr: "fatal: cannot exec 'remote-https': Permission denied",
    code: 1,
    signal: null,
  }))
  expect(report.httpsProbeSucceeded).toBe(false)
  expect(report.failure?.category).toBe("https_helper_permission_denied")
})
