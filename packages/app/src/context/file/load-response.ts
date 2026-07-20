import type { FileContent } from "../../types/sdk-shim"

export function requireFileContent<T>(content: T | null | undefined, error?: unknown): T {
  if (content !== undefined && content !== null) return content
  throw error ?? new Error("File read returned no data")
}

export function sameFileMetadata(current: FileContent, incoming: FileContent): boolean {
  if (current.diff !== incoming.diff) return false
  if (current.patch === incoming.patch) return true
  return JSON.stringify(current.patch) === JSON.stringify(incoming.patch)
}