import { describe, expect, test } from "bun:test"
import { sanitizeText, fingerprintContent, SANITIZER_BOUNDS } from "../../src/observability/sanitizer"

describe("sanitizer", () => {
  test("never returns raw content, only sizes/classes/fileKind", () => {
    const result = sanitizeText({ text: "hello world", filename: "notes.md" })
    expect(result.redactionStatus).toBe("metadata_only")
    expect(result.fileKind).toBe("markdown")
    expect(result.originalSizeBytes).toBe(11)
    expect(result.payloadTruncated).toBe(false)
    expect(JSON.stringify(result)).not.toContain("hello world")
  })

  test("detects a secret-shaped pattern without leaking it", () => {
    const secret = "aws_secret_key = 'AKIAABCDEFGHIJKLMNOP'"
    const result = sanitizeText({ text: `command output:\n${secret}\ndone` })
    expect(result.classes).toContain("secret")
    expect(JSON.stringify(result)).not.toContain("AKIAABCDEFGHIJKLMNOP")
  })

  test("fingerprintContent returns only an HMAC, never the source text", () => {
    const secret = new Uint8Array(32).fill(7)
    const hash = fingerprintContent("super secret content", secret)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain("super secret content")
    // deterministic for the same secret + bounded prefix
    expect(fingerprintContent("super secret content", secret)).toBe(hash)
    // different secret -> different hash (never correlatable without the key)
    const otherSecret = new Uint8Array(32).fill(9)
    expect(fingerprintContent("super secret content", otherSecret)).not.toBe(hash)
  })

  test("detects a high-entropy token even without a named pattern", () => {
    const token = "Qx7v9zP2mK8wR4tL6nJ1sB3dF5hG0yC7uE9aX2iV4oW6"
    const result = sanitizeText({ text: `token=${token}` })
    expect(result.classes).toContain("secret")
  })

  test("detects absolute paths and file:// URLs", () => {
    expect(sanitizeText({ text: "read C:\\Users\\erwan\\secrets.txt" }).classes).toContain("path")
    expect(sanitizeText({ text: "opened file:///home/erwan/.ssh/id_rsa" }).classes).toContain("path")
  })

  test("detects emails", () => {
    expect(sanitizeText({ text: "contact barat.erwan@gmail.com for access" }).classes).toContain("email")
  })

  test("short-circuits PNG signature without scanning for secrets", () => {
    const pngPrefix = String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    const result = sanitizeText({ text: pngPrefix + "AKIAABCDEFGHIJKLMNOP".repeat(20) })
    expect(result.fileKind).toBe("image")
    expect(result.classes).toEqual(["binary"])
  })

  test("short-circuits long base64 blobs without scanning for secrets", () => {
    const blob = Buffer.from("binary-looking-payload".repeat(50)).toString("base64")
    const result = sanitizeText({ text: blob })
    expect(result.fileKind).toBe("binary")
    expect(result.classes).toEqual(["binary"])
  })

  test("bounds a 10 MiB payload without blocking or OOM", () => {
    const huge = "a".repeat(10 * 1024 * 1024)
    const start = performance.now()
    const result = sanitizeText({ text: huge })
    const elapsed = performance.now() - start
    expect(result.payloadTruncated).toBe(true)
    expect(result.originalSizeBytes).toBe(10 * 1024 * 1024)
    expect(elapsed).toBeLessThan(200)
  })

  test("256 KiB textual scan completes well under the bound", () => {
    const text = "the quick brown fox jumps over the lazy dog. ".repeat(6000) // ~282 KiB
    const start = performance.now()
    sanitizeText({ text })
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(50)
  })

  test("does not exhibit catastrophic backtracking on adversarial input", () => {
    // Classic ReDoS bait for naive (\S+\s*)+ style patterns: long run of
    // near-matches with no terminator.
    const bait = ("a".repeat(40) + "!").repeat(2000)
    const start = performance.now()
    sanitizeText({ text: bait })
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(200)
  })

  test("fingerprintContent only hashes a bounded prefix", () => {
    const secret = new Uint8Array(32).fill(1)
    const short = "x".repeat(SANITIZER_BOUNDS.fingerprintPreimageBytes)
    const long = short + "y".repeat(1000) // extra bytes beyond the bound
    expect(fingerprintContent(long, secret)).toBe(fingerprintContent(short, secret))
  })

  test("fails closed on internal error instead of throwing into the caller", () => {
    // Buffer.byteLength throws on non-string input; force the failure path
    // via a getter that throws when the sanitizer reads .length internally.
    const hostile = {
      get length() {
        throw new Error("boom")
      },
      slice: () => "",
      toString: () => "",
    }
    const result = sanitizeText({ text: hostile as unknown as string })
    expect(result.redactionStatus).toBe("failed_closed")
    expect(result.classes).toEqual([])
  })
})
