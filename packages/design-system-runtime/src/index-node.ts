/* SPDX-License-Identifier: MIT */

/**
 * Node-only entry of `@unifia/design-system-runtime`.
 *
 * WHY a separate entry: the importer walks the filesystem with
 * `node:fs/promises` and `node:path`, which Vite externalizes when the
 * package is pulled into the web UI bundle. Even with `sideEffects: false`
 * the bundler still parses `import-catalog.ts` (it has to resolve the
 * re-export chain) and trips on the missing exports of the browser
 * external stub. Splitting the Node-only surface into its own subpath
 * keeps the browser entry small and tree-shake-friendly, and the
 * importer script `scripts/import-design-systems.mjs` gets a stable
 * address that does not pollute the web build.
 */

export {
  DESIGN_SYSTEM_ID_REGEX,
  SKIP_REASONS,
  importCatalogs,
  normaliseDesignMdPath,
} from "./import-catalog.js"

export type {
  CatalogSource,
  ImportedCatalog,
  ImportResult,
  SkippedCatalog,
  SkipReason,
} from "./import-catalog.js"
