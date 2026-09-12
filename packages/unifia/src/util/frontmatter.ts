/* SPDX-License-Identifier: MIT */

import matter from "gray-matter"
import { load, dump } from "js-yaml"

/**
 * gray-matter, wired to the js-yaml version this repository actually installs.
 *
 * WHY this wrapper exists: `gray-matter@4.0.3` declares `js-yaml@^3.13.1` and
 * its default engine is built at import time as
 * `parse: yaml.safeLoad.bind(yaml)` / `stringify: yaml.safeDump.bind(yaml)`
 * (node_modules/gray-matter/lib/engines.js:16-17). The workspace root pins
 * `js-yaml@4.3.1` and nothing installs a nested copy under gray-matter, so it
 * binds against v4 — where `safeLoad`/`safeDump` are stubs that throw
 * "Function yaml.safeLoad is removed in js-yaml 4".
 *
 * The result was that EVERY frontmatter parse in the app threw. Measured on a
 * single startup: 34 skills failed to load, each publishing a `session.error`
 * on the bus. The same engine backs agent and command markdown, so those were
 * failing too — the skills were simply the loudest symptom.
 *
 * Supplying the engine explicitly is the fix that keeps one js-yaml in the
 * tree. Pinning a nested v3 would work too, but two YAML implementations with
 * different security defaults is a worse thing to own.
 */
const engines = {
  yaml: {
    // js-yaml 4's `load` is safe by default — it is exactly what `safeLoad`
    // used to be, which is why v4 removed the redundant name.
    parse: (input: string) => (load(input) ?? {}) as object,
    stringify: (input: object) => dump(input),
  },
}

export type Frontmatter = matter.GrayMatterFile<string>

/** Parses frontmatter + body. Throws on malformed YAML, like gray-matter does. */
export function parseFrontmatter(content: string): Frontmatter {
  return matter(content, { engines })
}

/** Serialises body + frontmatter back to a markdown string. */
export function stringifyFrontmatter(body: string, data: object): string {
  return matter.stringify(body, data, { engines })
}
