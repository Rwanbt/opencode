// path.ts — URL helpers + closure-bound path helpers.
//
// This file re-exports the canonical helpers from `./canonical` for
// back-compat with existing imports (`createPathHelpers` and the strip
// helpers are still widely used). New code should prefer importing directly
// from `./canonical` — it is the single source of truth for key generation.

import { canonical, decodeFilePath, stripFileProtocol, stripQueryAndHash, unquoteGitPath } from "./canonical"

export { canonical, decodeFilePath, stripFileProtocol, stripQueryAndHash, unquoteGitPath }

export function encodeFilePath(filepath: string): string {
  // Normalize Windows paths: convert backslashes to forward slashes
  let normalized = filepath.replace(/\\/g, "/")

  // Handle Windows absolute paths (D:/path -> /D:/path for proper file:// URLs)
  if (/^[A-Za-z]:/.test(normalized)) {
    normalized = "/" + normalized
  }

  // Encode each path segment (preserving forward slashes as path separators)
  // Keep the colon in Windows drive letters (`/C:/...`) so downstream file URL parsers
  // can reliably detect drives.
  return normalized
    .split("/")
    .map((segment, index) => {
      if (index === 1 && /^[A-Za-z]:$/.test(segment)) return segment
      return encodeURIComponent(segment)
    })
    .join("/")
}

export function createPathHelpers(scope: () => string) {
  const normalize = (input: string) => canonical(input, scope())

  const tab = (input: string) => {
    const path = normalize(input)
    return `file://${encodeFilePath(path)}`
  }

  const pathFromTab = (tabValue: string) => {
    if (!tabValue.startsWith("file://")) return
    return normalize(tabValue)
  }

  const normalizeDir = (input: string) => normalize(input).replace(/\/+$/, "")

  return {
    normalize,
    tab,
    pathFromTab,
    normalizeDir,
  }
}
