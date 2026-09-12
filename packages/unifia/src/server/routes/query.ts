// =============================================================================
// routes/query.ts — query-parameter handling shared by the Team and
// model-intelligence routes.
//
// Two concerns live here because both route files need both, and a second copy
// of either would be a place for the two to drift apart.
// =============================================================================

import type { Context } from "hono"

/**
 * The part of a Standard Schema issue this module reads.
 *
 * Described structurally rather than imported: `@standard-schema/spec` reaches
 * this package only as a transitive dependency of the validator, and depending
 * on it directly would make an upgrade of that validator a build break here.
 */
interface QueryIssue {
  readonly message: string
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined
}

/**
 * Reject a query parameter the route does not know instead of ignoring it.
 *
 * A validator strips unknown keys, which is the wrong default here: a caller
 * who writes `?statuss=running` gets every run back and reads the answer as
 * "they are all running". The failure is silent and the data looks fine.
 *
 * `directory` and `workspace` are exempt — the instance middleware adds them to
 * every request, so they are never the caller's doing.
 */
export function rejectUnknownQuery(url: string, allowed: readonly string[]): string | null {
  const params = new URL(url).searchParams
  for (const key of params.keys()) {
    if (key === "directory" || key === "workspace" || allowed.includes(key)) continue
    return `unknown query parameter: ${key}`
  }
  return null
}

/**
 * Turn a schema rejection into the same `{ error }` shape every other failure
 * on these routes uses, naming the value that was actually sent.
 *
 * The schema's own message says what was expected but not what arrived, and
 * "expected one of active, deprecated, experimental" is not much help to
 * someone who cannot see that they typed `activ`.
 */
export function invalidQuery(
  result: { success: true } | { success: false; error: readonly QueryIssue[] },
  c: Context,
) {
  if (result.success) return
  const issue = result.error[0]
  const key = issue?.path?.[0]
  const name = typeof key === "object" && key !== null ? String(key.key) : String(key ?? "query")
  const received = c.req.query(name)
  const detail = issue?.message ?? "invalid value"
  return c.json({ error: received === undefined ? `invalid ${name}: ${detail}` : `invalid ${name}: ${received} (${detail})` }, 400)
}
