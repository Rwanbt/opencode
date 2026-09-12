// Bounded, chunked, fail-closed content classifier (P0-6 / ADR-1025).
//
// sanitizeText() never returns raw content under any field, in any form —
// only sizes, a coarse file kind, and a set of detected sensitivity classes
// (secret/path/email/username/binary). Computing a bounded HMAC fingerprint
// is a deliberately separate function (fingerprintContent) so no code path
// in this module can accidentally surface a content prefix in clear text.
//
// Pipeline (plan section 8): bound → detect binary/MIME short-circuit →
// classify extension → scan bounded chunks for paths/emails/secrets/entropy
// → fail closed on any exception.
import { classifyExtension, detectBinarySignature, looksLikeBase64Blob, type FileKind } from "./field-classifier"
import type { RedactedClass } from "./event-schema"
import { hmacSha256 } from "./hmac"

export const SANITIZER_BOUNDS = {
  maxObservedInputBytes: 256 * 1024,
  sanitizerChunkBytes: 4 * 1024,
  maxSanitizerScanBytes: 256 * 1024,
  maxToolOutputClassifyBytes: 64 * 1024,
  fingerprintPreimageBytes: 512,
} as const

// Overlap two chunks by this many characters so a pattern split across a
// chunk boundary (e.g. "sk-" at the end of one chunk, the rest at the start
// of the next) is not silently missed.
const CHUNK_OVERLAP = 64

export interface SanitizeResult {
  fileKind: FileKind
  mime?: string
  originalSizeBytes: number
  storedSizeBytes: 0
  payloadTruncated: boolean
  redactionStatus: "metadata_only" | "failed_closed"
  classes: RedactedClass[]
}

// Bounded HMAC of a content prefix — the only function in this module
// allowed to touch raw content, and only to fold it into a one-way hash.
// Callers must gate this behind captureLevel === "local_redacted" (P0-2).
export function fingerprintContent(text: string, secret: Uint8Array): string {
  const preimage = text.slice(0, SANITIZER_BOUNDS.fingerprintPreimageBytes)
  return hmacSha256(secret, preimage)
}

const SECRET_PATTERNS: RegExp[] = [
  /(?:api|secret|access)[_-]?key[A-Za-z0-9_-]*\s*[:=]\s*['"]?[A-Za-z0-9_\-/+=]{16,}/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{36}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, // JWT-shaped
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
]
const PATH_PATTERN = /(?:^|[\s"'`])(?:[A-Za-z]:[\\/]|\/(?:home|Users|root|etc|var)\/)\S+/
const FILE_URL_PATTERN = /file:\/\//i
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/

// Shannon entropy over the character distribution — catches opaque secrets
// (random tokens, hex/base64 blobs) that don't match a named pattern above.
// Threshold and minimum length are heuristic, not exact.
const ENTROPY_MIN_LENGTH = 24
const ENTROPY_THRESHOLD_BITS_PER_CHAR = 4.3

function shannonEntropy(text: string): number {
  if (!text.length) return 0
  const counts = new Map<string, number>()
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1)
  let entropy = 0
  for (const count of counts.values()) {
    const p = count / text.length
    entropy -= p * Math.log2(p)
  }
  return entropy
}

function hasHighEntropyRun(chunk: string): boolean {
  // Scan "token-shaped" runs (no whitespace) rather than the whole chunk —
  // natural-language text has high per-word entropy noise that would
  // otherwise false-positive constantly.
  for (const run of chunk.split(/\s+/)) {
    if (run.length < ENTROPY_MIN_LENGTH) continue
    if (shannonEntropy(run) >= ENTROPY_THRESHOLD_BITS_PER_CHAR) return true
  }
  return false
}

function scanChunk(chunk: string, classes: Set<RedactedClass>) {
  if (!classes.has("path") && (FILE_URL_PATTERN.test(chunk) || PATH_PATTERN.test(chunk))) classes.add("path")
  if (!classes.has("email") && EMAIL_PATTERN.test(chunk)) classes.add("email")
  if (!classes.has("secret")) {
    if (SECRET_PATTERNS.some((pattern) => pattern.test(chunk))) classes.add("secret")
    else if (hasHighEntropyRun(chunk)) classes.add("secret")
  }
}

function chunks(text: string, size: number, overlap: number): string[] {
  if (text.length <= size) return [text]
  const result: string[] = []
  for (let start = 0; start < text.length; start += size - overlap) {
    result.push(text.slice(start, start + size))
  }
  return result
}

function bytesFromLatin1Prefix(text: string, limit: number): Uint8Array {
  const prefix = text.slice(0, limit)
  const bytes = new Uint8Array(prefix.length)
  for (let i = 0; i < prefix.length; i++) bytes[i] = prefix.charCodeAt(i) & 0xff
  return bytes
}

function failClosed(originalSizeBytes: number): SanitizeResult {
  return {
    fileKind: "unknown",
    originalSizeBytes,
    storedSizeBytes: 0,
    payloadTruncated: false,
    redactionStatus: "failed_closed",
    classes: [],
  }
}

// Phase 3 opt-in content capture (ADR-1032). Unlike sanitizeText() above —
// which can NEVER return content by construction (storedSizeBytes is a
// literal 0 in every branch) — this function DOES return bounded text, and
// is only ever safe to call once a caller has confirmed a non-expired
// opt-in via capture-content.ts's resolveContentCaptureLevel(). Binary/base64
// payloads are still short-circuited to undefined regardless of level: an
// opt-in for readable content was never an opt-in for raw bytes.
const CONTENT_CAPTURE_MAX_BYTES = 32 * 1024

export interface ContentCaptureResult {
  content?: string
  truncated: boolean
  redacted: boolean
}

// Same detection surface as scanChunk() (SECRET_PATTERNS, path/file://,
// email, entropy) but replacing matches instead of only classifying them.
// The entropy pass runs last and only on whitespace-delimited runs, same as
// hasHighEntropyRun(), so it catches opaque tokens the named patterns miss
// without mangling surrounding prose.
function redactMatches(text: string): string {
  let result = text
  for (const pattern of SECRET_PATTERNS) result = result.replace(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"), "[REDACTED:secret]")
  result = result.replace(new RegExp(FILE_URL_PATTERN.source, "gi"), "[REDACTED:path]")
  result = result.replace(new RegExp(PATH_PATTERN.source, PATH_PATTERN.flags.includes("g") ? PATH_PATTERN.flags : PATH_PATTERN.flags + "g"), "[REDACTED:path]")
  result = result.replace(new RegExp(EMAIL_PATTERN.source, "g"), "[REDACTED:email]")
  result = result
    .split(/(\s+)/)
    .map((run) => (run.length >= ENTROPY_MIN_LENGTH && shannonEntropy(run) >= ENTROPY_THRESHOLD_BITS_PER_CHAR ? "[REDACTED:secret]" : run))
    .join("")
  return result
}

export function captureContent(input: { text: string; filename?: string; level: "local_content_redacted" | "local_full" }): ContentCaptureResult {
  try {
    const bounded = input.text.slice(0, CONTENT_CAPTURE_MAX_BYTES)
    const truncated = Buffer.byteLength(bounded, "utf8") < Buffer.byteLength(input.text, "utf8")

    const signature = detectBinarySignature(bytesFromLatin1Prefix(bounded, 32))
    if (signature || looksLikeBase64Blob(bounded)) return { truncated, redacted: false }

    if (input.level === "local_full") return { content: bounded, truncated, redacted: false }
    return { content: redactMatches(bounded), truncated, redacted: true }
  } catch {
    return { truncated: false, redacted: false }
  }
}

export function sanitizeText(input: { text: string; filename?: string }): SanitizeResult {
  // Tracked outside the try so a failure while measuring the input itself
  // (e.g. a hostile non-string value) still reports 0 instead of re-throwing
  // from inside the catch block.
  let originalSizeBytes = 0
  try {
    originalSizeBytes = Buffer.byteLength(input.text, "utf8")
    const bounded = input.text.slice(0, SANITIZER_BOUNDS.maxSanitizerScanBytes)
    const payloadTruncated = bounded.length < input.text.length

    // Binary/MIME short-circuit: never regex/entropy-scan opaque binary or
    // base64-looking payloads (P0-6 — "pas de scan coûteux").
    const signature = detectBinarySignature(bytesFromLatin1Prefix(bounded, 32))
    if (signature) {
      return {
        fileKind: signature.fileKind,
        mime: signature.mime,
        originalSizeBytes,
        storedSizeBytes: 0,
        payloadTruncated,
        redactionStatus: "metadata_only",
        classes: ["binary"],
      }
    }
    if (looksLikeBase64Blob(bounded)) {
      return {
        fileKind: "binary",
        originalSizeBytes,
        storedSizeBytes: 0,
        payloadTruncated,
        redactionStatus: "metadata_only",
        classes: ["binary"],
      }
    }

    const { fileKind } = classifyExtension(input.filename)
    const classes = new Set<RedactedClass>()
    for (const chunk of chunks(bounded, SANITIZER_BOUNDS.sanitizerChunkBytes, CHUNK_OVERLAP)) {
      scanChunk(chunk, classes)
      if (classes.size === 3) break // secret+path+email all found — nothing left to detect
    }

    return {
      fileKind,
      originalSizeBytes,
      storedSizeBytes: 0,
      payloadTruncated,
      redactionStatus: "metadata_only",
      classes: [...classes],
    }
  } catch {
    return failClosed(originalSizeBytes)
  }
}
