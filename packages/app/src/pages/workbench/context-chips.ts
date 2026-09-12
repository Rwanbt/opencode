/* SPDX-License-Identifier: MIT */

import type { DesignSystemCatalog } from "@unifia/workbench-shell"

/**
 * Phase 10.5 — pure helpers for the context-chips row under the
 * composer: which design system(s) are marked "active" for the next
 * message, and the short hint appended to the outgoing prompt.
 *
 * NOT `buildCatalogContext`/`combineCatalogContexts` (workbench-shell's
 * design-context.ts): those need each catalog's raw `DESIGN.md` content,
 * which `manifest.data?.designSystems` (a `DesignSystemCatalog[]`, no
 * content field) doesn't carry, and there is no client method that
 * fetches it — confirmed by reading client.ts, only `listDesignSystems`
 * exists. That's not an oversight: P4-4's own doc comment in
 * design-surface.tsx records that full catalog-context injection is
 * handled server-side by the agent itself now, not client-built. This
 * module stays within what the client actually has: a compact
 * name/version/source reference, not the full preamble.
 */

export type DesignCatalogRef = Pick<DesignSystemCatalog, "id" | "name" | "version" | "source">

/** Toggles a single catalog id in/out of the active set. Always returns a new Set. */
export function toggleActiveDesignSystemId(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(ids)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** The catalogs currently marked active, in `catalogs`' own order. */
export function activeDesignSystems(
  catalogs: readonly DesignCatalogRef[],
  activeIds: ReadonlySet<string>,
): readonly DesignCatalogRef[] {
  return catalogs.filter((c) => activeIds.has(c.id))
}

/**
 * The block appended to the outgoing message when at least one design
 * system is marked active. Returns "" when none are — same
 * only-append-when-non-empty contract as `buildAttachedCommentsPrompt`
 * and `buildAttachmentReferences`.
 */
export function buildActiveDesignSystemHint(
  catalogs: readonly DesignCatalogRef[],
  activeIds: ReadonlySet<string>,
): string {
  const active = activeDesignSystems(catalogs, activeIds)
  if (active.length === 0) return ""
  const lines = active.map((c) => `- ${c.name} v${c.version} (${c.source})`)
  return ["Active design system(s) — align generated output with these:", ...lines].join("\n")
}
