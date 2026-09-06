/* SPDX-License-Identifier: MIT */
/**
 * Low-level HTTP helpers used by every handler.
 *
 * WHY a shared module: `json`, `body`, `encodeReadResult` etc. have no
 * domain knowledge — they adapt between the Web `Request`/`Response` API
 * and the JSON shape the rest of the server speaks. Re-implementing them
 * per handler is what made the original file bloat past 1300 lines.
 */
import type { FileReadResult, FileWrite, WorkspaceManifest } from "@unifia/contracts"
import { migrateWorkspaceManifest } from "@unifia/contracts"
import type { JsonRecord } from "./types.js"
import type { AuthorityToken } from "@unifia/workflow-runtime"

/** Build a JSON `Response` with the standard content-type. */
export function json(status: number, body: JsonRecord): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

export function workflowAuthority(request: Request): AuthorityToken | undefined {
  const raw = request.headers.get("x-workflow-authority-token")
  if (!raw) return undefined
  try {
    const token = JSON.parse(raw) as Partial<AuthorityToken>
    if (typeof token.workflowRunId !== "string" || typeof token.authorityOwnerId !== "string" || !Number.isSafeInteger(token.generation)) return undefined
    return token as AuthorityToken
  } catch {
    return undefined
  }
}

/** True iff `error` is a Node ENOENT-shaped error. */
export function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT")
}

/** Parse a manifest blob and run it through the migration ladder. */
export function parseManifestResult(content: string | Uint8Array): WorkspaceManifest {
  const raw = typeof content === "string" ? content : new TextDecoder().decode(content)
  return migrateWorkspaceManifest(JSON.parse(raw))
}

/**
 * Encodes a file read result for the wire.
 *
 * WHY: FileReadResult.content is `string | Uint8Array`, and JSON.stringify turns
 * a Uint8Array into `{"type":"Buffer","data":[104,101,...]}` — a Node-specific
 * blob that no client can rely on and that inflates a text file about sixfold.
 * The encoding is now stated explicitly so the caller can decode deterministically.
 */
export function encodeReadResult(result: FileReadResult): JsonRecord {
  const { content, ...rest } = result
  return typeof content === "string"
    ? { ...rest, content, encoding: "utf-8" }
    : { ...rest, content: Buffer.from(content).toString("base64"), encoding: "base64" }
}

/**
 * Inverse of `encodeReadResult`'s convention, for the write path — an
 * uploaded image or other binary file arrives as base64 text (JSON has no
 * binary type); `encoding` states which decode applies, defaulting to
 * utf-8 for plain create/edit calls that never set it.
 */
export function decodeWriteInput(entry: JsonRecord): FileWrite {
  const path = entry.path
  const content = entry.content
  if (typeof path !== "string" || typeof content !== "string") throw new Error("invalid file write entry")
  const bytes = entry.encoding === "base64" ? Buffer.from(content, "base64") : Buffer.from(content, "utf-8")
  return { path, content: bytes }
}

/** Parse a JSON object body; reject arrays/primitives; coerce errors to a stable message. */
export async function body(request: Request): Promise<JsonRecord> {
  try {
    const value: unknown = await request.json()
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("body must be an object")
    return value as JsonRecord
  } catch {
    throw new Error("invalid JSON body")
  }
}
