// FORK (CORRECTIF F7, 2026-07-19): a successful empty file is represented by
// a FileContent object whose `content` field is an empty string. Only a
// missing SDK payload is an error and must take the load catch path.
export function requireFileContent<T>(content: T | null | undefined, error?: unknown): T {
  if (content !== undefined && content !== null) return content
  throw error ?? new Error("File read returned no data")
}
