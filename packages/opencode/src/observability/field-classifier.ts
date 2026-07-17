// Pure structural classification — no policy decisions, no I/O, no secrets.
// Used by sanitizer.ts to short-circuit binary/image/PDF payloads before any
// regex or entropy scan (P0-6).

export type FileKind = "text" | "json" | "markdown" | "code" | "image" | "pdf" | "archive" | "binary" | "unknown"

const EXTENSION_KIND: Record<string, FileKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  svg: "image",
  ico: "image",
  pdf: "pdf",
  zip: "archive",
  tar: "archive",
  gz: "archive",
  tgz: "archive",
  "7z": "archive",
  rar: "archive",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  ts: "code",
  tsx: "code",
  js: "code",
  jsx: "code",
  py: "code",
  rs: "code",
  go: "code",
  java: "code",
  c: "code",
  cpp: "code",
  h: "code",
  hpp: "code",
  rb: "code",
  php: "code",
  sh: "code",
  css: "code",
  html: "code",
}

export function classifyExtension(nameOrPath: string | undefined): { fileKind: FileKind; extension?: string } {
  if (!nameOrPath) return { fileKind: "unknown" }
  const match = /\.([a-zA-Z0-9]+)$/.exec(nameOrPath)
  const extension = match?.[1]?.toLowerCase()
  if (!extension) return { fileKind: "unknown" }
  return { fileKind: EXTENSION_KIND[extension] ?? "text", extension }
}

type Signature = { mime: string; fileKind: FileKind; bytes: number[] }

const SIGNATURES: Signature[] = [
  { mime: "image/png", fileKind: "image", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/jpeg", fileKind: "image", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/gif", fileKind: "image", bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: "application/pdf", fileKind: "pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { mime: "application/zip", fileKind: "archive", bytes: [0x50, 0x4b, 0x03, 0x04] },
]

function matchesSignature(bytes: Uint8Array, signature: number[]) {
  if (bytes.length < signature.length) return false
  for (let i = 0; i < signature.length; i++) if (bytes[i] !== signature[i]) return false
  return true
}

export function detectBinarySignature(bytes: Uint8Array): { mime: string; fileKind: FileKind } | undefined {
  for (const signature of SIGNATURES) {
    if (matchesSignature(bytes, signature.bytes)) return { mime: signature.mime, fileKind: signature.fileKind }
  }
  // WEBP: "RIFF" .... "WEBP" — the 4-byte size field between the two markers
  // varies, so it isn't a fixed-prefix signature like the others above.
  if (
    bytes.length >= 12 &&
    matchesSignature(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mime: "image/webp", fileKind: "image" }
  }
  return undefined
}

const BASE64_MIN_LENGTH = 256
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

// Heuristic only: long, exclusively-base64-charset text is treated as an
// opaque binary blob so the sanitizer short-circuits instead of running
// secret/path/entropy scans over decoded-looking noise.
export function looksLikeBase64Blob(text: string): boolean {
  if (text.length < BASE64_MIN_LENGTH) return false
  const trimmed = text.trim()
  if (trimmed.length % 4 !== 0) return false
  return BASE64_PATTERN.test(trimmed)
}
